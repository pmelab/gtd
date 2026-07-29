import { homedir } from "node:os"
import { dirname } from "node:path"
import { cosmiconfig } from "cosmiconfig"
import { parse as parseYaml } from "yaml"
import { Context, Effect, Layer, Schema } from "effect"
import {
  compileModesMap,
  compileVarsMap,
  compileWorkflowConfig,
  inlineWorkflowFileRefs,
  mergeModes,
} from "./PatternConfig.js"
import { type ModeDef, type WorkflowDefinition } from "./PatternMachine.js"
import {
  defaultWorkflowDefinition,
  defaultWorkflowRaw,
  defaultWorkflowVars,
} from "./workflows/templates.js"
import { Cwd } from "./Cwd.js"
import { ArrayFormatter, ParseError } from "effect/ParseResult"
import { ConfigSchema, type DecodedConfig } from "./ConfigSchema.js"

export interface ConfigOperations {
  /** The active workflow definition — the `.gtdrc` `workflow:` key compiled through `compileWorkflowConfig`, or gtd's built-in bundled default when no `workflow:` key is configured (see `toOperations`). */
  readonly workflow: WorkflowDefinition
  /** The active workflow's own declared `vars:` defaults (layer 1 of the merged `it.vars` — see `src/Edge.ts`'s `resolveVars`). `defaultWorkflowVars` for the built-in default. */
  readonly workflowVars: Record<string, string>
  /** The top-level `.gtdrc` `vars:` key (layer 2), already cwd→home deep-merged like any other config key. `{}` when absent. */
  readonly rcVars: Record<string, string>
  /**
   * The active workflow's RAW value — the `.gtdrc` `workflow:` key BEFORE
   * `compileWorkflowConfig` expands/compiles it (so it still carries any
   * `submachines:`/`use:`), or the built-in default's raw (`defaultWorkflowRaw`)
   * when no `workflow:` is configured. Tooling that needs the sub-machine
   * grouping the compiled `workflow` flattens away (e.g. `gtd visualize`) reads
   * it via `collectGroups`; the engine never does.
   */
  readonly rawWorkflow: unknown
}

/**
 * Recursively deep-merge plain objects; scalars/arrays from `inner` overwrite.
 * Hand-rolled because cosmiconfig v9 `search()` stops at the FIRST config it
 * finds and has no native cross-level auto-merge. Its only merge hook is the
 * explicit `$import` key, which would force users to hand-author import chains
 * and lose the implicit cwd→home layering. The manual `walkUp` + `deepMerge`
 * with innermost-wins semantics is therefore intentional.
 */
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const deepMerge = (
  base: Record<string, unknown>,
  inner: Record<string, unknown>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...base }
  for (const [key, innerVal] of Object.entries(inner)) {
    const baseVal = out[key]
    if (isPlainObject(baseVal) && isPlainObject(innerVal)) {
      out[key] = deepMerge(baseVal, innerVal)
    } else {
      out[key] = innerVal
    }
  }
  return out
}

/**
 * Enumerate the directory chain from `from` walking UP. Stops after including
 * the user's home dir (inclusive, when it is an ancestor) or after reaching the
 * filesystem root — whichever comes first. Returned innermost→outermost.
 */
const walkUp = (from: string, home: string): ReadonlyArray<string> => {
  const chain: Array<string> = []
  let dir = from
  while (true) {
    chain.push(dir)
    if (dir === home) break
    const parent = dirname(dir)
    if (parent === dir) break // filesystem root
    dir = parent
  }
  return chain
}

