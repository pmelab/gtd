import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Context, Effect, Layer } from "effect"
import { GtdError, Narrator } from "../platform/index.js"
import { replay, type TreeView } from "../replay/index.js"
import * as flows from "../flows/index.js"
import type { StateMode, WorkflowDefinition } from "./Workflow.js"
import type { Door, Flow } from "../flows/index.js"
import { Host, Workspace, type WorkspaceOps } from "../platform/index.js"
import { compileConfig, type CompiledConfig } from "./compile.js"
import { SETTING_NAME_RULE, isSettingName } from "./vars.js"
import { ConfigDiscovery, WORKFLOW_MODULE, type WorkflowModule } from "./discovery.js"
import { configFingerprint, type ConfigFingerprint } from "./fingerprint.js"
import {
  dedupeDiagnostics,
  formatDiagnostic,
  sortDiagnostics,
  type Diagnostic,
} from "./Diagnostic.js"

/** A startable workflow, resolved with its own file's setting defaults. */
export interface ResolvedWorkflow {
  readonly name: string
  readonly def: WorkflowDefinition
  readonly vars: Record<string, string>
  readonly env: Record<string, string>
}

export interface ConfigOperations {
  /** The default workflow: what an ordinary start runs. */
  readonly workflow: WorkflowDefinition
  /** The default, resolved like a named one; its name is what status shows: the named export it also is, else `"default"`. */
  readonly defaultWorkflow: ResolvedWorkflow
  /** Every name `gtd --workflow` accepts, sorted — never `"default"`. */
  readonly workflowNames: readonly string[]
  readonly workflowNamed: (name: string) => ResolvedWorkflow | undefined
  /** Every door `gtd door` accepts. A door's `workflow` resolves through `workflowNamed`. */
  readonly doors: ReadonlyMap<string, Door>
  /** `config.ui` (absent when unconfigured) — `gtd ui` and its CLI flags read it. */
  readonly ui?: flows.UiSettings
  /** Non-fatal findings, formatted through `formatDiagnostic` like an error. */
  readonly warnings: readonly Diagnostic[]
  /** The content hash of every file `gtd.config.ts`'s evaluation touched — itself plus any relative import — by path relative to the root. */
  readonly fingerprint: ConfigFingerprint
}

// Everything lives in `message` (not `GtdError.detail`) — `renderFailure`
// prints `message` verbatim and would print a duplicated `detail` twice.
const configError = (diagnostics: readonly Diagnostic[]): GtdError =>
  new GtdError(
    `gtd config:\n${diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => `  - ${formatDiagnostic(d)}`)
      .join("\n")}`,
  )

export const failOnErrors = (diagnostics: readonly Diagnostic[]): Effect.Effect<void, GtdError> =>
  diagnostics.some((d) => d.severity === "error")
    ? Effect.fail(configError(diagnostics))
    : Effect.void

const MIGRATION_DOC =
  "https://github.com/pmelab/gtd/blob/main/docs/configuration.md#migrating-from-gtdrc"

/**
 * `.gtdrc` is gone, but a leftover one — a repository's or the user's own —
 * must fail loudly rather than be silently ignored. One the user cannot delete
 * (another account's, in a shared ancestor) only warns: failing would lock them
 * out of gtd with no way to fix it.
 */
export const refuseLegacyRc: Effect.Effect<void, GtdError, Host | ConfigDiscovery | Narrator> =
  Effect.gen(function* () {
    const host = yield* Host
    const files = yield* Effect.orDie((yield* ConfigDiscovery).legacyRcFiles(host.root, host.home))
    for (const file of files.filter((f) => !f.owned)) {
      yield* (yield* Narrator).warn(
        `gtd: warning: ${file.path} is a removed .gtdrc file owned by another user — ignored`,
      )
    }
    const found = files.filter((f) => f.owned).map((f) => f.path)
    if (found.length === 0) return
    return yield* Effect.fail(
      new GtdError(
        [
          "gtd config:",
          ...found.map((file) => `  - ${file}: no longer read — delete it`),
          "  gtd 23 removed the .gtdrc files; move each key they set:",
          "    vars    → an option of the workflow factory in gtd.config.ts, or its `defaults` export",
          "    env     → an option of the workflow factory in gtd.config.ts, or its `envDefaults` export",
          "    judge   → ~/.config/gtd/judge.json, or GTD_JUDGE_PROVIDER / GTD_JUDGE_MODEL",
          "    modes, ui, skills, access → the `config` export of gtd.config.ts (`defineConfig`)",
          "    $schema → nothing; drop it",
          `  see ${MIGRATION_DOC}`,
        ].join("\n"),
      ),
    )
  })

