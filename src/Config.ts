import { homedir } from "node:os"
import { dirname } from "node:path"
import { cosmiconfig } from "cosmiconfig"
import { parse as parseYaml } from "yaml"
import { Context, Effect, Layer, Schema } from "effect"

/**
 * Planning/execution states a model can be resolved for.
 * `spec-review` and `spec-fix` drive the per-package spec-review gate;
 * `agenticReview` / `agenticReviewMaxCycles` act as the kill-switch and
 * per-package cycle cap for that gate.
 *
 * New machine states (`grilling`, `building`, `fixing`, `agentic-review`,
 * `clean`) are additive — old keys kept for backward compatibility until cutover.
 */
export type ModelState =
  | "new-todo"
  | "modified-todo"
  | "decompose"
  | "execute"
  | "spec-review"
  | "spec-fix"
  | "grilling"
  | "building"
  | "fixing"
  | "agentic-review"
  | "clean"

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
  "spec-review": "planning",
  "spec-fix": "execution",
  // New machine states (additive)
  grilling: "planning",
  building: "execution",
  fixing: "execution",
  "agentic-review": "planning",
  clean: "planning",
}

/** Built-in tier defaults, used when nothing is configured. */
export const builtinTierDefault: Record<ModelTier, string> = {
  planning: "claude-opus-4-8",
  execution: "claude-sonnet-4-8",
}

const DEFAULT_TEST_COMMAND = "npm run test"
const DEFAULT_AGENTIC_REVIEW = true
const DEFAULT_AGENTIC_REVIEW_MAX_CYCLES = 3
const DEFAULT_FIX_ATTEMPT_CAP = 3
const DEFAULT_REVIEW_THRESHOLD = 3

// Closed struct for models.states: known keys only, each optional.
// Using a plain Struct (not Record) means unknown keys are rejected during
// decode rather than silently stripped.
const ModelStatesSchema = Schema.Struct({
  // Legacy keys (old pipeline — kept until cutover)
  "new-todo": Schema.optional(Schema.String),
  "modified-todo": Schema.optional(Schema.String),
  decompose: Schema.optional(Schema.String),
  execute: Schema.optional(Schema.String),
  "spec-review": Schema.optional(Schema.String),
  "spec-fix": Schema.optional(Schema.String),
  // New machine state keys (additive)
  grilling: Schema.optional(Schema.String),
  building: Schema.optional(Schema.String),
  fixing: Schema.optional(Schema.String),
  "agentic-review": Schema.optional(Schema.String),
  clean: Schema.optional(Schema.String),
})

const ModelsSchema = Schema.Struct({
  planning: Schema.optional(Schema.String),
  execution: Schema.optional(Schema.String),
  states: Schema.optional(ModelStatesSchema),
})

const ConfigSchema = Schema.Struct({
  testCommand: Schema.optional(Schema.String),
  models: Schema.optional(ModelsSchema),
  agenticReview: Schema.optional(Schema.Boolean),
  agenticReviewMaxCycles: Schema.optional(Schema.Number),
  fixAttemptCap: Schema.optional(Schema.Number),
  reviewThreshold: Schema.optional(Schema.Number),
})

type DecodedConfig = Schema.Schema.Type<typeof ConfigSchema>

export interface ConfigOperations {
  readonly testCommand: string
  readonly resolveModel: (state: ModelState) => string
  readonly agenticReview: boolean
  readonly agenticReviewMaxCycles: number
  readonly fixAttemptCap: number
  readonly reviewThreshold: number
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

const yamlLoader = (_filepath: string, content: string): unknown => parseYaml(content) as unknown

const jsonLoader = (_filepath: string, content: string): unknown => JSON.parse(content) as unknown

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

    return levels.reduce<Record<string, unknown>>((acc, level) => deepMerge(acc, level), {})
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
    agenticReview: decoded.agenticReview ?? DEFAULT_AGENTIC_REVIEW,
    agenticReviewMaxCycles: decoded.agenticReviewMaxCycles ?? DEFAULT_AGENTIC_REVIEW_MAX_CYCLES,
    fixAttemptCap: decoded.fixAttemptCap ?? DEFAULT_FIX_ATTEMPT_CAP,
    reviewThreshold: decoded.reviewThreshold ?? DEFAULT_REVIEW_THRESHOLD,
  }
}

export class ConfigService extends Context.Tag("ConfigService")<ConfigService, ConfigOperations>() {
  static Live = Layer.effect(
    ConfigService,
    Effect.gen(function* () {
      const merged = yield* loadMerged()
      const decoded = yield* Schema.decodeUnknown(ConfigSchema)(merged, {
        onExcessProperty: "error",
      }).pipe(Effect.mapError((e) => new Error(`Invalid gtd config: ${String(e.message ?? e)}`)))
      return toOperations(decoded)
    }),
  )
}
