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
  nodeFileRefReader,
  type FileRefReader,
} from "./PatternConfig.js"
import { type ModeDef, type StateName, type WorkflowDefinition } from "./PatternMachine.js"
import type { MachineNode } from "./Machines.js"
import {
  defaultMachineTree,
  defaultStateScopes,
  defaultWorkflowDefinition,
  defaultWorkflowVars,
} from "./workflows/templates.js"
import { Cwd } from "./Cwd.js"
import { ArrayFormatter, ParseError } from "effect/ParseResult"
import { ConfigSchema, type DecodedConfig } from "./ConfigSchema.js"

interface ConfigOperations {
  /** The active workflow definition — the `.gtdrc` `workflow:` key compiled through `compileWorkflowConfig`, or gtd's built-in bundled default when no `workflow:` key is configured (see `toOperations`). */
  readonly workflow: WorkflowDefinition
  /** The active workflow's own declared `vars:` defaults (layer 1 of the merged `it.vars` — see `src/Edge.ts`'s `resolveVars`). `defaultWorkflowVars` for the built-in default. */
  readonly workflowVars: Record<string, string>
  /** The top-level `.gtdrc` `vars:` key (layer 2), already cwd→home deep-merged like any other config key. `{}` when absent. */
  readonly rcVars: Record<string, string>
  /**
   * The active workflow's machine-instance tree — the compilation OUTPUT
   * `flattenMachines` (`src/Machines.ts`) built while compiling the `.gtdrc`
   * `workflow:` key, or the built-in default's tree (`defaultMachineTree`)
   * when no `workflow:` is configured. Tooling that needs the machine grouping
   * the compiled `workflow` flattens away (e.g. `gtd visualize`) reads it; the
   * pure engine never does.
   */
  readonly machineTree: MachineNode
  /**
   * The active workflow's memory-scope map — qualified state name -> the
   * machine-instance path that owns it, the compilation OUTPUT
   * `flattenMachines` (`src/Machines.ts`) built while compiling the `.gtdrc`
   * `workflow:` key (`CompiledWorkflowConfig.scopes`), or the built-in
   * default's map (`defaultStateScopes`) when no `workflow:` is configured.
   */
  readonly stateScopes: Record<StateName, string>
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

export const SEARCH_PLACES = [
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
 * Normalize one loaded config level: validate it is a plain object, then inline
 * its `workflow:` file references against its OWN file's directory (collecting
 * any missing/unreadable reference into `refErrors`). A level with no
 * `workflow:` key passes through untouched.
 */
const inlineLevel = (
  config: unknown,
  filepath: string,
  refErrors: string[],
  fileRefs: FileRefReader = nodeFileRefReader,
): Record<string, unknown> => {
  if (!isPlainObject(config)) {
    throw new Error(
      `${filepath}: config must be a plain object, got ${Array.isArray(config) ? "array" : String(config)}`,
    )
  }
  if (config["workflow"] === undefined) return config
  return {
    ...config,
    workflow: inlineWorkflowFileRefs(config["workflow"], dirname(filepath), refErrors, fileRefs),
  }
}

/**
 * One config level's file path (used to resolve `./`/`../` content file
 * references) plus its raw, parsed-but-undecoded content.
 */
export interface ConfigLevel {
  readonly filepath: string
  readonly config: unknown
}

/**
 * The config-DISCOVERY seam: where a `.gtdrc` lives and what it contains,
 * decoupled from the parsing/merging/compiling pipeline below (which is
 * shared by every adapter). `levels` returns every level from the most
 * specific up to the most general, OUTERMOST→INNERMOST — so a plain
 * left-to-right `deepMerge` reduction makes the innermost (closest to `root`)
 * win, matching cosmiconfig's own cwd→home precedence.
 */
export interface ConfigSource {
  readonly levels: (root: string) => Effect.Effect<ReadonlyArray<ConfigLevel>, Error>
}

/** The production adapter: cosmiconfig's search, walked from `root` up through the user's home directory (`walkUp`). */
const nodeConfigSource: ConfigSource = {
  levels: (root: string) =>
    Effect.tryPromise({
      try: async () => {
        const chain = walkUp(root, homedir())
        const explorer = makeExplorer()
        const levels: ConfigLevel[] = []
        // Outermost→innermost so merging in order makes innermost win.
        for (let i = chain.length - 1; i >= 0; i--) {
          const result = await explorer.search(chain[i])
          if (!result || result.isEmpty) continue
          levels.push({ filepath: result.filepath, config: result.config })
        }
        return levels
      },
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    }),
}

/**
 * Parse one config level's raw text by its file extension: `.json` as JSON,
 * everything else (including the extensionless `.gtdrc`) as YAML — a JSON
 * superset — mirroring `makeExplorer`'s own loader dispatch. Exported so an
 * alternative `ConfigSource` (e.g. `src/testing/`'s in-memory one) parses with
 * the SAME parsers `nodeConfigSource` gets from cosmiconfig, rather than a
 * bare `parse`.
 */
export const parseConfigLevel = (filepath: string, content: string): unknown =>
  filepath.endsWith(".json") ? jsonLoader(filepath, content) : yamlLoader(filepath, content)

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
const toOperations = (
  decoded: DecodedConfig,
  root: string,
  fileRefs: FileRefReader = nodeFileRefReader,
): ConfigOperations => {
  const rcVars = compileRcVars(decoded.vars)
  const rcModes = compileRcModes(decoded.modes)
  if (decoded.workflow === undefined) {
    const modes = mergeModes(defaultWorkflowDefinition.modes, rcModes)
    return {
      workflow:
        modes !== undefined ? { ...defaultWorkflowDefinition, modes } : defaultWorkflowDefinition,
      workflowVars: defaultWorkflowVars,
      rcVars,
      machineTree: defaultMachineTree,
      stateScopes: defaultStateScopes,
    }
  }
  const {
    definition,
    vars: workflowVars,
    tree,
    scopes,
  } = compileWorkflowConfig(decoded.workflow, root, rcModes, false, fileRefs)
  return { workflow: definition, workflowVars, rcVars, machineTree: tree, stateScopes: scopes }
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

/**
 * Build the whole config pipeline — discover levels via `source`, inline each
 * level's `./`/`../` content file references against its OWN declaring file
 * (via `fileRefs`), deep-merge outermost→innermost, strip the editor-only
 * `$schema` key, decode against `ConfigSchema`, then compile — as a
 * `ConfigService` layer. The ONE place this pipeline is assembled: both
 * `ConfigService.Live` (`nodeConfigSource` + `nodeFileRefReader`) and
 * `src/testing/`'s in-memory layer (a repo-backed source + reader) build
 * their service through this, so an `@inmem` scenario exercises the SAME
 * decode/compile path production does — including `ConfigSchema`'s
 * `onExcessProperty: "error"`, which the in-memory tier used to skip
 * entirely.
 */
export const configServiceLayer = (
  source: ConfigSource,
  root: string,
  fileRefs: FileRefReader = nodeFileRefReader,
): Layer.Layer<ConfigService> => {
  const load: Effect.Effect<ConfigOperations, Error> = Effect.gen(function* () {
    const levels = yield* source.levels(root)
    const refErrors: string[] = []
    const inlined = levels.map((level) =>
      inlineLevel(level.config, level.filepath, refErrors, fileRefs),
    )
    if (refErrors.length > 0) {
      return yield* Effect.fail(
        new Error(`workflow config:\n${refErrors.map((e) => `  - ${e}`).join("\n")}`),
      )
    }
    const merged = inlined.reduce<Record<string, unknown>>(
      (acc, level) => deepMerge(acc, level),
      {},
    )
    const { $schema: _schema, ...cleaned } = merged
    const decoded = yield* Schema.decodeUnknown(ConfigSchema)(cleaned, {
      onExcessProperty: "error",
    })
      .pipe(Effect.mapError(formatSchemaError))
      .pipe(Effect.mapError((msg) => new Error(msg)))
    return yield* Effect.try({
      try: () => toOperations(decoded, root, fileRefs),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    })
  })
  return Layer.succeed(ConfigService, { load })
}

export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  ConfigServiceOperations
>() {
  static Live = Layer.unwrapEffect(
    Cwd.pipe(Effect.map(({ root }) => configServiceLayer(nodeConfigSource, root))),
  )
}