/**
 * Find and evaluate `gtd.config.ts`, then check what it exports. Every finding
 * is collected into ONE sorted report rather than failing on the first.
 */
export const load: Effect.Effect<
  ConfigOperations,
  Error,
  Narrator | Workspace | Host | ConfigDiscovery
> = Effect.gen(function* () {
  const host = yield* Host
  const discovery = yield* ConfigDiscovery
  yield* refuseLegacyRc
  const module = yield* discovery.workflowModule(host.root, host.home)
  if (module === undefined) {
    const missing: Diagnostic = {
      severity: "error",
      path: [],
      message: `no workflows configured: no ${WORKFLOW_MODULE} here or above — run \`gtd install\` to scaffold one`,
      origin: host.root,
    }
    return yield* Effect.fail(configError([missing]))
  }
  yield* (yield* Narrator).narrate(`config: module ${module.filepath}`)
  const shipped = yield* Effect.tryPromise({
    try: shippedModules,
    catch: (e) => new GtdError(`gtd: ${e instanceof Error ? e.message : String(e)}`),
  })
  const loaded = yield* Effect.try({
    try: () => loadWorkflows(module, shipped),
    catch: (e) =>
      new GtdError(
        `gtd config:\n  - ${module.filepath}: ${e instanceof Error ? e.message : String(e)}`,
      ),
  })
  const compiled = loaded.config
  const diagnostics = dedupeDiagnostics(
    sortDiagnostics([...compiled.diagnostics, ...loaded.diagnostics]),
  )
  yield* failOnErrors(diagnostics)
  if (loaded.default === undefined) {
    return yield* Effect.die("unreachable: a default fails to build only with an error reported")
  }

  const initial = yield* firstStep(loaded.default, headTree(yield* Workspace))
  const steering = loaded.file.steering as Record<string, StateMode>
  const define = (entry: LoadedWorkflow): WorkflowDefinition => ({
    flow: entry.flow,
    summary: entry.file.summary,
    // A config's own `base` export wins when it answers; else the factory's.
    base: (w, v) => entry.file.base?.(w, v) ?? entry.base?.(w, v),
    steering,
    modes: compiled.modes,
    skills: entry.file.skills,
    configuredSkills: compiled.skills,
    access: entry.file.access,
    configuredAccess: compiled.access,
    skillsOrigin: entry.file.origin,
    initial,
  })
  const names = [...loaded.catalogue.keys()].sort()
  const resolve = (name: string, entry: LoadedWorkflow): ResolvedWorkflow => ({
    name,
    def: define(entry),
    vars: { ...entry.defaults },
    env: { ...entry.envDefaults },
  })
  const defaultWorkflow = resolve(loaded.default.name, loaded.default)
  return {
    workflow: defaultWorkflow.def,
    defaultWorkflow,
    workflowNames: names,
    doors: loaded.doors,
    workflowNamed: (name) => {
      const entry = loaded.catalogue.get(name)
      return entry === undefined ? undefined : resolve(name, entry)
    },
    ...(compiled.ui !== undefined ? { ui: compiled.ui } : {}),
    warnings: diagnostics.filter((d) => d.severity === "warning"),
    fingerprint: configFingerprint(
      loaded.file.dependencyFiles,
      host.root,
      module.read ?? readFromDisk,
    ),
  }
})

const readFromDisk = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

interface Settings {
  readonly defaults: Readonly<Record<string, string>>
  readonly envDefaults: Readonly<Record<string, string>>
}

interface LoadedFile
  extends
    Pick<WorkflowDefinition, "summary" | "base" | "steering" | "skills" | "access">,
    Settings {
  readonly origin: string
  /**
   * Every real file this module's evaluation touched — `origin` itself plus
   * any relative import it (transitively) resolved on disk, in NO particular
   * order. A caller that
   * needs to know when a workflow's DEFINITION might have changed (the LSP's
   * steering-map memo) must watch this whole set, not just `origin`: a
   * `gtd.config.ts` re-exporting a sibling module is a documented pattern,
   * and jiti resolves that import off disk same as any other require.
   */
  readonly dependencyFiles: readonly string[]
}