const yamlLoader = (filepath: string, content: string): unknown => {
  let result: unknown
  try {
    result = parseYaml(content) as unknown
  } catch (e) {
    throw new Error(`${filepath}: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (result === null) {
    throw new Error(`${filepath}: config must be a plain object, got null`)
  }
  return result
}

const jsonLoader = (filepath: string, content: string): unknown => {
  let result: unknown
  try {
    result = JSON.parse(content) as unknown
  } catch (e) {
    throw new Error(`${filepath}: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (result === null) {
    throw new Error(`${filepath}: config must be a plain object, got null`)
  }
  return result
}

const SEARCH_PLACES = [
  ".gtdrc",
  ".gtdrc.json",
  ".gtdrc.yaml",
  ".gtdrc.yml",
  "gtd.config.json",
  "gtd.config.yaml",
]

/**
 * The shared cosmiconfig explorer used by every config lookup. `searchStrategy:
 * 'none'` makes `.search(dir)` inspect only that single directory (no internal
 * walking), so callers drive the cwd→home walk themselves via `walkUp`.
 */
const makeExplorer = () =>
  cosmiconfig("gtd", {
    searchPlaces: SEARCH_PLACES,
    searchStrategy: "none",
    loaders: {
      noExt: yamlLoader, // .gtdrc (extensionless) — YAML is a JSON superset
      ".json": jsonLoader,
      ".yaml": yamlLoader,
      ".yml": yamlLoader,
    },
  })

/**
 * Load and deep-merge every config level from cwd up the directory chain.
 * Innermost (cwd) wins. Returns the merged plain object (undecoded).
 *
 * A `workflow:` value's `./`/`../` content file references are inlined PER
 * LEVEL against that level's OWN file directory (`dirname(result.filepath)`)
 * BEFORE merging — because the deep-merge collapses every level into one
 * anonymous object and erases which file each `states.x.prompt` came from.
 * Resolving up front is what lets a `.gtdrc` stored in a parent directory
 * reference `./gtd-prompts/x.md` and have it resolve against the parent, even
 * though gtd runs from a child repo (a different cwd). Any missing/unreadable
 * reference is collected and thrown as one aggregated `workflow config:` error,
 * exactly like the compiler's own resolution. The merged, already-inlined
 * `workflow:` is later compiled with `inlineFileRefs: false` (see
 * `toOperations`).
 */
/**
 * Normalize one loaded config level: validate it is a plain object, then inline
 * its `workflow:` file references against its OWN file's directory (collecting
 * any missing/unreadable reference into `refErrors`). A level with no
 * `workflow:` key passes through untouched.
 */
const inlineLevel = (
  config: unknown,
  filepath: string,
  refErrors: string[],
): Record<string, unknown> => {
  if (!isPlainObject(config)) {
    throw new Error(
      `${filepath}: config must be a plain object, got ${Array.isArray(config) ? "array" : String(config)}`,
    )
  }
  if (config["workflow"] === undefined) return config
  return {
    ...config,
    workflow: inlineWorkflowFileRefs(config["workflow"], dirname(filepath), refErrors),
  }
}

/** Read every config level from cwd up the chain, outermost→innermost, each with its file references already inlined per declaring file. Throws on a malformed level or an aggregated set of bad references. */
const readConfigLevels = async (root: string): Promise<Array<Record<string, unknown>>> => {
  const chain = walkUp(root, homedir())
  const explorer = makeExplorer()
  const levels: Array<Record<string, unknown>> = []
  const refErrors: string[] = []
  // Outermost→innermost so merging in order makes innermost win.
  for (let i = chain.length - 1; i >= 0; i--) {
    const result = await explorer.search(chain[i])
    if (!result || result.isEmpty) continue
    levels.push(inlineLevel(result.config, result.filepath, refErrors))
  }
  if (refErrors.length > 0) {
    throw new Error(`workflow config:\n${refErrors.map((e) => `  - ${e}`).join("\n")}`)
  }
  return levels
}

const loadMerged = (root: string): Effect.Effect<Record<string, unknown>, Error> =>
  Effect.tryPromise({
    try: async () => {
      const levels = await readConfigLevels(root)
      return levels.reduce<Record<string, unknown>>((acc, level) => deepMerge(acc, level), {})
    },
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

/**
 * Detect whether a gtd config lives at THIS single directory — no `walkUp`, so
 * a global `~/.gtdrc` or an ancestor project's config does NOT count. Exported
 * so `gtd init` (src/program.ts) refuses only when it would overwrite the
 * repo's OWN config, not when a global default layer merely exists upstream.
 */
export const configPresentAt = (dir: string): Effect.Effect<boolean, Error> =>
  Effect.tryPromise({
    try: async () => {
      const result = await makeExplorer().search(dir)
      return Boolean(result && !result.isEmpty)
    },
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

/**
 * Compile the decoded config's top-level `modes:` key — the steering-file modes
 * a project layers over whatever the active workflow declares (and over gtd's
 * built-in `qa`/`review` validators), so a project on the BUNDLED default can
 * plug in its own formatter/validator without re-declaring the whole workflow.
 * Shares `PatternConfig.ts`'s `compileModesMap` with the workflow-level
 * `modes:` so both layers validate identically, and throws the same aggregated
 * error shape as `compileRcVars` on any bad entry.
 */
const compileRcModes = (raw: unknown): Record<string, ModeDef> | undefined => {
  const errors: string[] = []
  const modes = compileModesMap(raw, errors)
  if (errors.length > 0) {
    throw new Error(`gtd config:\n${errors.map((e) => `  - ${e}`).join("\n")}`)
  }
  return modes
}

/**
 * Compile the decoded config's top-level `vars:` key into the `rcVars` layer,
 * sharing `PatternConfig.ts`'s `compileVarsMap` with the workflow's own
 * `vars:` so both layers validate identically (scalar coercion, object/array
 * rejection). Throws a single aggregated `Error` on any bad entry — same
 * "collected, never partial" discipline as `compileWorkflowConfig`.
 */
const compileRcVars = (raw: unknown): Record<string, string> => {
  const errors: string[] = []
  const vars = compileVarsMap(raw, errors)
  if (errors.length > 0) {
    throw new Error(`gtd config:\n${errors.map((e) => `  - ${e}`).join("\n")}`)
  }
  return vars
}

/**
 * Compile the decoded config's `workflow:` key (or gtd's built-in bundled
 * default, when absent) plus its top-level `vars:`/`modes:` keys into
 * `ConfigOperations`. A custom `workflow:`'s `./`/`../` content file references
 * were already inlined per declaring file by `loadMerged`, so the compiler is
 * invoked with `inlineFileRefs: false` and `root` is passed only as an (unused)
 * `configDir` placeholder.
 *
 * When no `workflow:` key is configured anywhere in the cwd→home chain, the
 * built-in default (`defaultWorkflowDefinition`, pre-compiled and validated
 * once at module load) is used. Layering the top-level `modes:` over it can
 * only ADD mode names (never invalidate a `mode:` reference), so it needs no
 * re-validation. Throws (via `compileWorkflowConfig`/`compileRcVars`) only on
 * an invalid CUSTOM workflow/vars; the built-in default never throws here.
 */
const toOperations = (decoded: DecodedConfig, root: string): ConfigOperations => {
  const rcVars = compileRcVars(decoded.vars)
  const rcModes = compileRcModes(decoded.modes)
  if (decoded.workflow === undefined) {
    const modes = mergeModes(defaultWorkflowDefinition.modes, rcModes)
    return {
      workflow:
        modes !== undefined ? { ...defaultWorkflowDefinition, modes } : defaultWorkflowDefinition,
      workflowVars: defaultWorkflowVars,
      rcVars,
      rawWorkflow: defaultWorkflowRaw,
    }
  }
  const { definition, vars: workflowVars } = compileWorkflowConfig(
    decoded.workflow,
    root,
    rcModes,
    false,
  )
  return { workflow: definition, workflowVars, rcVars, rawWorkflow: decoded.workflow }
}

const formatSchemaError = (e: ParseError): string => {
  const issues = ArrayFormatter.formatErrorSync(e)
  const summary = issues
    .map((i) => (i.path.length > 0 ? i.path.join(".") + ": " : "") + i.message)
    .join("; ")
  return `Invalid gtd config: ${summary}`
}

/**
 * The service interface. Config loading is exposed as a DEFERRED effect
 * (`load`) rather than an already-loaded `ConfigOperations` value: the layer
 * is provided to the whole program (see `main.ts`), which builds it eagerly,
 * so if it loaded (and validated a CUSTOM workflow) at BUILD time, a
 * config-validation failure would break `gtd init` and `gtd lsp` too — the two
 * commands that must run without touching the config. Deferring to `load` means
 * any such failure surfaces only when a command actually reads the config. (An
 * absent `workflow:` no longer fails at all — the built-in default is used.)
 */
interface ConfigServiceOperations {
  readonly load: Effect.Effect<ConfigOperations, Error>
}

export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  ConfigServiceOperations
>() {
  static Live = Layer.effect(
    ConfigService,
    Effect.gen(function* () {
      const { root } = yield* Cwd
      const load: Effect.Effect<ConfigOperations, Error> = Effect.gen(function* () {
        const merged = yield* loadMerged(root)
        const { $schema: _schema, ...cleaned } = merged
        const decoded = yield* Schema.decodeUnknown(ConfigSchema)(cleaned, {
          onExcessProperty: "error",
        })
          .pipe(Effect.mapError(formatSchemaError))
          .pipe(Effect.mapError((msg) => new Error(msg)))
        return yield* Effect.try({
          try: () => toOperations(decoded, root),
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        })
      })
      return { load }
    }),
  )
}
