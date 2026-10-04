import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { Context, Effect, Layer, Schema } from "effect"
import { ArrayFormatter } from "effect/ParseResult"
import { GtdError, Narrator } from "../Commentary.js"
import { replay, type TreeView } from "../replay/index.js"
import * as flows from "../flows/index.js"
import { unified as builtInWorkflow } from "../workflows/index.js"
import type { WorkflowDefinition } from "../Workflow.js"
import { Host, Workspace, type WorkspaceOps } from "../platform/index.js"
import { ConfigSchema, type UiConfig } from "../ConfigSchema.js"
import { compileConfig, type ConfigLayer } from "./compile.js"
import { interpolate } from "./interpolate.js"
import { resolveVars } from "./vars.js"
import { ConfigDiscovery, type ConfigLevel, type WorkflowModule } from "./discovery.js"
import {
  dedupeDiagnostics,
  BUILT_IN_ORIGIN,
  formatDiagnostic,
  sortDiagnostics,
  type Diagnostic,
} from "./Diagnostic.js"

export interface ConfigOperations {
  readonly workflow: WorkflowDefinition
  /** The workflow's own `vars:` defaults. */
  readonly workflowVars: Record<string, string>
  readonly rcVars: Record<string, string>
  /** The top-level `ui:` key, decoded as-is (absent when unconfigured) — `gtd ui` and its CLI flags read it. */
  readonly ui?: UiConfig
  /** Non-fatal findings, formatted through `formatDiagnostic` like an error. */
  readonly warnings: readonly Diagnostic[]
  /** Every `.gtdrc`-family file this load actually found, outermost→innermost — the `.gtdrc` half of what backs `workflow`/`rcVars`/`ui`. */
  readonly configFiles: readonly string[]
  /** Every real file `gtd.config.ts`'s evaluation touched (itself plus any relative import), or `[]` for the built-in workflow — the other half. A caller that must know when `workflow` might have changed (the LSP's steering-map memo) watches `configFiles` + `workflowFiles` together; watching `gtd.config.ts`'s own path alone misses an edit to a module it imports. */
  readonly workflowFiles: readonly string[]
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * Detect whether a gtd config lives at THIS single directory — no ancestor
 * walk, so a global `~/.gtdrc` or an ancestor project's config does NOT
 * count. `gtd init` refuses only when it would overwrite the repo's own
 * config, not merely because a global default layer exists upstream.
 */
export const configPresentAt = (dir: string): Effect.Effect<boolean, Error, ConfigDiscovery> =>
  Effect.flatMap(ConfigDiscovery, (discovery) => discovery.presentAt(dir))

/** A `ParseResult` path segment is a `PropertyKey` (string, number, or symbol); a `Diagnostic.path` segment is only ever string or number — a decode error's path never contains a symbol, but the conversion is total either way. */
const toPathSegment = (key: PropertyKey): string | number =>
  typeof key === "number" ? key : String(key)

/**
 * `Schema.optional(SomeStruct)`'s other union branch also fails on a
 * genuinely-present-but-invalid `ui:`, with a redundant "Expected undefined,
 * actual …" — a decode-mechanics artifact, not a fact about the user's file.
 * Dropped whenever a more specific issue exists at the same-or-deeper path.
 */
const dropOptionalUndefinedArtifacts = <
  T extends { readonly message: string; readonly path: ReadonlyArray<PropertyKey> },
>(
  all: readonly T[],
): readonly T[] => {
  const samePathOrDeeper = (
    outer: ReadonlyArray<PropertyKey>,
    inner: ReadonlyArray<PropertyKey>,
  ): boolean => inner.length >= outer.length && outer.every((seg, i) => inner[i] === seg)
  return all.filter(
    (issue) =>
      !issue.message.startsWith("Expected undefined, actual") ||
      !all.some((other) => other !== issue && samePathOrDeeper(issue.path, other.path)),
  )
}

/**
 * One decoded level, or none — with its own findings either way. Decode
 * failures (schema shape, excess properties) become `Diagnostic`s here
 * rather than failing the whole load immediately, so every level's own
 * findings surface together through `load`'s single sorted/deduped report,
 * the same as every other producer in this package.
 */
const decodeLevel = (
  level: ConfigLevel,
  env: Readonly<Record<string, string | undefined>>,
): Effect.Effect<{
  readonly layer: ConfigLayer | undefined
  readonly diagnostics: readonly Diagnostic[]
}> =>
  Effect.gen(function* () {
    if (!isPlainObject(level.config)) {
      return {
        layer: undefined,
        diagnostics: [
          {
            severity: "error" as const,
            path: [],
            message: `config must be a plain object, got ${Array.isArray(level.config) ? "array" : String(level.config)}`,
            origin: level.filepath,
          },
        ],
      }
    }
    const { $schema: _schema, ...cleaned } = level.config
    const result = yield* Schema.decodeUnknown(ConfigSchema)(cleaned, {
      onExcessProperty: "error",
    }).pipe(Effect.either)
    if (result._tag === "Left") {
      const issues = dropOptionalUndefinedArtifacts(ArrayFormatter.formatErrorSync(result.left))
      const diagnostics: Diagnostic[] = issues.map((issue) => ({
        severity: "error",
        path: issue.path.map(toPathSegment),
        message:
          issue.path.length > 0
            ? `"${issue.path.map(String).join(".")}" ${issue.message}`
            : issue.message,
        origin: level.filepath,
      }))
      return { layer: undefined, diagnostics }
    }
    const interpolated = interpolate(result.right, env)
    return {
      layer: { origin: level.filepath, dir: dirname(level.filepath), value: interpolated.value },
      diagnostics: interpolated.diagnostics.map((d) => ({ ...d, origin: level.filepath })),
    }
  })

/**
 * Build the whole config pipeline — discover levels by walking `Host`'s
 * cwd→home chain (`ConfigDiscovery`, kept behind a `Context.Tag` since its
 * production implementation reads real disk through cosmiconfig directly,
 * incompatible with an in-memory `@inmem` `Workspace`), decode each level
 * individually against `ConfigSchema`, then hand every successfully-decoded
 * layer to the pure `compileWorkflow` boundary (`src/workflow/compile.ts`),
 * which does its own merging and `./`/`../` file-ref inlining (through
 * `Workspace`, which — unlike discovery — both production and an in-memory
 * scenario back identically). A decode failure never short-circuits the
 * whole load: every level's own findings — decode AND compile alike — are
 * sorted/deduped together (`levels`' own order is the layer order, decode
 * failures included) into ONE report, so a config broken at two ancestor
 * layers reports both instead of just the first one reached.
 */
export const load: Effect.Effect<
  ConfigOperations,
  Error,
  Narrator | Workspace | Host | ConfigDiscovery
> = Effect.gen(function* () {
  const narrator = yield* Narrator
  const host = yield* Host
  const discovery = yield* ConfigDiscovery
  const levels = yield* discovery.levels(host.root, host.home)
  for (const level of levels) yield* narrator.narrate(`config: layer ${level.filepath}`)
  const decoded = yield* Effect.forEach(levels, (level) => decodeLevel(level, host.env))
  const layers = decoded.flatMap((d) => (d.layer !== undefined ? [d.layer] : []))
  const decodeDiagnostics = decoded.flatMap((d) => d.diagnostics)

  const compiled = compileConfig(layers)
  const module = yield* discovery.workflowModule(host.root, host.home)
  const loaded = yield* Effect.try({
    try: () => loadWorkflow(module),
    catch: (e) =>
      new GtdError(
        `gtd config:\n  - ${module?.filepath ?? BUILT_IN_ORIGIN}: ${e instanceof Error ? e.message : String(e)}`,
      ),
  })
  const layerOrder = [
    ...levels.map((level) => level.filepath),
    ...(module ? [module.filepath] : []),
  ]
  // A `skills:` key naming a step the loaded workflow's own `skills` export
  // does not declare: checked here, only once `loaded` exists, because a
  // custom workflow's step names are never known to the schema — see
  // ConfigSchema's `skills` annotation.
  const knownSkillNames = Object.keys(loaded.skills).sort()
  const unknownSkillDiagnostics = compiled.skillsKeys
    .filter(({ key }) => !Object.hasOwn(loaded.skills, key))
    .map(({ key, origin }) => ({
      severity: "error" as const,
      path: ["skills", key],
      message: `"skills.${key}" names a step this workflow does not declare — known step names: ${knownSkillNames.join(", ")}`,
      origin,
    }))
  const diagnostics = dedupeDiagnostics(
    sortDiagnostics(
      [...decodeDiagnostics, ...compiled.diagnostics, ...unknownSkillDiagnostics],
      layerOrder,
    ),
  )

  const fatal = diagnostics.filter((d) => d.severity === "error")
  if (fatal.length > 0) {
    // Everything lives in `message` (not `GtdError.detail`) — `renderFailure`
    // prints `message` verbatim and would print a duplicated `detail` twice.
    const lines = fatal.map(formatDiagnostic)
    return yield* Effect.fail(
      new GtdError(`gtd config:\n${lines.map((line) => `  - ${line}`).join("\n")}`),
    )
  }

  const initial = yield* firstStep(
    loaded,
    resolveVars(loaded.defaults, compiled.rcVars, {}, host.env),
    headTree(yield* Workspace),
  )
  return {
    workflow: {
      flow: loaded.flow,
      summary: loaded.summary,
      base: loaded.base,
      steering: loaded.steering,
      modes: compiled.modes,
      skills: loaded.skills,
      configuredSkills: compiled.rcSkills,
      initial,
    },
    workflowVars: { ...loaded.defaults },
    rcVars: compiled.rcVars,
    ...(compiled.ui !== undefined ? { ui: compiled.ui } : {}),
    warnings: diagnostics.filter((d) => d.severity === "warning"),
    configFiles: levels.map((level) => level.filepath),
    workflowFiles: loaded.dependencyFiles,
  }
})

interface LoadedModule extends Pick<
  WorkflowDefinition,
  "flow" | "summary" | "base" | "steering" | "skills"
> {
  readonly defaults: Readonly<Record<string, string>>
  readonly origin: string
  /**
   * Every real file this module's evaluation touched — `origin` itself plus
   * any relative import it (transitively) resolved on disk, in NO particular
   * order. Empty for the built-in workflow (no file backs it). A caller that
   * needs to know when this workflow's DEFINITION might have changed (the
   * LSP's steering-map memo) must watch this whole set, not just `origin`:
   * `gtd.config.ts` re-exporting a sibling module's `steering`/steps is a
   * documented pattern (`docs/configuration.md`), and jiti resolves that
   * import off disk same as any other require.
   */
  readonly dependencyFiles: readonly string[]
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

// Loaded on first use: only a repository with its own gtd.config.ts needs it.
let jitiModule: JitiModule | undefined
let transform: Transform | undefined
const jiti = (): JitiInstance => {
  const require = createRequire(import.meta.url)
  jitiModule ??= require("jiti") as JitiModule
  // jiti's own Babel transform, which its package exports don't name.
  transform ??= memoized(
    require(join(dirname(require.resolve("jiti/package.json")), "dist", "babel.cjs")) as Transform,
  )
  return jitiModule.createJiti(import.meta.url, {
    // gtd's own modules, already loaded: a config runs against the very
    // runtime replay installs its context for, never a second copy of it.
    virtualModules: { "@pmelab/gtd/flows": flows, "@pmelab/gtd/workflow": builtInWorkflow },
    // No transpile cache on disk, and a fresh module every load — nothing a
    // later command could read back instead of the source.
    fsCache: false,
    moduleCache: false,
    transform,
    // The whole module, not just its default: the named exports are read too.
    interopDefault: false,
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

/** Read a module's optional `skills` export: full step name -> skill list, mirroring `stringRecord` for the vars-shaped exports. */
const skillsRecord = (
  exports: Record<string, unknown>,
): Readonly<Record<string, readonly string[]>> => {
  const value = exports["skills"] ?? {}
  if (
    typeof value !== "object" ||
    value === null ||
    Object.values(value).some((entry) => !isStringArray(entry))
  ) {
    throw new Error(`the "skills" export is not a record of skill-name arrays`)
  }
  return value as Readonly<Record<string, readonly string[]>>
}

const optionalFunction = <T>(exports: Record<string, unknown>, name: string): T | undefined => {
  const value = exports[name]
  if (value === undefined) return undefined
  if (typeof value !== "function") throw new Error(`the "${name}" export is not a function`)
  return value as T
}

/**
 * Read a workflow module: the default export is the flow; `defaults`,
 * `summary`, `base` and `steering` are optional; any other export is ignored.
 */
const fromModule = (
  exported: unknown,
  origin: string,
  dependencyFiles: readonly string[],
): LoadedModule => {
  const exports = (typeof exported === "object" && exported !== null ? exported : {}) as Record<
    string,
    unknown
  >
  const flow = exports.default
  if (typeof flow !== "function") {
    throw new Error("the default export is not a flow — export default an async function")
  }
  return {
    flow: flow as WorkflowDefinition["flow"],
    defaults: stringRecord(exports, "defaults"),
    steering: stringRecord(exports, "steering"),
    skills: skillsRecord(exports),
    summary: optionalFunction(exports, "summary"),
    base: optionalFunction(exports, "base"),
    origin,
    dependencyFiles,
  }
}

/**
 * Evaluate `gtd.config.ts`, or take the bundled default. `cache` is jiti's
 * OWN per-call module cache (unrelated to the instance's `moduleCache:
 * false` — that governs reuse ACROSS calls, this one is populated fresh
 * DURING this one) — passing an empty object in has the side effect of
 * collecting every real file jiti resolved evaluating this module, module
 * AND every relative import it pulled in, transitively. Virtual modules
 * (`@pmelab/gtd/flows`) never touch it — no real file backs them.
 */
const loadWorkflow = (module: WorkflowModule | undefined): LoadedModule => {
  if (module === undefined) return fromModule(builtInWorkflow, BUILT_IN_ORIGIN, [])
  const cache: Record<string, unknown> = {}
  const exported = jiti().evalModule(module.source, { filename: module.filepath, cache })
  return fromModule(exported, module.filepath, Object.keys(cache))
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

const replayToFirstStep = (
  loaded: LoadedModule,
  vars: Readonly<Record<string, string>>,
  tree: TreeView,
): Effect.Effect<string, GtdError> =>
  Effect.flatMap(
    Effect.promise(() =>
      replay({
        flow: loaded.flow,
        episode: { entry: undefined, base: { hash: "", tree }, commits: [] },
        vars,
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
      return Effect.fail(new GtdError(`gtd config:\n  - ${loaded.origin}: ${problem}`))
    },
  )

/**
 * The default entry's first step — where a finished process waits — found the
 * only way a flow can be read: by replaying it over an empty history. Episode
 * boundaries are that step's commits, so it must not move with the tree: a
 * flow that reads the repository before reaching it is replayed again over
 * HEAD, and must reach the same step there.
 */
const firstStep = (
  loaded: LoadedModule,
  vars: Readonly<Record<string, string>>,
  head: TreeView,
): Effect.Effect<string, GtdError> =>
  Effect.gen(function* () {
    const empty = watchedEmptyTree()
    const name = yield* replayToFirstStep(loaded, vars, empty.tree)
    if (!empty.read()) return name
    const atHead = yield* replayToFirstStep(loaded, vars, head)
    if (atHead === name) return name
    return yield* Effect.fail(
      new GtdError(
        `gtd config:\n  - ${loaded.origin}: the flow's first step on an ordinary start depends on the repository's files ("${name}" without them, "${atHead}" at HEAD) — that step is where a finished process waits, so it must not change as files do`,
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