/** A startable workflow; its settings are its file's, under whatever its factory declared. */
interface LoadedWorkflow extends Settings {
  readonly flow: Flow
  readonly file: LoadedFile
  readonly doors?: flows.WorkflowDoors | undefined
  readonly base?: flows.WorkflowBase | undefined
}

interface Loaded {
  readonly file: LoadedFile
  /** Every startable workflow. */
  readonly catalogue: ReadonlyMap<string, LoadedWorkflow>
  readonly doors: ReadonlyMap<string, Door>
  /** What an ordinary start runs; absent only alongside an error in `diagnostics`. */
  readonly default: (LoadedWorkflow & { readonly name: string }) | undefined
  readonly config: CompiledConfig
  readonly diagnostics: readonly Diagnostic[]
}

type JitiInstance = {
  evalModule: (
    source: string,
    options: { filename: string; async?: false; cache?: Record<string, unknown> },
  ) => unknown
}
type JitiModule = {
  createJiti: (id: string, options: Record<string, unknown>) => JitiInstance
}

type Transform = (options: { readonly source: string }) => { code: string; error?: unknown }

// Transpiling is most of a load's cost, and a load re-transpiles
// gtd.config.ts and every shipped module it imports. The same options (the
// source included) always transpile to the same code, so an in-process memo
// is safe; evaluation stays fresh on every load.
const TRANSFORM_MEMO_SIZE = 512
const memoized = (transform: Transform): Transform => {
  const memo = new Map<string, ReturnType<Transform>>()
  return (options) => {
    const key = JSON.stringify(options)
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    const result = transform(options)
    if (result.error !== undefined) return result
    if (memo.size >= TRANSFORM_MEMO_SIZE) memo.delete(memo.keys().next().value!)
    memo.set(key, result)
    return result
  }
}

let jitiModule: JitiModule | undefined
let transform: Transform | undefined
/** Relative specifiers a module imports, served from somewhere other than the disk. */
interface LocalModules {
  /** The path a specifier names, or nothing when it names no module. */
  readonly resolve: (specifier: string) => string | undefined
  readonly load: (path: string) => unknown
}

const jiti = (shipped: ShippedModules, local?: LocalModules): JitiInstance => {
  const require = createRequire(import.meta.url)
  jitiModule ??= require("jiti") as JitiModule
  // jiti's own Babel transform, which its package exports don't name.
  transform ??= memoized(
    require(join(dirname(require.resolve("jiti/package.json")), "dist", "babel.cjs")) as Transform,
  )
  return jitiModule.createJiti(import.meta.url, {
    // Consulted when a module is required, so a local module is evaluated
    // only once an import actually runs.
    virtualModules: new Proxy(shipped.modules, {
      has: (modules, id) =>
        id in modules || (typeof id === "string" && local?.resolve(id) !== undefined),
      get: (modules, id) => {
        const path = typeof id === "string" ? local?.resolve(id) : undefined
        return path === undefined ? modules[id as string] : local!.load(path)
      },
    }),
    alias: shipped.missing,
    // No transpile cache on disk, and a fresh module every load — nothing a
    // later command could read back instead of the source.
    fsCache: false,
    moduleCache: false,
    transform,
    // The whole module, not just its default: the named exports are read too.
    interopDefault: false,
  })
}

const PACKAGE = "@pmelab/gtd"

interface PackageJson {
  readonly name?: string
  readonly exports: Readonly<Record<string, string | Readonly<Record<string, string>>>>
}

// Only gtd's own package.json: whatever other one sits nearest (a vendored
// bundle inside a project) must never get its exports executed.
const ownPackage = (): { readonly root: string; readonly pkg: PackageJson } => {
  const start = dirname(fileURLToPath(import.meta.url))
  for (let dir = start; ; dir = dirname(dir)) {
    const file = join(dir, "package.json")
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, "utf8")) as PackageJson
      if (pkg.name === PACKAGE) return { root: dir, pkg }
    }
    if (dirname(dir) === dir) throw new Error(`no ${PACKAGE} package.json above ${start}`)
  }
}

interface ShippedModules {
  readonly modules: Readonly<Record<string, unknown>>
  /** Subpaths whose file failed to load, aliased to that file so only a config importing one fails. */
  readonly missing: Readonly<Record<string, string>>
}

