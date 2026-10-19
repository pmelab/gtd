import {
  contextHook,
  contextLimitFault,
  contextWindowFor,
  DEFAULT_CONTEXT_LIMIT,
  subagentTranscriptPath,
  transcriptTokens,
} from "../../src/wire/ContextLimit.js"
import type { ContextDecision, ContextLimit } from "../../src/wire/ContextLimit.js"

// The mod's half of `gtd context-hook`: the same decision, for a worker
// subagent instead of a `claude -p` session.

export type Guard = { limit: ContextLimit; window: number }

/** A turn's limits from its beat's `context` and the window override; a bad window is ignored. */
export function guardOf(
  context: { soft?: number; hard?: number } | undefined,
  model: string | undefined,
  windowEnv: string | undefined,
): Guard | undefined {
  const limit = { ...DEFAULT_CONTEXT_LIMIT, ...context }
  if (contextLimitFault(limit) !== undefined) return undefined
  const n = Number(windowEnv)
  return { limit, window: Number.isInteger(n) && n > 0 ? n : contextWindowFor(model) }
}

export type HookEvent = {
  hook_event_name: string
  transcript_path: string
  agent_id?: string
}

/**
 * A worker's hook event decided. It is handed the MAIN session's transcript,
 * so the worker's own is read instead.
 */
export async function decide(
  e: HookEvent,
  guard: Guard | undefined,
  read: (path: string) => Promise<string | undefined>,
): Promise<ContextDecision | undefined> {
  const event = e.hook_event_name
  if (!guard || !e.agent_id || (event !== "PostToolUse" && event !== "PreCompact")) return undefined
  const transcript =
    event === "PostToolUse" && e.transcript_path
      ? await read(subagentTranscriptPath(e.transcript_path, e.agent_id))
      : undefined
  return contextHook({
    event,
    tokens: transcript === undefined ? undefined : transcriptTokens(transcript),
    ...guard,
  })
}

/** A decision as the classic hook result the engine maps to `decision`/`continue`. */
export function classicResult(decision: ContextDecision) {
  return decision.kind === "soft"
    ? { block: decision.reason }
    : { preventContinuation: true as const, stopReason: decision.stopReason }
}
