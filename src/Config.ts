import { homedir } from "node:os"
import { dirname } from "node:path"
import { cosmiconfig } from "cosmiconfig"
import { parse as parseYaml } from "yaml"
import { Context, Effect, Layer, Schema } from "effect"
import { GtdError, Narrator } from "./Commentary.js"
import {
  compileModesMap,
  compileVarsMap,
  compileWorkflowConfig,
  inlineWorkflowFileRefs,
  mergeModes,
  nodeFileRefReader,
  type FileRefReader,
} from "./PatternConfig.js"
import {
  validateDefinition,
  type ModeDef,
  type StateName,
  type WorkflowDefinition,
} from "./PatternMachine.js"
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
  readonly workflow: WorkflowDefinition
  readonly workflowVars: Record<string, string>
  readonly rcVars: Record<string, string>
  /**
   * The active workflow's machine-instance tree (`flattenMachines`'s output,
   * `src/Machines.ts`), or the built-in default's tree when unconfigured.
   * Tooling that needs the machine grouping the compiled `workflow` flattens
   * away (e.g. `gtd visualize`) reads it; the pure engine never does.
   */
  readonly machineTree: MachineNode
  /** Qualified state name -> owning machine-instance path (`flattenMachines`'s other output), or the built-in default's map when unconfigured. */
  readonly stateScopes: Record<StateName, string>
  /** Non-fatal `validateDefinition` findings against the active workflow (e.g. a state with no `C` row) — `[]` for the built-in default, which ships with none. */
  readonly warnings: readonly string[]
}

/**
 * Recursively deep-merge plain objects; scalars/arrays from `inner` overwrite.
 * Hand-rolled because cosmiconfig v9's `search()` stops at the first config it
 * finds and has no native cross-level auto-merge — its only merge hook is an
 * explicit `$import` key, which would force hand-authored import chains and
 * lose the implicit cwd→home layering.
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
 * The config-DISCOVERY seam, decoupled from the parsing/merging/compiling
 * pipeline below (shared by every adapter). `levels` returns every level
 * OUTERMOST→INNERMOST, so a left-to-right `deepMerge` reduction makes the
 * innermost (closest to `root`) win, matching cosmiconfig's own precedence.
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
 * Parse one config level's raw text by extension: `.json` as JSON, everything
 * else (including the extensionless `.gtdrc`) as YAML — a JSON superset.
 * Exported so an alternative `ConfigSource` (e.g. `src/testing/`'s in-memory
 * one) parses with the SAME parsers `nodeConfigSource` gets from cosmiconfig.
 */
export const parseConfigLevel = (filepath: string, content: string): unknown =>
  filepath.endsWith(".json") ? jsonLoader(filepath, content) : yamlLoader(filepath, content)

/**
 * Detect whether a gtd config lives at THIS single directory — no `walkUp`, so
 * a global `~/.gtdrc` or an ancestor project's config does NOT count. `gtd
 * init` refuses only when it would overwrite the repo's own config, not
 * merely because a global default layer exists upstream.
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
 * Compile the top-level `modes:` key — the steering-file modes a project
 * layers over whatever the active workflow declares, so a project on the
 * BUNDLED default can plug in its own formatter/validator without
 * re-declaring the whole workflow.
 */
const compileRcModes = (raw: unknown): Record<string, ModeDef> | undefined => {
  const errors: string[] = []
  const modes = compileModesMap(raw, errors)
  if (errors.length > 0) {
    throw new Error(`gtd config:\n${errors.map((e) => `  - ${e}`).join("\n")}`)
  }
  return modes
}

/** Compile the top-level `vars:` key into the `rcVars` layer, sharing `compileVarsMap` with the workflow's own `vars:` so both validate identically. */
const compileRcVars = (raw: unknown): Record<string, string> => {
  const errors: string[] = []
  const vars = compileVarsMap(raw, errors)
  if (errors.length > 0) {
    throw new Error(`gtd config:\n${errors.map((e) => `  - ${e}`).join("\n")}`)
  }
  return vars
}