// Every subpath gtd's package exports resolves to the running gtd's own copy,
// so a config needs no install and never mixes versions. `flows` is the module
// already loaded here: a config runs against the very runtime replay installs
// its context for. Run from source (tests), a subpath's `source` is served
// instead of its build. Shipped code never changes in a process, so it is
// imported once, natively: where Node can `require` ESM, the first time a
// config — or a workflow as it runs — requires it, so a command loads only the
// subpaths its config uses; elsewhere, and from source, all of them up front.
let shippedMemo: Promise<ShippedModules> | undefined
const shippedModules = (): Promise<ShippedModules> =>
  (shippedMemo ??= (async () => {
    const fromSource = import.meta.url.endsWith(".ts")
    const files = subpathFiles(fromSource ? "source" : "default")
    const modules: Record<string, unknown> = { [`${PACKAGE}/flows`]: flows }
    const missing: Record<string, string> = {}
    if (process.features.require_module && !fromSource) {
      return { modules: requiredOnUse(modules, files), missing }
    }
    for (const [id, path] of files) {
      try {
        modules[id] = await import(pathToFileURL(path).href)
      } catch {
        missing[id] = path
      }
    }
    return { modules, missing }
  })())

/** The file each subpath a config may import serves: all but `flows`, the engine's own, and `testkit`. */
const subpathFiles = (condition: string): ReadonlyMap<string, string> => {
  const { root, pkg } = ownPackage()
  const files = new Map<string, string>()
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    const file = typeof target === "string" ? target : target[condition]
    // testkit imports the consumer's test runner, and no config runs one.
    if (subpath === "./flows" || subpath === "./testkit" || file === undefined) continue
    files.set(`${PACKAGE}/${subpath.replace(/^\.\//, "")}`, join(root, file))
  }
  return files
}

const requiredOnUse = (
  modules: Record<string, unknown>,
  files: ReadonlyMap<string, string>,
): Record<string, unknown> => {
  const require = createRequire(import.meta.url)
  return new Proxy(modules, {
    has: (loaded, id) => id in loaded || (typeof id === "string" && files.has(id)),
    get: (loaded, id) =>
      typeof id !== "string" || id in loaded
        ? loaded[id as string]
        : (loaded[id] = require(files.get(id)!)),
  })
}

const stringRecord = (
  exports: Record<string, unknown>,
  name: string,
): Readonly<Record<string, string>> => {
  const value = exports[name] ?? {}
  if (
    typeof value !== "object" ||
    value === null ||
    Object.values(value).some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`the "${name}" export is not a record of strings`)
  }
  return value as Readonly<Record<string, string>>
}

const isStringArray = (v: unknown): v is readonly string[] =>
  Array.isArray(v) && v.every((entry) => typeof entry === "string")

const checkSkillsRecord = (value: unknown): Readonly<Record<string, readonly string[]>> => {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.values(value).some((entry) => !isStringArray(entry))
  ) {
    throw new Error(`the "skills" export is not a record of skill-name arrays`)
  }
  return value as Readonly<Record<string, readonly string[]>>
}

/** Read a module's optional `skills` export — a scope full name -> skill list record, or a function of the vars returning one. */
const skillsExport = (exports: Record<string, unknown>): WorkflowDefinition["skills"] => {
  const value = exports["skills"] ?? {}
  if (typeof value === "function") {
    return (vars) => checkSkillsRecord((value as (v: typeof vars) => unknown)(vars))
  }
  const record = checkSkillsRecord(value)
  return () => record
}

/** Read a module's optional `access` export — a scope full name -> `{ read?, write? }` record, or a function of the vars returning one. */
const accessExport = (exports: Record<string, unknown>): WorkflowDefinition["access"] => {
  const value = exports["access"] ?? {}
  if (typeof value === "function") {
    return (vars) => (value as (v: typeof vars) => never)(vars)
  }
  return () => value as never
}

const optionalFunction = <T>(exports: Record<string, unknown>, name: string): T | undefined => {
  const value = exports[name]
  if (value === undefined) return undefined
  if (typeof value !== "function") throw new Error(`the "${name}" export is not a function`)
  return value as T
}

const RESERVED_EXPORTS: ReadonlySet<string> = new Set([
  "default",
  "summary",
  "base",
  "defaults",
  "envDefaults",
  "steering",
  "skills",
  "access",
  "doors",
  "config",
])

