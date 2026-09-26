import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { Context, Effect, Layer, Schema } from "effect"
import { ArrayFormatter } from "effect/ParseResult"
import { GtdError, Narrator } from "../Commentary.js"
import { replay, treeFromRecord } from "../replay/index.js"
import type { Workflow } from "../flows/index.js"
import { unified as builtInWorkflow } from "../workflows/index.js"
import type { WorkflowDefinition } from "../Workflow.js"
import { Host, Workspace } from "../platform/index.js"
import { ConfigSchema, type UiConfig } from "../ConfigSchema.js"
import { compileConfig, type ConfigLayer } from "./compile.js"
import { ConfigDiscovery, flowsDir, type ConfigLevel, type WorkflowModule } from "./discovery.js"
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
    return {
      layer: { origin: level.filepath, dir: dirname(level.filepath), value: result.right },
      diagnostics: [],
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
  const decoded = yield* Effect.forEach(levels, decodeLevel)
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
  const diagnostics = dedupeDiagnostics(
    sortDiagnostics([...decodeDiagnostics, ...compiled.diagnostics], layerOrder),
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

  const initial = yield* firstStep(loaded, { ...loaded.workflow.vars, ...compiled.rcVars })
  return {
    workflow: {
      flows: loaded.workflow,
      modes: compiled.modes,
      initial,
    },
    workflowVars: { ...loaded.workflow.vars },
    rcVars: compiled.rcVars,
    ...(compiled.ui !== undefined ? { ui: compiled.ui } : {}),
    warnings: diagnostics.filter((d) => d.severity === "warning"),
  }
})

interface LoadedModule {
  readonly workflow: Workflow
  readonly origin: string
}

type JitiInstance = {
  evalModule: (source: string, options: { filename: string; async?: false }) => unknown
}
type JitiModule = {
  createJiti: (id: string, options: Record<string, unknown>) => JitiInstance
}

// Loaded on first use: only a repository with its own gtd.config.ts needs it.
let jitiModule: JitiModule | undefined
const jiti = (): JitiInstance => {
  jitiModule ??= createRequire(import.meta.url)("jiti") as JitiModule
  return jitiModule.createJiti(import.meta.url, {
    alias: { "@pmelab/gtd/flows": join(flowsDir(), "index.ts") },
    // No transpile cache on disk, and a fresh module every load — nothing a
    // later command could read back instead of the source.
    fsCache: false,
    moduleCache: false,
    interopDefault: true,
  })
}

const isWorkflow = (value: unknown): value is Workflow =>
  typeof value === "object" &&
  value !== null &&
  (value as { kind?: unknown }).kind === "gtd-workflow"

/** Evaluate `gtd.config.ts`, or take the bundled default. */
const loadWorkflow = (module: WorkflowModule | undefined): LoadedModule => {
  if (module === undefined) return { workflow: builtInWorkflow, origin: BUILT_IN_ORIGIN }
  const exported = jiti().evalModule(module.source, { filename: module.filepath })
  const workflow = (exported as { default?: unknown }).default ?? exported
  if (!isWorkflow(workflow)) {
    throw new Error('the default export is not a workflow(...) from "@pmelab/gtd/flows"')
  }
  return { workflow, origin: module.filepath }
}

/**
 * The default entry's first step — where a finished process waits — found the
 * only way a flow can be read: by replaying it over an empty history.
 */
const firstStep = (
  loaded: LoadedModule,
  vars: Readonly<Record<string, string>>,
): Effect.Effect<string, GtdError> =>
  Effect.flatMap(
    Effect.promise(() =>
      replay({
        workflow: loaded.workflow,
        episode: { entry: undefined, base: { hash: "", tree: treeFromRecord({}) }, commits: [] },
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