/**
 * Compile the `workflow:` key (or gtd's built-in bundled default, when
 * absent) plus the top-level `vars:`/`modes:` keys into `ConfigOperations`. A
 * custom `workflow:`'s `./`/`../` content file references were already
 * inlined per declaring file by the caller, so the compiler runs with
 * `inlineFileRefs: false`. Layering `modes:` over the built-in default can
 * only ADD mode names, never invalidate a `mode:` reference, so that path
 * needs no re-validation and never throws.
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
      // Derived from the same validator a custom `workflow:` goes through
      // (never hardcoded) — the built-in default just happens to pass clean
      // today; `modes:` merging above never touches `states`/`on`, so
      // re-validating the unmerged definition is equivalent and avoids a
      // throwaway merged copy.
      warnings: validateDefinition(defaultWorkflowDefinition).warnings,
    }
  }
  const {
    definition,
    vars: workflowVars,
    tree,
    scopes,
    warnings,
  } = compileWorkflowConfig(decoded.workflow, root, rcModes, false, fileRefs)
  return {
    workflow: definition,
    workflowVars,
    rcVars,
    machineTree: tree,
    stateScopes: scopes,
    warnings,
  }
}

/**
 * The offending top-level key(s) plus which config LAYER last set each one.
 * `keyOrigin` maps a key to the innermost level's `filepath` that declared it
 * — a key the schema rejects that no level ever set has no origin to report.
 */
const formatSchemaError = (
  e: ParseError,
  keyOrigin: Readonly<Record<string, string>>,
): GtdError => {
  const issues = ArrayFormatter.formatErrorSync(e)
  const summary = issues
    .map((i) => (i.path.length > 0 ? i.path.join(".") + ": " : "") + i.message)
    .join("; ")
  const keys = [
    ...new Set(issues.map((i) => i.path[0]).filter((k): k is PropertyKey => k !== undefined)),
  ]
  const detail = keys.map(
    (key) => `${String(key)}: ${keyOrigin[String(key)] ?? "(built-in default)"}`,
  )
  return new GtdError(`Invalid gtd config: ${summary}`, detail)
}

/**
 * Config loading is a DEFERRED effect (`load`), not an already-loaded value:
 * the layer is provided to the whole program and built eagerly, so loading
 * (and validating a custom workflow) at build time would break `gtd
 * init`/`gtd lsp` too — the two commands that must run without touching the
 * config. Deferring means a validation failure surfaces only when a command
 * actually reads the config.
 */
interface ConfigServiceOperations {
  readonly load: Effect.Effect<ConfigOperations, Error, Narrator>
}

/**
 * Build the whole config pipeline — discover levels via `source`, inline each
 * level's `./`/`../` content file references against its OWN declaring file,
 * deep-merge outermost→innermost, strip the editor-only `$schema` key, decode
 * against `ConfigSchema`, then compile — as a `ConfigService` layer. The ONE
 * place this pipeline is assembled: both `ConfigService.Live` and
 * `src/testing/`'s in-memory layer build their service through this, so an
 * `@inmem` scenario exercises the same decode/compile path production does.
 */
export const configServiceLayer = (
  source: ConfigSource,
  root: string,
  fileRefs: FileRefReader = nodeFileRefReader,
): Layer.Layer<ConfigService> => {
  const load: Effect.Effect<ConfigOperations, Error, Narrator> = Effect.gen(function* () {
    const narrator = yield* Narrator
    const levels = yield* source.levels(root)
    for (const level of levels) yield* narrator.narrate(`config: layer ${level.filepath}`)
    const refErrors: string[] = []
    const inlined = levels.map((level) =>
      inlineLevel(level.config, level.filepath, refErrors, fileRefs),
    )
    if (refErrors.length > 0) {
      return yield* Effect.fail(
        new Error(`workflow config:\n${refErrors.map((e) => `  - ${e}`).join("\n")}`),
      )
    }
    // Outermost→innermost, same order `deepMerge`'s reduction below applies —
    // a later level's key origin overwrites an earlier one's, matching
    // `deepMerge`'s own innermost-wins precedence exactly.
    const keyOrigin: Record<string, string> = {}
    for (let i = 0; i < levels.length; i++) {
      for (const key of Object.keys(inlined[i]!)) keyOrigin[key] = levels[i]!.filepath
    }
    const merged = inlined.reduce<Record<string, unknown>>(
      (acc, level) => deepMerge(acc, level),
      {},
    )
    const { $schema: _schema, ...cleaned } = merged
    const decoded = yield* Schema.decodeUnknown(ConfigSchema)(cleaned, {
      onExcessProperty: "error",
    }).pipe(Effect.mapError((e) => formatSchemaError(e, keyOrigin)))
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