/** The rules every declared setting meets, whether a file's export or a factory's build. */
const checkSettings = (
  defaults: Readonly<Record<string, unknown>>,
  envDefaults: Readonly<Record<string, unknown>>,
  declares: (kind: "defaults" | "envDefaults") => string,
): void => {
  for (const [kind, record] of [
    ["defaults", defaults],
    ["envDefaults", envDefaults],
  ] as const) {
    for (const [name, setting] of Object.entries(record)) {
      if (!isSettingName(name)) {
        throw new Error(
          `${declares(kind)} ${JSON.stringify(name)}, not a valid setting name — ${SETTING_NAME_RULE}`,
        )
      }
      if (typeof setting !== "string") {
        throw new Error(`${declares(kind)} ${JSON.stringify(name)}, whose value is not a string`)
      }
    }
  }
  const both = Object.keys(defaults).filter((name) => Object.hasOwn(envDefaults, name))
  if (both.length > 0) {
    throw new Error(
      `${both.map((name) => `"${name}"`).join(", ")} declared in both "defaults" and "envDefaults" — a setting is a process setting or an environment setting, not both`,
    )
  }
}

/** A module's per-file exports: `defaults`, `envDefaults`, `steering`, `skills`, `access`, `summary`, `base`. */
const fileFrom = (
  exports: Record<string, unknown>,
  origin: string,
  dependencyFiles: readonly string[],
): LoadedFile => {
  const defaults = stringRecord(exports, "defaults")
  const envDefaults = stringRecord(exports, "envDefaults")
  checkSettings(defaults, envDefaults, (kind) => `the "${kind}" export declares`)
  return {
    defaults,
    envDefaults,
    steering: stringRecord(exports, "steering"),
    skills: skillsExport(exports),
    access: accessExport(exports),
    summary: optionalFunction(exports, "summary"),
    base: optionalFunction(exports, "base"),
    origin,
    dependencyFiles,
  }
}

const DOOR_NAME_RULE = /^[a-z][a-z0-9-]*$/

/** Why one door's `args` are malformed, or `undefined` when they are well-formed. */
const argsProblem = (args: unknown): string | undefined => {
  if (args === undefined) return undefined
  if (!Array.isArray(args)) return `has "args" that is not an array`
  const seen = new Set<string>()
  let optional = false
  for (const arg of args as readonly { name?: unknown; optional?: unknown }[]) {
    if (typeof arg?.name !== "string") return `has an arg without a "name"`
    if (seen.has(arg.name)) return `declares duplicate arg "${arg.name}"`
    seen.add(arg.name)
    if (arg.optional === true) optional = true
    else if (optional) return `declares required arg "${arg.name}" after an optional one`
  }
  return undefined
}

/** Why one door is malformed, or `undefined` when it is well-formed. */
const doorProblem = (name: string, door: unknown): string | undefined => {
  if (!DOOR_NAME_RULE.test(name)) {
    return `is not a valid door name — it must match ${DOOR_NAME_RULE}`
  }
  const { workflow, args, vars } = (door ?? {}) as Partial<Door>
  if (typeof workflow !== "string") return `must be an object with a "workflow" name`
  const varsOk = vars === undefined || typeof vars === "function"
  return argsProblem(args) ?? (varsOk ? undefined : `has "vars" that is not a function`)
}

/** A module's `doors` export, shape-checked; the workflow names are checked later, against the catalogue. */
const doorsFrom = (exports: Record<string, unknown>): ReadonlyMap<string, Door> => {
  const value = exports["doors"]
  if (value === undefined) return new Map()
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`the "doors" export is not a record of doors`)
  }
  for (const [name, door] of Object.entries(value)) {
    const problem = doorProblem(name, door)
    if (problem !== undefined) throw new Error(`door "${name}" ${problem}`)
  }
  return new Map(Object.entries(value) as [string, Door][])
}

/**
 * Each exported workflow's own doors, onto the name it is exported under. The
 * `doors` export adds to them and settles a name two workflows both declare.
 */
const derivedDoors = (
  catalogue: ReadonlyMap<string, LoadedWorkflow>,
  declared: ReadonlyMap<string, Door>,
): ReadonlyMap<string, Door> => {
  const doors = new Map<string, Door>()
  for (const [workflow, loaded] of catalogue) {
    for (const [name, spec] of Object.entries(loaded.doors ?? {})) {
      const door: Door = { ...spec, workflow }
      const problem = doorProblem(name, door)
      if (problem !== undefined)
        throw new Error(`workflow "${workflow}" builds door "${name}", which ${problem}`)
      const other = doors.get(name)
      if (other !== undefined && !declared.has(name)) {
        throw new Error(
          `door "${name}" is built by workflows "${other.workflow}" and "${workflow}" — declare it in the "doors" export to choose one (a declared door replaces the derived one, so restate its args and vars)`,
        )
      }
      doors.set(name, door)
    }
  }
  return new Map([...doors, ...declared])
}

