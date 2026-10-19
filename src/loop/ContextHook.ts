import { Effect } from "effect"
import {
  DEFAULT_CONTEXT_LIMIT,
  contextHook,
  contextLimitFault,
  contextWindowFor,
  hookOutput,
  transcriptTokens,
  CONTEXT_STOP_FILE_ENV,
  type ContextHookRequest,
  type ContextLimit,
} from "../wire/index.js"
import { LoopHost } from "./Host.js"

interface HookInput {
  readonly event: "PostToolUse" | "PreCompact"
  readonly transcript: string | undefined
}

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined

const limitOf = (request: ContextHookRequest): Effect.Effect<ContextLimit, Error> => {
  const limit = {
    soft: request.soft ?? DEFAULT_CONTEXT_LIMIT.soft,
    hard: request.hard ?? DEFAULT_CONTEXT_LIMIT.hard,
  }
  const fault = contextLimitFault(limit)
  return fault === undefined
    ? Effect.succeed(limit)
    : Effect.fail(new Error(`gtd context-hook: ${fault}`))
}

// A subagent's event is left alone: its context is its own, not the turn's.
const parseInput = (text: string): Effect.Effect<HookInput | undefined, Error> =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () => new Error("gtd context-hook: stdin is not a hook's JSON input"),
  }).pipe(
    Effect.map((input) => {
      const event = field(input, "hook_event_name")
      if (event !== "PostToolUse" && event !== "PreCompact") return undefined
      if (field(input, "agent_id") !== undefined) return undefined
      const path = field(input, "transcript_path")
      return { event, transcript: typeof path === "string" && path !== "" ? path : undefined }
    }),
  )

const tokensOf = (input: HookInput): Effect.Effect<number | undefined, Error, LoopHost> =>
  input.event === "PostToolUse" && input.transcript !== undefined
    ? Effect.flatMap(LoopHost, (host) => host.readFile(input.transcript!)).pipe(
        Effect.map((text) => (text === undefined ? undefined : transcriptTokens(text))),
      )
    : Effect.succeed(undefined)

const recordStop = (stopReason: string): Effect.Effect<void, never, LoopHost> =>
  Effect.flatMap(LoopHost, (host) => {
    const file = host.env[CONTEXT_STOP_FILE_ENV]
    // A record that cannot be written must not cost the stop itself.
    return file === undefined || file === ""
      ? Effect.void
      : host.appendLog(file, `${stopReason}\n`).pipe(Effect.catchAllDefect(() => Effect.void))
  })

/** `gtd context-hook`: one settings hook for PostToolUse and PreCompact. */
export const runContextHook = (
  request: ContextHookRequest,
): Effect.Effect<string, Error, LoopHost> =>
  Effect.gen(function* () {
    const limit = yield* limitOf(request)
    const input = yield* parseInput(request.input)
    if (input === undefined) return ""
    const decision = contextHook({
      event: input.event,
      tokens: yield* tokensOf(input),
      window: request.window ?? contextWindowFor(undefined),
      limit,
    })
    if (decision === undefined) return ""
    if (decision.kind === "hard") yield* recordStop(decision.stopReason)
    return `${JSON.stringify(hookOutput(decision))}\n`
  })
