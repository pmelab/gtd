import { dirname } from "node:path"
import { Context, Effect, Layer, Schema } from "effect"
import { ArrayFormatter } from "effect/ParseResult"
import { GtdError, Narrator } from "../Commentary.js"
import type { StateName, WorkflowDefinition } from "../PatternMachine.js"
import type { EachSource, InstancePath, MachineNode } from "../Machines.js"
import { Host, Workspace } from "../platform/index.js"
import { ConfigSchema, type UiConfig } from "../ConfigSchema.js"
import { compileWorkflow, type ConfigLayer } from "./compile.js"
import { ConfigDiscovery, type ConfigLevel } from "./discovery.js"
import {
  dedupeDiagnostics,
  formatDiagnostic,
  sortDiagnostics,
  type Diagnostic,
} from "./Diagnostic.js"
import type { WorkflowFiles } from "./WorkflowFiles.js"

export interface ConfigOperations {
  readonly workflow: WorkflowDefinition
  readonly workflowVars: Record<string, string>
  readonly rcVars: Record<string, string>
  /** The active workflow's machine-instance tree, or the built-in default's tree when unconfigured. Tooling that needs the machine grouping the compiled `workflow` flattens away (e.g. `gtd visualize`) reads it; the pure engine never does. */
  readonly machineTree: MachineNode
  /** Qualified state name -> owning machine-instance path, or the built-in default's map when unconfigured. */
  readonly stateScopes: Record<StateName, string>
  /** Every `each:` reference's own source declaration, keyed by reference path — `src/Edge.ts` resolves these into item tokens (it needs the `Workspace`, which the pure engine never touches). `{}` when unconfigured or no `each:` is declared. */
  readonly eachSources: Record<InstancePath, EachSource>
  /** The top-level `ui:` key, decoded as-is (absent when unconfigured) — `gtd ui` and its CLI flags read it. */
  readonly ui?: UiConfig
  /**
   * Non-fatal findings against the active workflow (e.g. a state with no `C`
   * row) — `[]` for the built-in default, which ships with none. Full
   * `Diagnostic`s (origin + config path), not bare strings — a caller
   * printing one should go through `formatDiagnostic`, the same as an error.
   */
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
  const workspace = yield* Workspace
  const host = yield* Host
  const discovery = yield* ConfigDiscovery
  const levels = yield* discovery.levels(host.root, host.home)
  for (const level of levels) yield* narrator.narrate(`config: layer ${level.filepath}`)
  const decoded = yield* Effect.forEach(levels, decodeLevel)
  const layers = decoded.flatMap((d) => (d.layer !== undefined ? [d.layer] : []))
  const decodeDiagnostics = decoded.flatMap((d) => d.diagnostics)

  const files: WorkflowFiles = { read: workspace.atPath }
  const compiled = compileWorkflow(layers, files)

  const layerOrder = levels.map((level) => level.filepath)
  const diagnostics = dedupeDiagnostics(
    sortDiagnostics([...decodeDiagnostics, ...compiled.diagnostics], layerOrder),
  )

  const fatal = diagnostics.filter((d) => d.severity === "error")
  if (fatal.length > 0) {
    const lines = fatal.map(formatDiagnostic)
    // Everything lives in `message` (not `GtdError.detail`) — `renderFailure`
    // (`src/Commentary.ts`) prints `message` verbatim (once already
    // `gtd`-prefixed) and then ADDS one indented line per `detail` entry, so
    // duplicating these lines into `detail` too would print each finding
    // twice. Each line is one finding's `<origin>: <path>: <message>` —
    // structured, replacing the old single prose blob.
    return yield* Effect.fail(
      new GtdError(`gtd config:\n${lines.map((line) => `  - ${line}`).join("\n")}`),
    )
  }

  return {
    workflow: compiled.workflow,
    workflowVars: compiled.workflowVars,
    rcVars: compiled.rcVars,
    ...(compiled.ui !== undefined ? { ui: compiled.ui } : {}),
    machineTree: compiled.machineTree,
    stateScopes: compiled.stateScopes,
    eachSources: compiled.eachSources,
    warnings: diagnostics.filter((d) => d.severity === "warning"),
  }
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