/** Sort the doors and check each names a startable workflow. */
const checkDoors = (
  declared: ReadonlyMap<string, Door>,
  catalogue: ReadonlyMap<string, LoadedWorkflow>,
): ReadonlyMap<string, Door> => {
  const doors = new Map([...declared].sort(([a], [b]) => a.localeCompare(b)))
  for (const [name, door] of doors) {
    if (!catalogue.has(door.workflow)) {
      throw new Error(
        `door "${name}" names workflow "${door.workflow}", which is not startable — known: ${[...catalogue.keys()].sort().join(", ")}`,
      )
    }
  }
  return doors
}

const namespaceOf = (exported: unknown): Record<string, unknown> =>
  (typeof exported === "object" && exported !== null ? exported : {}) as Record<string, unknown>

/**
 * Evaluate `gtd.config.ts`. Every exported function or factory workflow but
 * the reserved names is a workflow named by its export. `cache` is jiti's OWN
 * per-call module cache (unrelated to the instance's `moduleCache: false`) —
 * passing an empty object in has the side effect of collecting every real file
 * jiti resolved evaluating this module, module AND every relative import it
 * pulled in, transitively.
 */
const loadWorkflows = (module: WorkflowModule, shipped: ShippedModules): Loaded => {
  const { exports: evaluated, files } =
    module.read === undefined
      ? evaluateFromDisk(module, shipped)
      : evaluateRead(module, module.read, shipped)
  const exports = namespaceOf(evaluated)
  const file = fileFrom(exports, module.filepath, files)
  const exported = Object.entries(exports).filter(
    ([name, value]) => !RESERVED_EXPORTS.has(name) && isWorkflow(value),
  )
  const value = defaultExport(exports)
  // A default that is also a named export goes by that name.
  const defaultName = exported.find(([, other]) => other === value)?.[0] ?? "default"

  // Built once per exported value, so a default that is also a named export
  // stays the same workflow.
  const built = new Map<unknown, LoadedWorkflow | undefined>()
  const rejections: Rejection[] = []
  for (const [name, entry] of [...exported, [defaultName, value] as const]) {
    if (!built.has(entry)) built.set(entry, buildWorkflow(name, entry, file, rejections))
  }
  const catalogue = new Map(
    exported.flatMap(([name, entry]) => {
      const workflow = built.get(entry)
      return workflow === undefined ? [] : [[name, workflow] as const]
    }),
  )
  const defaultWorkflow = built.get(value)
  return {
    file,
    catalogue,
    doors:
      rejections.length > 0
        ? new Map()
        : checkDoors(derivedDoors(catalogue, doorsFrom(exports)), catalogue),
    default: defaultWorkflow && { ...defaultWorkflow, name: defaultName },
    config: compileConfig(exports["config"], module.filepath),
    diagnostics: nameRejections(rejections),
  }
}

const evaluateFromDisk = (
  module: WorkflowModule,
  shipped: ShippedModules,
): { readonly exports: unknown; readonly files: readonly string[] } => {
  const cache: Record<string, unknown> = {}
  const exports = jiti(shipped).evalModule(module.source, { filename: module.filepath, cache })
  return { exports, files: Object.keys(cache) }
}

// How jiti finds a TypeScript module behind a specifier: as written, its
// `.js` spelling as `.ts`, with `.ts` appended, or as a directory index.
const moduleCandidates = (path: string): readonly string[] => [
  path,
  path.replace(/\.js$/, ".ts"),
  path.replace(/\.mjs$/, ".mts"),
  `${path}.ts`,
  join(path, "index.ts"),
]

/**
 * Evaluates the config with every local module it imports taken from `read`
 * instead of the disk. jiti matches a virtual module on the specifier as
 * written, so each module gets its own instance resolving against its own
 * directory. A specifier `read` cannot serve falls through to the disk, and
 * fails the way a missing file does.
 */
