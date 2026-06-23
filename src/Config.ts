import { homedir } from "node:os"
import { dirname } from "node:path"
import { cosmiconfig } from "cosmiconfig"
import { parse as parseYaml } from "yaml"
import { Context, Effect, Layer, Schema } from "effect"

/** The five planning/execution states a model can be resolved for. */
export type ModelState =
  | "new-todo"
  | "modified-todo"
  | "decompose"
  | "execute"
  | "execute-simple"

/** Which tier a state belongs to. The single source of state→tier mapping. */
export type ModelTier = "planning" | "execution"

/**
 * State→tier mapping, exported so later packages can reuse it. `resolveModel`
 * remains the single source of truth for the full resolution algorithm.
 */
export const stateTier: Record<ModelState, ModelTier> = {
  "new-todo": "planning",
  "modified-todo": "planning",
  decompose: "planning",
  execute: "execution",
  "execute-simple": "execution",
}

/** Built-in tier defaults, used when nothing is configured. */
export const builtinTierDefault: Record<ModelTier, string> = {
  planning: "claude-opus-4-8",
  execution: "claude-sonnet-4-8",
}

const DEFAULT_TEST_COMMAND = "npm run test"

// Closed struct for models.states: exactly the five known keys, each optional.
// Using a plain Struct (not Record) means unknown keys are rejected during
// decode rather than silently stripped.
const ModelStatesSchema = Schema.Struct({
  "new-todo": Schema.optional(Schema.String),
  "modified-todo": Schema.optional(Schema.String),
  decompose: Schema.optional(Schema.String),
  execute: Schema.optional(Schema.String),
  "execute-simple": Schema.optional(Schema.String),
})

const ModelsSchema = Schema.Struct({
  planning: Schema.optional(Schema.String),
  execution: Schema.optional(Schema.String),
  states: Schema.optional(ModelStatesSchema),
})

const ConfigSchema = Schema.Struct({
  testCommand: Schema.optional(Schema.String),
  models: Schema.optional(ModelsSchema),
})

type DecodedConfig = Schema.Schema.Type<typeof ConfigSchema>

export interface ConfigOperations {
  readonly testCommand: string
  readonly resolveModel: (state: ModelState) => string
}

/** Recursively deep-merge plain objects; scalars/arrays from `inner` overwrite. */
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

const yamlLoader = (_filepath: string, content: string): unknown =>
  parseYaml(content) as unknown

const jsonLoader = (_filepath: string, content: string): unknown =>
  JSON.parse(content) as unknown

const SEARCH_PLACES = [
  ".gtdrc",
  ".gtdrc.json",
  ".gtdrc.yaml",
  ".gtdrc.yml",
  "gtd.config.json",
  "gtd.config.yaml",
]

/**
 * Load and deep-merge every config level from cwd up the directory chain.
 * Innermost (cwd) wins. Returns the merged plain object (undecoded).
 */
const loadMerged = (): Effect.Effect<Record<string, unknown>> =>
  Effect.promise(async () => {
    const home = homedir()
    const chain = walkUp(process.cwd(), home)

    // `searchStrategy: 'none'` makes `.search(dir)` inspect only that single
    // directory (no internal walking), so we collect every level deterministically.
    const explorer = cosmiconfig("gtd", {
      searchPlaces: SEARCH_PLACES,
      searchStrategy: "none",
      loaders: {
        noExt: yamlLoader, // .gtdrc (extensionless) — YAML is a JSON superset
        ".json": jsonLoader,
        ".yaml": yamlLoader,
        ".yml": yamlLoader,
      },
    })

    // Collect outermost→innermost so merging in order makes innermost win.
    const levels: Array<Record<string, unknown>> = []
    for (let i = chain.length - 1; i >= 0; i--) {
      const dir = chain[i]
      const result = await explorer.search(dir)
      if (result && !result.isEmpty && isPlainObject(result.config)) {
        levels.push(result.config)
      }
    }

    return levels.reduce<Record<string, unknown>>(
      (acc, level) => deepMerge(acc, level),
      {},
    )
  })

const toOperations = (decoded: DecodedConfig): ConfigOperations => {
  const resolveModel = (state: ModelState): string => {
    const stateOverride = decoded.models?.states?.[state]
    if (stateOverride !== undefined) return stateOverride

    const tier = stateTier[state]
    const tierOverride = tier === "planning" ? decoded.models?.planning : decoded.models?.execution
    if (tierOverride !== undefined) return tierOverride

    return builtinTierDefault[tier]
  }

  return {
    testCommand: decoded.testCommand ?? DEFAULT_TEST_COMMAND,
    resolveModel,
  }
}

export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  ConfigOperations
>() {
  static Live = Layer.effect(
    ConfigService,
    Effect.gen(function* () {
      const merged = yield* loadMerged()
      const decoded = yield* Schema.decodeUnknown(ConfigSchema)(merged, {
        onExcessProperty: "error",
      }).pipe(
        Effect.mapError(
          (e) => new Error(`Invalid gtd config: ${String(e.message ?? e)}`),
        ),
      )
      return toOperations(decoded)
    }),
  )
}
