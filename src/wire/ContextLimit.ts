// The context-limit decision every driver shares: `gtd context-hook`
// and the Claude Code mod both answer a hook event through `contextHook`, so
// the two cannot drift on thresholds, wording or which tokens count.

/** A share of the model's context window, each in (0, 1]; `soft` below `hard`. */
export interface ContextLimit {
  readonly soft: number
  readonly hard: number
}

export const DEFAULT_CONTEXT_LIMIT: ContextLimit = { soft: 0.6, hard: 0.7 }

const DEFAULT_WINDOW = 200_000
const LONG_WINDOW = 1_000_000

/** Claude Code's `[1m]` suffix selects the long window; a transcript never names it, so the driver decides from the model it passed. */
export const contextWindowFor = (model: string | undefined): number =>
  model !== undefined && /\[1m\]/i.test(model) ? LONG_WINDOW : DEFAULT_WINDOW

/** A positive whole number of tokens, or `undefined` for anything else. */
export const parseContextWindow = (raw: string | undefined): number | undefined => {
  const n = Number(raw)
  return raw !== undefined && raw.trim() !== "" && Number.isInteger(n) && n > 0 ? n : undefined
}

/** `gtd context-hook`'s request: the hook's stdin and the limits its flags set. */
export interface ContextHookRequest {
  readonly input: string
  readonly soft?: number
  readonly hard?: number
  readonly window?: number
}

/**
 * Where a driver asks `gtd context-hook` to record a hard stop's `stopReason`:
 * Claude Code prints it nowhere a driver reads, and `hook_stopped` alone would
 * also name any other hook that stopped the turn.
 */
export const CONTEXT_STOP_FILE_ENV = "GTD_LOOP_CONTEXT_STOP_FILE"

/**
 * Why one layer of a limit (a scope's, a step's) is malformed, ignoring how its
 * two shares relate: layers merge key by key, so only the merged limit has to
 * keep `soft` below `hard`. Config is evaluated untyped, so anything may arrive.
 */
export const contextShapeFault = (limit: unknown): string | undefined => {
  if (typeof limit !== "object" || limit === null || Array.isArray(limit)) {
    return `context must be an object { soft, hard }, got ${JSON.stringify(limit)}`
  }
  const unknown = Object.keys(limit).filter((key) => key !== "soft" && key !== "hard")
  if (unknown.length > 0) return `unknown key(s) ${unknown.join(", ")} in context`
  const shares = limit as { readonly soft?: unknown; readonly hard?: unknown }
  for (const key of ["soft", "hard"] as const) {
    const value = shares[key]
    if (value === undefined) continue
    if (typeof value !== "number" || !(value > 0 && value <= 1)) {
      return `context.${key} must be a share of the context window in (0, 1], got ${JSON.stringify(value)}`
    }
  }
  return undefined
}

/** Why a whole limit is unusable, or `undefined` when it is fine. */
export const contextLimitFault = (limit: unknown): string | undefined => {
  const shape = contextShapeFault(limit)
  if (shape !== undefined) return shape
  const shares = limit as { readonly soft?: unknown; readonly hard?: unknown }
  const soft = (shares.soft as number | undefined) ?? DEFAULT_CONTEXT_LIMIT.soft
  const hard = (shares.hard as number | undefined) ?? DEFAULT_CONTEXT_LIMIT.hard
  return soft < hard ? undefined : `context.soft (${soft}) must be below context.hard (${hard})`
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined

const count = (value: unknown): number => (typeof value === "number" && value > 0 ? value : 0)

/** What a message's usage puts in the context window: its whole input, cached or not. */
export const usageTokens = (usage: unknown): number | undefined => {
  const u = record(usage)
  if (u === undefined) return undefined
  return (
    count(u["input_tokens"]) +
    count(u["cache_read_input_tokens"]) +
    count(u["cache_creation_input_tokens"])
  )
}

/**
 * The context size of the latest assistant message in a Claude Code transcript
 * (one JSON entry per line). Usage is per message, not a running sum, so the
 * last entry alone is the window's fill.
 */
export const transcriptTokens = (transcript: string): number | undefined => {
  const lines = transcript.split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim()
    if (line === "") continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (record(entry)?.["type"] !== "assistant") continue
    const tokens = usageTokens(record(record(entry)?.["message"])?.["usage"])
    if (tokens !== undefined) return tokens
  }
  return undefined
}

/**
 * A worker subagent's own transcript. A hook its tool call fires is handed the
 * MAIN session's `transcript_path`; the worker's sits beside it.
 */
export const subagentTranscriptPath = (transcriptPath: string, agentId: string): string =>
  `${transcriptPath.replace(/\.jsonl$/, "")}/subagents/agent-${agentId}.jsonl`

/** Every hard stop's `stopReason` starts with this: the driver's context-limit marker. */
export const CONTEXT_LIMIT_MARKER = "gtd: context limit"

export type ContextEvent = "PostToolUse" | "PreCompact"

export type ContextDecision =
  | { readonly kind: "soft"; readonly reason: string }
  | { readonly kind: "hard"; readonly stopReason: string }

const percent = (share: number): string => `${Math.round(share * 100)}%`

/**
 * What a hook answers, or `undefined` to let the run go on. Compaction about
 * to happen means the limit was missed, so `PreCompact` is a hard stop whatever
 * the count says.
 */
export const contextHook = (input: {
  readonly event: ContextEvent
  readonly tokens: number | undefined
  readonly window: number
  readonly limit: ContextLimit
}): ContextDecision | undefined => {
  const { event, tokens, window, limit } = input
  if (event === "PreCompact") {
    return {
      kind: "hard",
      stopReason: `${CONTEXT_LIMIT_MARKER}: the context is about to be compacted — the run is too big for one turn`,
    }
  }
  if (tokens === undefined) return undefined
  const used = `${tokens} of ${window} tokens`
  if (tokens >= limit.hard * window) {
    return {
      kind: "hard",
      stopReason: `${CONTEXT_LIMIT_MARKER}: ${used}, past the ${percent(limit.hard)} hard limit`,
    }
  }
  if (tokens >= limit.soft * window) {
    return {
      kind: "soft",
      reason: `Context limit: ${used} used, past the ${percent(limit.soft)} soft limit. Stop working now. Do not start anything new; end your turn with a short handoff note as your answer: what you touched, and what was next. Where your instructions name a file for that note, write it there too.`,
    }
  }
  return undefined
}

/** A decision as Claude Code's settings-hook JSON output. */
export const hookOutput = (decision: ContextDecision): Record<string, unknown> =>
  decision.kind === "soft"
    ? { decision: "block", reason: decision.reason }
    : { continue: false, stopReason: decision.stopReason }
