import { Either, Schema } from "effect"
import { parseContextWindow } from "../wire/index.js"

const Agent = Schema.Literal("claude", "pi")
export type AgentName = typeof Agent.Type

/** Per-machine settings: never read from repo config, so one person's model choice binds nobody else. */
export interface LoopSettings {
  readonly agent: AgentName
  /** Workflow model hint → the model name this machine's agent CLI accepts. */
  readonly models: Readonly<Record<string, string>>
  /** Non-empty `GTD_LOOP_MODEL_*` variables, by name; each overrides the hint `modelEnvName` maps onto it. */
  readonly envModels: Readonly<Record<string, string>>
  /** The agent's context window in tokens; absent, it follows from the model. */
  readonly contextWindow: number | undefined
}

// The bundled workflow's hints as Claude Code's own aliases. Only claude gets
// defaults: for any other agent an unmapped hint is dropped, so it runs its own default.
const CLAUDE_MODELS: Readonly<Record<string, string>> = { smart: "opus", base: "sonnet" }
const BUNDLED_HINTS: ReadonlySet<string> = new Set(Object.keys(CLAUDE_MODELS))

const SettingsFile = Schema.Struct({
  agent: Schema.optional(Agent),
  models: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  contextWindow: Schema.optional(Schema.Int.pipe(Schema.positive())),
})

type Env = Readonly<Record<string, string | undefined>>

export const settingsPath = (env: Env): string | undefined => {
  const explicit = env["GTD_LOOP_CONFIG"]
  if (explicit) return explicit
  const xdg = env["XDG_CONFIG_HOME"]
  if (xdg) return `${xdg}/gtd/loop.json`
  const home = env["HOME"]
  return home ? `${home}/.config/gtd/loop.json` : undefined
}

const MODEL_ENV_PREFIX = "GTD_LOOP_MODEL_"

const modelEnvName = (hint: string): string =>
  `${MODEL_ENV_PREFIX}${hint.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`

const decodeFile = (
  path: string,
  text: string,
): Either.Either<typeof SettingsFile.Type, string> => {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    return Either.left(`${path}: not JSON (${(error as Error).message})`)
  }
  return Schema.decodeUnknownEither(SettingsFile, { onExcessProperty: "error" })(json).pipe(
    Either.mapLeft((error) => `${path}: ${error.message}`),
  )
}

const decodeAgent = (value: string | undefined): Either.Either<AgentName | undefined, string> =>
  value === undefined || value === ""
    ? Either.right(undefined)
    : Schema.decodeUnknownEither(Agent)(value).pipe(
        Either.mapLeft(() => `GTD_LOOP_AGENT must be "claude" or "pi" — got "${value}"`),
      )

const decodeWindow = (value: string | undefined): Either.Either<number | undefined, string> => {
  if (value === undefined || value === "") return Either.right(undefined)
  const window = parseContextWindow(value)
  return window !== undefined
    ? Either.right(window)
    : Either.left(`GTD_LOOP_CONTEXT_WINDOW must be a positive integer — got "${value}"`)
}

/** Environment over file over built-in defaults, per key and per hint. */
export const resolveSettings = (
  env: Env,
  file: { readonly path: string; readonly text: string } | undefined,
): Either.Either<LoopSettings, string> =>
  Either.gen(function* () {
    const fromFile = file === undefined ? {} : yield* decodeFile(file.path, file.text)
    const envAgent = yield* decodeAgent(env["GTD_LOOP_AGENT"])
    const envWindow = yield* decodeWindow(env["GTD_LOOP_CONTEXT_WINDOW"])
    const envModels = Object.fromEntries(
      Object.entries(env).filter(
        (entry): entry is [string, string] =>
          entry[0].startsWith(MODEL_ENV_PREFIX) && entry[1] !== undefined && entry[1] !== "",
      ),
    )
    const agent = envAgent ?? fromFile.agent ?? "claude"
    const defaults = agent === "claude" ? CLAUDE_MODELS : {}
    return {
      agent,
      models: { ...defaults, ...fromFile.models },
      envModels,
      contextWindow: envWindow ?? fromFile.contextWindow,
    }
  })

/**
 * An unmapped hint passes through verbatim — a workflow may name a real model
 * outright — except a bundled hint, which no agent CLI accepts as a name.
 */
export const resolveModel = (
  settings: LoopSettings,
  hint: string | undefined,
): string | undefined => {
  if (hint === undefined || hint === "") return undefined
  const mapped = settings.envModels[modelEnvName(hint)] ?? settings.models[hint]
  return mapped ?? (BUNDLED_HINTS.has(hint) ? undefined : hint)
}
