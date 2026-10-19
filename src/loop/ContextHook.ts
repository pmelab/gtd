import { Effect } from "effect"
import {
  DEFAULT_CONTEXT_LIMIT,
  contextHook,
  contextLimitFault,
  contextWindowFor,
  hookOutput,
  transcriptTokens,
  type ContextLimit,
} from "../wire/index.js"
import { LoopHost } from "./Host.js"

export interface ContextHookRequest {
  readonly input: string
  readonly soft?: number
  readonly hard?: number
  readonly window?: number
}

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

/** `gtd context-hook`: one settings hook for PostToolUse and PreCompact. */
export const runContextHook = (
  request: ContextHookRequest,
): Effect.Effect<string, Error, LoopHost> =>
  Effect.gen(function* () {
    const limit = yield* limitOf(request)
    const input = yield* parseInput(request.input)
    if (input === undefined) return ""
    const transcript =
      input.event === "PostToolUse" && input.transcript !== undefined
        ? yield* (yield* LoopHost).readFile(input.transcript)
        : undefined
    const decision = contextHook({
      event: input.event,
      tokens: transcript === undefined ? undefined : transcriptTokens(transcript),
      window: request.window ?? contextWindowFor(undefined),
      limit,
    })
    return decision === undefined ? "" : `${JSON.stringify(hookOutput(decision))}\n`
  })
