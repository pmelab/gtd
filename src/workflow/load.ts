import { existsSync, readFileSync, realpathSync } from "node:fs"
import { createRequire, isBuiltin } from "node:module"
import { dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { stripVTControlCharacters } from "node:util"
import { runInThisContext } from "node:vm"
import type { Plugin as RolldownPlugin } from "rolldown"
import { Context, Effect, Layer } from "effect"
import { GtdError, Narrator } from "../platform/index.js"
import { accessShapeFault, replay, type TreeView } from "../replay/index.js"
// The published facade: what a config's `@pmelab/gtd/flows` import is served.
import * as flows from "../flows/index.js"
import { configure, isFactoryWorkflow, markedOptions, type OptionIssue } from "../flows/internal.js"
import type { StateMode, WorkflowDefinition } from "./Workflow.js"
import type { Door, Flow, ScopeAccess } from "../flows/index.js"
import { Host, Workspace, type WorkspaceOps } from "../platform/index.js"
import { compileConfig, type CompiledConfig } from "./compile.js"
import { SETTING_NAME_RULE, isSettingName } from "./vars.js"
import { ConfigDiscovery, WORKFLOW_MODULE, type WorkflowModule } from "./discovery.js"
import { changedConfigFiles, configFingerprint, type ConfigFingerprint } from "./fingerprint.js"
import { PIN_KEY } from "../install/index.js"
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
  /** Every workflow name `gtd start` accepts, sorted — never `"default"`. */
  readonly workflowNames: readonly string[]
  readonly workflowNamed: (name: string) => ResolvedWorkflow | undefined
  /** Every door `gtd start` accepts. A door's `workflow` resolves through `workflowNamed`. */
  readonly doors: ReadonlyMap<string, Door>
  /** `config.ui` (absent when unconfigured) — `gtd ui` and its CLI flags read it. */
  readonly ui?: flows.UiSettings
  /** Non-fatal findings, formatted through `formatDiagnostic` like an error. */
  readonly warnings: readonly Diagnostic[]
  /** The content hash of every file `gtd.config.ts`'s evaluation touched — itself plus any relative import — by path relative to the root. */
  readonly fingerprint: ConfigFingerprint
  /** Inside a pin, the files it was bundled from that differ on disk now. */
  readonly drift: readonly string[]
}

// Everything lives in `message` (not `GtdError.detail`) — `renderFailure`
// prints `message` verbatim and would print a duplicated `detail` twice.
const configError = (diagnostics: readonly Diagnostic[]): GtdError =>
  new GtdError(
    `gtd: config:\n${diagnostics
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
          "gtd: config:",
          ...found.map((file) => `  - ${file}: no longer read — delete it`),
          "  gtd 23 removed the .gtdrc files; move each key they set:",
          "    vars    → an option of the workflow factory in gtd.config.ts, or `workflow(flow, { defaults })`",
          "    env     → an option of the workflow factory in gtd.config.ts, or `workflow(flow, { envDefaults })`",
          "    judge   → ~/.config/gtd/judge.json, or GTD_JUDGE_PROVIDER / GTD_JUDGE_MODEL",
          "    modes, ui, skills, access → the `config` export of gtd.config.ts (`defineConfig`)",
          "    $schema → nothing; drop it",
          `  see ${MIGRATION_DOC}`,
        ].join("\n"),
      ),
    )
  })

const configModule: Effect.Effect<WorkflowModule, Error, Host | ConfigDiscovery> = Effect.gen(
  function* () {
    const host = yield* Host
    const module = yield* (yield* ConfigDiscovery).workflowModule(host.root, host.home)
    if (module !== undefined) return module
    const missing: Diagnostic = {
      severity: "error",
      path: [],
      message: `no workflows configured: no ${WORKFLOW_MODULE} here or above — gtd ships no workflow; \`gtd guide\` says where to get one`,
      origin: host.root,
    }
    return yield* Effect.fail(configError([missing]))
  },
)

/**
 * Find and evaluate `gtd.config.ts` — or, inside a pin, the workflow bundled
 * into it — then check what it exports. Every finding is collected into ONE
 * sorted report rather than failing on the first.
 */
export const load: Effect.Effect<
  ConfigOperations,
  Error,
  Narrator | Workspace | Host | ConfigDiscovery