const evaluateRead = (
  module: WorkflowModule,
  read: (path: string) => string | undefined,
  shipped: ShippedModules,
): { readonly exports: unknown; readonly files: readonly string[] } => {
  const files = [module.filepath]
  const evaluated = new Map<string, unknown>()
  const evaluate = (filepath: string, source: string): unknown =>
    jiti(shipped, {
      resolve: (specifier) =>
        /^\.\.?\//.test(specifier)
          ? moduleCandidates(join(dirname(filepath), specifier)).find(
              (candidate) => read(candidate) !== undefined,
            )
          : undefined,
      load: (path) => {
        if (!evaluated.has(path)) {
          // A placeholder first, so an import cycle ends here.
          evaluated.set(path, {})
          files.push(path)
          evaluated.set(path, evaluate(path, read(path)!))
        }
        return evaluated.get(path)
      },
    }).evalModule(source, { filename: filepath })
  return { exports: evaluate(module.filepath, module.source), files }
}

const isWorkflow = (value: unknown): boolean =>
  typeof value === "function" || flows.isFactoryWorkflow(value)

const defaultExport = (exports: Record<string, unknown>): unknown => {
  const value = exports.default
  if (value === undefined) {
    throw new Error(
      "no default export — export the workflow an ordinary start runs (`gtd install` scaffolds one)",
    )
  }
  if (!isWorkflow(value)) throw new Error("the default export is not a function")
  return value
}

/** One exported workflow: a plain flow as-is, a factory validated and built. */
const buildWorkflow = (
  name: string,
  value: unknown,
  file: LoadedFile,
  rejections: Rejection[],
): LoadedWorkflow | undefined => {
  const result = flows.configure(value)
  if (result === undefined)
    return { flow: value as Flow, file, defaults: file.defaults, envDefaults: file.envDefaults }
  if (!result.ok) {
    for (const issue of result.issues) rejections.push(optionDiagnostic(name, issue, file))
    return undefined
  }
  return {
    flow: result.build.flow,
    file,
    ...builtSettings(name, file, result.build),
    doors: result.build.doors,
    base: result.build.base,
  }
}

/** A factory's settings over its file's, held to the rules a file's own exports are. */
const builtSettings = (name: string, file: LoadedFile, build: flows.WorkflowBuild): Settings => {
  checkSettings(
    build.defaults ?? {},
    build.envDefaults ?? {},
    (kind) => `workflow "${name}" builds ${kind}`,
  )
  const defaults = { ...file.defaults, ...build.defaults }
  const envDefaults = { ...file.envDefaults, ...build.envDefaults }
  checkSettings(defaults, envDefaults, (kind) => `workflow "${name}" builds ${kind}`)
  return { defaults, envDefaults }
}

/** A rejected factory option, reported at `gtd.config.ts`. */
const optionDiagnostic = (
  workflow: string,
  issue: flows.OptionIssue,
  file: LoadedFile,
): Rejection => ({
  workflow,
  severity: "error",
  path: issue.path,
  message: `${issue.path.length > 0 ? `option "${issue.path.join(".")}"` : "options"}: ${issue.message}`,
  origin: file.origin,
})

/** One rejected option, before the workflows rejecting it alike are named together. */
interface Rejection extends Diagnostic {
  readonly workflow: string
}

const nameRejections = (rejections: readonly Rejection[]): Diagnostic[] => {
  const grouped = new Map<string, { readonly first: Rejection; readonly workflows: string[] }>()
  for (const rejection of rejections) {
    const key = JSON.stringify([rejection.origin, rejection.path, rejection.message])
    const group = grouped.get(key)
    if (group === undefined) grouped.set(key, { first: rejection, workflows: [rejection.workflow] })
    else group.workflows.push(rejection.workflow)
  }
  return [...grouped.values()].map(({ first: { workflow: _, ...diagnostic }, workflows }) => ({
    ...diagnostic,
    message: `${workflows.length > 1 ? "workflows" : "workflow"} ${workflows.map((w) => `"${w}"`).join(", ")} ${diagnostic.message}`,
  }))
}

// The repository's HEAD, read lazily.
const headTree = (workspace: WorkspaceOps): TreeView => {
  let entries: ReadonlyMap<string, string> | undefined
  const list = () => (entries ??= workspace.treeSync("HEAD"))
  return {
    paths: () => [...list().keys()].sort(),
    read: (path) => (list().has(path) ? workspace.readCommittedSync(path, "HEAD") : undefined),
    id: (path) => list().get(path),
  }
}

