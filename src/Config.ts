import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { cosmiconfig } from "cosmiconfig"
import { parse as parseYaml } from "yaml"
import { Context, Effect, Layer, Schema } from "effect"
import { Command, CommandExecutor } from "@effect/platform"
import { Cwd } from "./Cwd.js"
import { ArrayFormatter, ParseError } from "effect/ParseResult"

/**
 * Planning/execution states a model can be resolved for — the machine's
 * agent-bearing states. The two decompose states (`grilled`, `planning`) share
 * the `decompose` tier; the rest map per `stateTier`. `agenticReview` is the
 * kill-switch for the agentic-review gate.
 */
export type ModelState =
  | "decompose"
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
  decompose: "planning",
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
const DEFAULT_SQUASH = true
const DEFAULT_FIX_ATTEMPT_CAP = 3
const DEFAULT_REVIEW_THRESHOLD = 3

// Closed struct for models.states: known keys only, each optional.
// Using a plain Struct (not Record) means unknown keys are rejected during
// decode rather than silently stripped.
const ModelStatesSchema = Schema.Struct({
  decompose: Schema.optional(Schema.String),
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

export const ConfigSchema = Schema.Struct({
  testCommand: Schema.optional(Schema.String),
  models: Schema.optional(ModelsSchema),
  agenticReview: Schema.optional(Schema.Boolean),
  squash: Schema.optional(Schema.Boolean),
  fixAttemptCap: Schema.optional(Schema.Int.pipe(Schema.greaterThanOrEqualTo(0))),
  reviewThreshold: Schema.optional(Schema.Int.pipe(Schema.greaterThanOrEqualTo(1))),
})

type DecodedConfig = Schema.Schema.Type<typeof ConfigSchema>

export interface ConfigOperations {
  readonly testCommand: string
  readonly resolveModel: (state: ModelState) => string
  readonly agenticReview: boolean
  readonly squash: boolean
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
 * Load and deep-merge every config level from cwd up the directory chain.
 * Innermost (cwd) wins. Returns the merged plain object (undecoded).
 */
const loadMerged = (root: string): Effect.Effect<Record<string, unknown>, Error> =>
  Effect.tryPromise({
    try: async () => {
      const home = homedir()
      const chain = walkUp(root, home)

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
        if (result && !result.isEmpty) {
          if (!isPlainObject(result.config)) {
            throw new Error(
              `${result.filepath}: config must be a plain object, got ${Array.isArray(result.config) ? "array" : String(result.config)}`,
            )
          }
          levels.push(result.config)
        }
      }

      return levels.reduce<Record<string, unknown>>((acc, level) => deepMerge(acc, level), {})
    },
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

const SCHEMA_URL = "https://raw.githubusercontent.com/pmelab/gtd/main/schema.json"

const SCHEMA_STUB = `${JSON.stringify({ $schema: SCHEMA_URL }, null, 2)}\n`

/**
 * Reuses the same `walkUp` + `searchStrategy: "none"` cosmiconfig explorer as
 * `loadMerged` to detect whether ANY level of the cwd→root walk carries a gtd
 * config. Returns `true` on the first non-empty `search(dir)` result.
 */
const anyConfigPresent = (root: string): Effect.Effect<boolean, Error> =>
  Effect.tryPromise({
    try: async () => {
      const home = homedir()
      const chain = walkUp(root, home)

      const explorer = cosmiconfig("gtd", {
        searchPlaces: SEARCH_PLACES,
        searchStrategy: "none",
        loaders: {
          noExt: yamlLoader,
          ".json": jsonLoader,
          ".yaml": yamlLoader,
          ".yml": yamlLoader,
        },
      })

      for (const dir of chain) {
        const result = await explorer.search(dir)
        if (result && !result.isEmpty) return true
      }
      return false
    },
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

/**
 * Write a `.gtdrc.json` stub at `root` containing only the `$schema` key, so
 * editors get schema validation/autocompletion out of the box.
 */
const writeSchemaStub = (root: string): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.writeFileString(join(root, ".gtdrc.json"), SCHEMA_STUB)
  }).pipe(Effect.mapError((e) => (e instanceof Error ? e : new Error(String(e)))))

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
    squash: decoded.squash ?? DEFAULT_SQUASH,
    fixAttemptCap: decoded.fixAttemptCap ?? DEFAULT_FIX_ATTEMPT_CAP,
    reviewThreshold: decoded.reviewThreshold ?? DEFAULT_REVIEW_THRESHOLD,
  }
}

const formatSchemaError = (e: ParseError): string => {
  const issues = ArrayFormatter.formatErrorSync(e)
  const summary = issues
    .map((i) => (i.path.length > 0 ? i.path.join(".") + ": " : "") + i.message)
    .join("; ")
  return `Invalid gtd config: ${summary}`
}

export class ConfigService extends Context.Tag("ConfigService")<ConfigService, ConfigOperations>() {
  static Live = Layer.effect(
    ConfigService,
    Effect.gen(function* () {
      const { root } = yield* Cwd

      const present = yield* anyConfigPresent(root)
      if (!present) {
        const executor = yield* CommandExecutor.CommandExecutor
        const git = (...args: Array<string>) =>
          executor.exitCode(Command.make("git", ...args).pipe(Command.workingDirectory(root)))

        // Never disturb a `gtd: transport` HEAD. Transport is precedence-0 and
        // means "consume/mixed-reset this exact HEAD". Auto-committing a config
        // stub on top of it (or writing one into the tree it carries) would
        // corrupt the primitive: the transport commit would no longer be HEAD,
        // and — when transport is the repo root — the auto-commit silently masks
        // the "cannot reset transport commit" error the machine must surface.
        // Skip auto-init entirely here; it fires normally on a later run once the
        // transport HEAD has been consumed.
        const headSubject = yield* Command.make("git", "log", "-1", "--pretty=%s")
          .pipe(Command.workingDirectory(root), Command.string)
          .pipe(Effect.map((s) => s.trim()))
          .pipe(Effect.catchAll(() => Effect.succeed("")))

        if (headSubject !== "gtd: transport") {
          yield* writeSchemaStub(root)
          yield* git("add", ".gtdrc.json")
          yield* git("commit", "-m", "chore: add .gtdrc.json")
        }
      }

      const merged = yield* loadMerged(root)
      const { $schema: _schema, ...cleaned } = merged
      const decoded = yield* Schema.decodeUnknown(ConfigSchema)(cleaned, {
        onExcessProperty: "error",
      })
        .pipe(Effect.mapError(formatSchemaError))
        .pipe(Effect.mapError((msg) => new Error(msg)))
      return toOperations(decoded)
    }),
  )
}