> = Effect.gen(function* () {
  const host = yield* Host
  yield* refuseLegacyRc
  const pinned = pinnedWorkflow()
  const module: WorkflowModule =
    pinned === undefined
      ? yield* configModule
      : { filepath: resolvePath(host.root, pinned.origin), source: "" }
  yield* (yield* Narrator).narrate(
    `config: ${pinned === undefined ? "module" : "pinned module"} ${module.filepath}`,
  )
  const shipped =
    pinned === undefined
      ? yield* Effect.tryPromise({
          try: shippedModules,
          catch: (e) => new GtdError(`gtd: ${e instanceof Error ? e.message : String(e)}`),
        })
      : undefined
  const loaded = yield* Effect.tryPromise({
    try: async () =>
      loadWorkflows(
        module.filepath,
        shipped === undefined
          ? runPinned(pinned!, module.filepath, host.root)
          : await evaluate(module, shipped),
      ),
    catch: (e) =>
      new GtdError(
        `gtd: config:\n  - ${module.filepath}: ${e instanceof Error ? e.message : String(e)}`,
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
  const define = (entry: LoadedWorkflow): WorkflowDefinition => ({
    flow: entry.flow,
    summary: entry.summary,
    base: (w, v) => entry.base?.(w, v),
    steering: entry.steering as Record<string, StateMode>,
    modes: compiled.modes,
    skills: entry.skills,
    configuredSkills: compiled.skills,
    access: entry.access,
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
    fingerprint:
      pinned?.fingerprint ??
      configFingerprint(loaded.file.dependencyFiles, host.root, module.read ?? readFromDisk),
    drift:
      pinned === undefined
        ? []
        : changedConfigFiles(
            pinned.fingerprint,
            configFingerprint(
              Object.keys(pinned.fingerprint).map((file) => resolvePath(host.root, file)),
              host.root,
              readFromDisk,
            ),
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

interface LoadedFile {
  readonly origin: string
  /**
   * Every file bundled evaluating this module — `origin` itself plus every
   * local module it (transitively) imports, in NO particular order. A caller
   * that needs to know when a workflow's DEFINITION might have changed (the
   * LSP's steering-map memo) must watch this whole set, not just `origin`: a
   * `gtd.config.ts` re-exporting a sibling module is a documented pattern.
   */
  readonly dependencyFiles: readonly string[]
}

/** A startable workflow, built from a factory or a `workflow()` call's options. */
interface LoadedWorkflow
  extends Settings, Pick<WorkflowDefinition, "summary" | "steering" | "skills" | "access"> {
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

const PACKAGE = "@pmelab/gtd"
const FLOWS = `${PACKAGE}/flows`

interface PackageJson {
  readonly name?: string
  readonly exports: Readonly<Record<string, string | Readonly<Record<string, string>>>>
}

// Only gtd's own package.json: whatever other one sits nearest (a vendored
// bundle inside a project) must never get its exports executed.
export const ownPackage = (): { readonly root: string; readonly pkg: PackageJson } => {
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
    const modules: Record<string, unknown> = { [FLOWS]: flows }
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

/** The file each subpath a config may import serves: all but `flows`, the engine's own, and the testkit's. */
const subpathFiles = (condition: string): ReadonlyMap<string, string> => {
  const { root, pkg } = ownPackage()
  const files = new Map<string, string>()
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    const file = typeof target === "string" ? target : target[condition]
    // A config runs no tests, and the gherkin steps import the consumer's test runner.
    if (subpath === "./flows" || subpath.startsWith("./testkit") || file === undefined) continue
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

/** `what` names the value in an error: `workflow "x"'s "steering"`. */
const stringRecord = (value: unknown, what: string): Readonly<Record<string, string>> => {
  const record = value ?? {}
  if (
    typeof record !== "object" ||
    record === null ||
    Object.values(record).some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`${what} is not a record of strings`)
  }
  return record as Readonly<Record<string, string>>
}

const isStringArray = (v: unknown): v is readonly string[] =>
  Array.isArray(v) && v.every((entry) => typeof entry === "string")

const checkSkillsRecord = (
  value: unknown,
  what: string,
): Readonly<Record<string, readonly string[]>> => {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.values(value).some((entry) => !isStringArray(entry))
  ) {
    throw new Error(`${what} is not a record of skill-name arrays`)
  }
  return value as Readonly<Record<string, readonly string[]>>
}

/** A workflow's `skills` option — a scope full name -> skill list record, or a function of the vars returning one. */
const skillsFrom = (value: unknown, what: string): WorkflowDefinition["skills"] => {
  if (typeof value === "function") {
    return (vars) => checkSkillsRecord((value as (v: typeof vars) => unknown)(vars), what)
  }
  const record = checkSkillsRecord(value ?? {}, what)
  return () => record
}

const checkAccessRecord = (value: unknown, what: string): Readonly<Record<string, ScopeAccess>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `${what} is not a record of scope access (scope -> { read?, write? }) or a function returning one`,
    )
  }
  for (const [scope, access] of Object.entries(value)) {
    const fault = accessShapeFault(access)
    if (fault !== undefined) throw new Error(`${what}: scope "${scope}": ${fault}`)
  }
  return value as Readonly<Record<string, ScopeAccess>>
}

/**
 * A workflow's `access` option — a scope full name -> `{ read?, write? }`
 * record, checked now, or a function of the vars returning one, checked when
 * the process's settings are known.
 */
const accessFrom = (value: unknown, what: string): WorkflowDefinition["access"] => {
  if (typeof value === "function") {
    return (vars) => (value as (v: typeof vars) => never)(vars)
  }
  const record = checkAccessRecord(value ?? {}, what)
  return () => record
}

const optionalFunction = <T>(value: unknown, what: string): T | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== "function") throw new Error(`${what} is not a function`)
  return value as T
}

// What each file-level export of earlier versions became: an option of the
// workflow it configured. Exporting one is a load error, never silently ignored.
const RETIRED_EXPORTS: ReadonlySet<string> = new Set([
  "defaults",
  "envDefaults",
  "steering",
  "skills",
  "access",
  "doors",
  "summary",
  "base",
])

/** Names that are never a workflow. */
const RESERVED_EXPORTS: ReadonlySet<string> = new Set(["default", "config", ...RETIRED_EXPORTS])

const retiredExports = (exports: Record<string, unknown>, origin: string): Diagnostic[] =>
  Object.keys(exports)
    .filter((name) => RETIRED_EXPORTS.has(name))
    .sort()
    .map((name) => ({
      severity: "error",
      path: [name],
      origin,
      message: `the "${name}" export is no longer read — pass it to the workflow it configures: \`workflow(flow, { ${name} })\`, or the build a workflow factory returns`,
    }))

/** The rules every declared setting meets. */
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

/**
 * Each exported workflow's own doors, onto the name it is exported under. A
 * door several workflows build and none is exported under is a clash: no door.
 */
const derivedDoors = (
  catalogue: ReadonlyMap<string, LoadedWorkflow>,
): {
  readonly doors: ReadonlyMap<string, Door>
  readonly clashes: ReadonlyMap<string, readonly string[]>
} => {
  const builders = new Map<string, Door[]>()
  for (const [workflow, loaded] of catalogue) {
    for (const [name, spec] of Object.entries(loaded.doors ?? {})) {
      const door: Door = { ...spec, workflow }
      const problem = doorProblem(name, door)
      if (problem !== undefined)
        throw new Error(`workflow "${workflow}" builds door "${name}", which ${problem}`)
      builders.set(name, [...(builders.get(name) ?? []), door])
    }
  }
  const doors = new Map<string, Door>()
  const clashes = new Map<string, readonly string[]>()
  for (const [name, built] of builders) {
    const owner = ownerOf(name, built)
    if (owner !== undefined) doors.set(name, owner)
    else
      clashes.set(
        name,
        built.map((door) => door.workflow),
      )
  }
  return { doors, clashes }
}

/** The export named after the door owns it, else the sole builder; a clash of several builds no door. */
const ownerOf = (name: string, built: readonly Door[]): Door | undefined =>
  built.find((door) => door.workflow === name) ?? (built.length === 1 ? built[0] : undefined)

const namespaceOf = (exported: unknown): Record<string, unknown> =>
  (typeof exported === "object" && exported !== null ? exported : {}) as Record<string, unknown>

/**
 * Evaluate `gtd.config.ts`. Every export but the reserved names that went
 * through `workflow()` or is a factory workflow is a workflow named by its
 * export.
 */
const loadWorkflows = (origin: string, evaluated: Evaluated): Loaded => {
  const exports = namespaceOf(evaluated.exports)
  const file: LoadedFile = { origin, dependencyFiles: evaluated.files }
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
  const derived =
    rejections.length > 0
      ? { doors: new Map<string, Door>(), clashes: new Map<string, readonly string[]>() }
      : derivedDoors(catalogue)
  const doors = new Map([...derived.doors].sort(([a], [b]) => a.localeCompare(b)))
  return {
    file,
    catalogue,
    doors,
    default: defaultWorkflow && { ...defaultWorkflow, name: defaultName },
    config: compileConfig(exports["config"], origin),
    diagnostics: [
      ...retiredExports(exports, file.origin),
      ...nameRejections(rejections),
      ...shadowingDoors(doors, catalogue, file.origin),
      ...[...derived.clashes].map(([name, builders]): Diagnostic => {
        const names = [...builders].sort().map((b) => JSON.stringify(b))
        return {
          severity: "warning",
          message: `door "${name}" is built by workflows ${names.slice(0, -1).join(", ")} and ${names.at(-1)} and none is exported under that name — rename the export that should own it to "${name}"`,
          path: ["doors", name],
          origin: file.origin,
        }
      }),
    ],
  }
}

/** `gtd start <name>` takes the door, so a door named like a workflow it does not start hides that workflow. */
const shadowingDoors = (
  doors: ReadonlyMap<string, Door>,
  catalogue: ReadonlyMap<string, unknown>,
  origin: string,
): Diagnostic[] =>
  [...doors]
    .filter(([name, door]) => catalogue.has(name) && door.workflow !== name)
    .map(([name, door]) => ({
      severity: "warning",
      message: `door "${name}" starts workflow ${JSON.stringify(door.workflow)} and hides the workflow of the same name from \`gtd start ${name}\` — rename one of them`,
      path: ["doors", name],
      origin,
    }))

// How a TypeScript module is found behind a relative specifier: as written,
// its `.js` spelling as `.ts`, with `.ts` appended, or as a directory index.
const moduleCandidates = (path: string): readonly string[] => [
  path,
  path.replace(/\.js$/, ".ts"),
  path.replace(/\.mjs$/, ".mts"),
  `${path}.ts`,
  join(path, "index.ts"),
]

interface Evaluated {
  readonly exports: unknown
  readonly files: readonly string[]
}

/** A bundle's one chunk: CommonJS, so it runs as a plain function. */
type Chunk = (
  exports: unknown,
  require: (id: string) => unknown,
  module: { exports: unknown },
  __filename: string,
  __dirname: string,
) => void

const execute = (chunk: Chunk, filepath: string, require: (id: string) => unknown): unknown => {
  const cjs = { exports: {} as unknown }
  chunk(cjs.exports, require, cjs, filepath, dirname(filepath))
  return cjs.exports
}

/**
 * Bundles the config and every local module it imports in memory, then
 * evaluates the bundle. With `read`, a relative import `read` can serve is
 * taken from it instead of the disk; one it cannot falls through to the disk,
 * and fails the way a missing file does. An ES module or TypeScript package is
 * bundled too; a CommonJS one is required from where its importer resolved
 * it, as Node would. `@pmelab/gtd/*` is the running gtd's own copy, and
 * `files` leaves out every package file.
 */
const evaluate = async (module: WorkflowModule, shipped: ShippedModules): Promise<Evaluated> => {
  const { code, files } = await bundleConfig(module, { kind: "evaluate", shipped })
  const fromConfig = createRequire(module.filepath)
  const require = Object.assign(
    (id: string): unknown =>
      id in shipped.modules
        ? shipped.modules[id]
        : fromConfig(id in shipped.missing ? shipped.missing[id]! : id),
    { resolve: fromConfig.resolve },
  )
  const chunk = runInThisContext(
    `(function (exports, require, module, __filename, __dirname) {${code}\n})`,
    { filename: module.filepath },
  ) as Chunk
  return { exports: execute(chunk, module.filepath, require), files }
}

/**
 * What a pin registers: its workflow bundled, its origin relative to the
 * repository root, and the fingerprint of the files it was bundled from — the
 * content it runs, whatever the disk holds now.
 */
interface PinnedWorkflow {
  readonly version: string
  readonly origin: string
  readonly fingerprint: ConfigFingerprint
  readonly run: Chunk
}

const pinnedWorkflow = (): PinnedWorkflow | undefined =>
  (globalThis as { [PIN_KEY]?: PinnedWorkflow })[PIN_KEY]

const runPinned = (pinned: PinnedWorkflow, filepath: string, root: string): Evaluated => ({
  // Everything but the engine's own flows and Node's builtins is in the bundle.
  exports: execute(pinned.run, filepath, (id) =>
    id === FLOWS ? flows : createRequire(import.meta.url)(id),
  ),
  files: Object.keys(pinned.fingerprint).map((file) => resolvePath(root, file)),
})

/**
 * The statement that registers `module`'s workflow for a pin: the config and
 * everything it imports — npm packages and gtd's own subpaths included — in
 * one function, so the engine runs it without a config, a package or rolldown.
 */
export const pinnedWorkflowSource = async (
  module: WorkflowModule,
  root: string,
  version: string,
): Promise<string> => {
  const gtd = realpathSync(ownPackage().root) + sep
  const { code, files } = await bundleConfig(module, {
    kind: "pin",
    shipped: subpathFiles(import.meta.url.endsWith(".ts") ? "source" : "default"),
  })
  // gtd's own subpaths are bundled from its package, which only a config
  // living in gtd's own repository may count among its files.
  const own = (file: string) => file.startsWith(gtd) && !module.filepath.startsWith(gtd)
  const registered = {
    version,
    origin: relative(root, module.filepath),
    fingerprint: configFingerprint(
      files.filter((file) => !own(file)),
      root,
      module.read ?? readFromDisk,
    ),
  }
  return `globalThis[Symbol.for(${JSON.stringify(PIN_KEY.description)})] = { ...${JSON.stringify(registered)}, run: function (exports, require, module, __filename, __dirname) {\n${code}\n} };\n`
}

type BundleMode =
  | { readonly kind: "evaluate"; readonly shipped: ShippedModules }
  // Every import goes into the bundle but flows, the engine's own.
  | { readonly kind: "pin"; readonly shipped: ReadonlyMap<string, string> }

const shippedImport = (
  source: string,
  mode: BundleMode,
): string | { readonly id: string; readonly external: true } | undefined => {
  if (mode.kind === "pin")
    return source === FLOWS ? { id: source, external: true } : mode.shipped.get(source)
  return source in mode.shipped.modules || source in mode.shipped.missing
    ? { id: source, external: true }
    : undefined
}

const bundleConfig = async (
  module: WorkflowModule,
  mode: BundleMode,
): Promise<{ readonly code: string; readonly files: readonly string[] }> => {
  const { read } = module
  const served = new Set<string>()
  const fromRead = (path: string): string | null => {
    const hit = moduleCandidates(path).find((candidate) => read?.(candidate) !== undefined)
    if (hit === undefined) return null
    served.add(hit)
    return hit
  }
  const plugin: RolldownPlugin = {
    name: "gtd-config",
    async resolveId(source, importer) {
      if (importer === undefined) return source === module.filepath ? source : null
      const shipped = shippedImport(source, mode)
      if (shipped !== undefined) return shipped
      if (/^\.\.?(\/|$)/.test(source)) return fromRead(join(dirname(importer), source))
      if (!isPackage(source)) return null
      const resolved = await this.resolve(source, importer, { skipSelf: true })
      return mode.kind === "pin" ? resolved : packageImport(source, resolved)
    },
    load(id) {
      if (mode.kind === "pin" && isNativeAddon(id)) throw new Error(nativeAddon(id))
      if (id === module.filepath) return module.source
      return served.has(id) ? read!(id) : null
    },
    // One bundle has one file; each module keeps its own location.
    transform(code, id) {
      return code.replace(/\bimport\.meta\.(url|filename|dirname)\b/g, (_, key: string) =>
        JSON.stringify(
          key === "url" ? pathToFileURL(id).href : key === "filename" ? id : dirname(id),
        ),
      )
    },
  }
  const bundle = await (rolldownModule ??= requireRolldown()).rolldown({
    input: module.filepath,
    platform: "node",
    plugins: [plugin],
    external: (id) => isBuiltin(id),
    resolve: { extensionAlias: { ".js": [".js", ".ts"], ".mjs": [".mjs", ".mts"] } },
    // Every statement runs, as it would unbundled.
    treeshake: false,
    tsconfig: false,
    logLevel: "silent",
  })
  try {
    const { output } = await bundle
      // One chunk, and no `import()` left: the bundle runs as a plain function.
      .generate({
        format: "cjs",
        exports: "named",
        codeSplitting: false,
        dynamicImportInCjs: false,
      })
      .catch((e) => {
        throw bundleError(e)
      })
    const chunk = output[0]
    return {
      code: chunk.code,
      files: chunk.moduleIds.filter((id) => !id.startsWith("\0") && !inPackage(id)),
    }
  } finally {
    await bundle.close()
  }
}

// A pin is plain JavaScript: a compiled addon stays a file on one machine.
// A package node-gyp builds loads its addon by a path no bundler sees.
const isNativeAddon = (id: string): boolean => {
  if (id.endsWith(".node")) return true
  const at = id.lastIndexOf(`node_modules${sep}`)
  if (at < 0) return false
  const rest = id.slice(at + `node_modules${sep}`.length).split(sep)
  const root =
    id.slice(0, at) + ["node_modules", ...rest.slice(0, rest[0]!.startsWith("@") ? 2 : 1)].join(sep)
  return existsSync(join(root, "binding.gyp"))
}

const nativeAddon = (path: string): string => {
  const at = path.lastIndexOf(`node_modules${sep}`)
  const rest = at < 0 ? [] : path.slice(at + `node_modules${sep}`.length).split(sep)
  const name = rest[0]?.startsWith("@") ? rest.slice(0, 2).join("/") : rest[0]
  return `${name === undefined ? path : `package "${name}"`} loads a native addon (${path}), which a pin cannot carry`
}

// Bundled, an ES module gets the shipped `@pmelab/gtd/*` like the config
// does. CommonJS stays Node's: it may read `__dirname`, which a bundle loses.
const packageImport = (
  source: string,
  resolved: { readonly id: string } | null,
): string | { readonly id: string; readonly external: true } =>
  resolved !== null && isEsModule(resolved.id)
    ? resolved.id
    : { id: resolved?.id ?? source, external: true }

const isEsModule = (path: string): boolean => {
  if (/\.(mjs|[cm]?tsx?)$/.test(path)) return true
  if (!/\.jsx?$/.test(path)) return false
  for (let dir = dirname(path); dirname(dir) !== dir; dir = dirname(dir)) {
    const file = join(dir, "package.json")
    if (existsSync(file)) {
      return (JSON.parse(readFileSync(file, "utf8")) as { type?: string }).type === "module"
    }
  }
  return false
}

const inPackage = (path: string): boolean => /[\\/]node_modules[\\/]/.test(path)

const isPackage = (specifier: string): boolean => !isAbsolute(specifier) && !isBuiltin(specifier)

// rolldown reports each error with a colored code frame; a diagnostic takes
// its headline and location.
const bundleError = (e: unknown): unknown => {
  const errors = (e as { errors?: readonly { message: string }[] } | null)?.errors
  if (errors === undefined) return e
  const lines = errors.map(({ message }) => {
    const plain = stripVTControlCharacters(message)
    const at = /\[ (.+:\d+:\d+) \]/.exec(plain)?.[1]
    const headline = plain.split("\n")[0]!
    return at === undefined ? headline : `${headline} (${at})`
  })
  return new Error(lines.join("\n"))
}

type Rolldown = typeof import("rolldown")
let rolldownModule: Rolldown | undefined
// Required at run time, never bundled: rolldown ships a native binding.
const requireRolldown = (): Rolldown => createRequire(import.meta.url)("rolldown") as Rolldown

const isWorkflow = (value: unknown): boolean =>
  markedOptions(value) !== undefined || isFactoryWorkflow(value)

const defaultExport = (exports: Record<string, unknown>): unknown => {
  const value = exports.default
  if (value === undefined) {
    throw new Error(
      "no default export — export the workflow an ordinary start runs; `gtd guide` says where to get one, or write your own",
    )
  }
  if (typeof value !== "function" && !isFactoryWorkflow(value)) {
    throw new Error("the default export is not a function")
  }
  return value
}

/** One exported workflow: a factory validated and built, a `workflow()` call's options checked alike. */
const buildWorkflow = (
  name: string,
  value: unknown,
  file: LoadedFile,
  rejections: Rejection[],
): LoadedWorkflow | undefined => {
  const result = configure(value)
  if (result === undefined) {
    // A plain function only gets here as the default export: a flow without options.
    return checkedBuild(name, file, { ...markedOptions(value), flow: value as Flow })
  }
  if (!result.ok) {
    for (const issue of result.issues) rejections.push(optionDiagnostic(name, issue, file))
    return undefined
  }
  return checkedBuild(name, file, result.build)
}

const BUILD_KEYS: ReadonlySet<string> = new Set([
  "flow",
  "defaults",
  "envDefaults",
  "doors",
  "base",
  "skills",
  "access",
  "steering",
  "summary",
])

/** A build — a factory's, or a `workflow()` call's options with its flow — held to one set of rules. */
const checkedBuild = (
  name: string,
  file: LoadedFile,
  build: flows.WorkflowBuild,
): LoadedWorkflow => {
  const what = (key: string): string => `workflow "${name}"'s "${key}"`
  const unknown = Object.keys(build).filter((key) => !BUILD_KEYS.has(key))
  if (unknown.length > 0) {
    throw new Error(
      `workflow "${name}" has unknown option(s) ${unknown.map((key) => JSON.stringify(key)).join(", ")} — known: ${[...BUILD_KEYS].filter((key) => key !== "flow").join(", ")}`,
    )
  }
  if (typeof build.flow !== "function") throw new Error(`${what("flow")} is not a function`)
  const defaults = stringRecord(build.defaults, what("defaults"))
  const envDefaults = stringRecord(build.envDefaults, what("envDefaults"))
  checkSettings(defaults, envDefaults, (kind) => `workflow "${name}" declares ${kind}`)
  if (
    build.doors !== undefined &&
    (typeof build.doors !== "object" || build.doors === null || Array.isArray(build.doors))
  ) {
    throw new Error(`${what("doors")} is not a record of doors`)
  }
  return {
    flow: build.flow,
    file,
    defaults,
    envDefaults,
    summary: optionalFunction<flows.Summary>(build.summary, what("summary")),
    steering: stringRecord(build.steering, what("steering")),
    skills: skillsFrom(build.skills, what("skills")),
    access: accessFrom(build.access, what("access")),
    doors: build.doors,
    base: optionalFunction<flows.WorkflowBase>(build.base, what("base")),
  }
}

/** A rejected factory option, reported at `gtd.config.ts`. */
const optionDiagnostic = (workflow: string, issue: OptionIssue, file: LoadedFile): Rejection => ({
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
      return Effect.fail(new GtdError(`gtd: config:\n  - ${loaded.file.origin}: ${problem}`))
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
    const outcome = yield* Effect.result(
      replayToFirstStep(loaded, vars.settings, env.settings, empty.tree),
    )
    const reads = [...settingReads("process", vars), ...settingReads("environment", env)]
    if (reads.length > 0) {
      return yield* Effect.fail(
        new GtdError(
          `gtd: config:\n  - ${loaded.file.origin}: the flow's first step on an ordinary start reads ${reads.join(" and ")} — that step is where a finished process waits, so it must not depend on a setting`,
        ),
      )
    }
    if (outcome._tag === "Failure") return yield* Effect.fail(outcome.failure)
    const name = outcome.success
    if (!empty.read()) return name
    const atHead = yield* replayToFirstStep(loaded, vars.settings, env.settings, head)
    if (atHead === name) return name
    return yield* Effect.fail(
      new GtdError(
        `gtd: config:\n  - ${loaded.file.origin}: the flow's first step on an ordinary start depends on the repository's files ("${name}" without them, "${atHead}" at HEAD) — that step is where a finished process waits, so it must not change as files do`,
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

export class ConfigService extends Context.Service<ConfigService, ConfigServiceOperations>()(
  "ConfigService",
) {
  static Live = Layer.succeed(ConfigService, { load })
}