/** An empty tree that records whether the flow looked at it. */
const watchedEmptyTree = (): { readonly tree: TreeView; readonly read: () => boolean } => {
  let read = false
  return {
    tree: {
      paths: () => ((read = true), []),
      read: () => ((read = true), undefined),
    },
    read: () => read,
  }
}

/** An empty settings record that logs every read: a named `get`/`has`, or an enumeration. */
const watchedEmptySettings = (): {
  readonly settings: Readonly<Record<string, string>>
  readonly names: ReadonlySet<string>
  readonly enumerated: () => boolean
} => {
  const names = new Set<string>()
  let enumerated = false
  const settings = new Proxy<Record<string, string>>(
    {},
    {
      get: (_target, key) => {
        if (typeof key === "string") names.add(key)
        return undefined
      },
      has: (_target, key) => {
        if (typeof key === "string") names.add(key)
        return false
      },
      ownKeys: () => {
        enumerated = true
        return []
      },
    },
  )
  return { settings, names, enumerated: () => enumerated }
}

const settingReads = (kind: string, watch: ReturnType<typeof watchedEmptySettings>): string[] => {
  const reads: string[] = []
  if (watch.names.size > 0) {
    const sorted = [...watch.names].sort().map((name) => JSON.stringify(name))
    reads.push(`the ${kind} setting${sorted.length > 1 ? "s" : ""} ${sorted.join(", ")}`)
  }
  if (watch.enumerated()) reads.push(`every ${kind} setting`)
  return reads
}

const replayToFirstStep = (
  loaded: NonNullable<Loaded["default"]>,
  vars: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string>>,
  tree: TreeView,
): Effect.Effect<string, GtdError> =>
  Effect.flatMap(
    Effect.promise(() =>
      replay({
        flow: loaded.flow,
        episode: { base: { hash: "", tree }, commits: [] },
        vars,
        env,
        start: "",
        budgetBytes: Number.MAX_SAFE_INTEGER,
      }),
    ),
    (outcome) => {
      if (outcome.kind === "rest") return Effect.succeed(outcome.rest.name)
      const problem =
        outcome.kind === "failed" || outcome.kind === "refused"
          ? outcome.message.replace(/^gtd: /, "")
          : "the default entry must begin at a step — that step is where a finished process waits"
      return Effect.fail(new GtdError(`gtd config:\n  - ${loaded.file.origin}: ${problem}`))
    },
  )

/**
 * The default entry's first step — where a finished process waits — found the
 * only way a flow can be read: by replaying it over an empty history. Episode
 * boundaries are that step's commits, so it must depend on neither a setting
 * (edited mid-process, it would move the boundary before pinned values are
 * read) nor the tree: a flow that reads the repository before reaching it is
 * replayed again over HEAD, and must reach the same step there.
 */
const firstStep = (
  loaded: NonNullable<Loaded["default"]>,
  head: TreeView,
): Effect.Effect<string, GtdError> =>
  Effect.gen(function* () {
    const empty = watchedEmptyTree()
    const vars = watchedEmptySettings()
    const env = watchedEmptySettings()
    const outcome = yield* Effect.either(
      replayToFirstStep(loaded, vars.settings, env.settings, empty.tree),
    )
    const reads = [...settingReads("process", vars), ...settingReads("environment", env)]
    if (reads.length > 0) {
      return yield* Effect.fail(
        new GtdError(
          `gtd config:\n  - ${loaded.file.origin}: the flow's first step on an ordinary start reads ${reads.join(" and ")} — that step is where a finished process waits, so it must not depend on a setting`,
        ),
      )
    }
    if (outcome._tag === "Left") return yield* Effect.fail(outcome.left)
    const name = outcome.right
    if (!empty.read()) return name
    const atHead = yield* replayToFirstStep(loaded, vars.settings, env.settings, head)
    if (atHead === name) return name
    return yield* Effect.fail(
      new GtdError(
        `gtd config:\n  - ${loaded.file.origin}: the flow's first step on an ordinary start depends on the repository's files ("${name}" without them, "${atHead}" at HEAD) — that step is where a finished process waits, so it must not change as files do`,
      ),
    )
  })

interface ConfigServiceOperations {
  readonly load: Effect.Effect<
    ConfigOperations,
    Error,
    Narrator | Workspace | Host | ConfigDiscovery
  >
}

export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  ConfigServiceOperations
>() {
  static Live = Layer.succeed(ConfigService, { load })
}
