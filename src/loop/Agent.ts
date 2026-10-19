import { usageTokens } from "../wire/index.js"
import type { AgentName } from "./Settings.js"
import type { Exit } from "./Host.js"

export type SessionFlag = "--session-id" | "--resume"

interface Turn {
  readonly sessionFlag: SessionFlag
  readonly sessionId: string
  readonly model: string | undefined
  readonly system: string | undefined
  /** The shell command of the context-limit hook the turn runs under. */
  readonly hook: string
}

/** What one agent run reports once its own envelope is read. */
export interface TurnResult {
  readonly ok: boolean
  /** The agent's answer text, or its raw output when it died before writing an envelope. */
  readonly text: string
  /** USD; 0 when the agent reported none. */
  readonly cost: number
  /** A hook stopped the turn. */
  readonly hookStopped: boolean
}

interface AgentCli {
  readonly command: string
  readonly args: (turn: Turn) => readonly string[]
  readonly read: (exit: Exit) => TurnResult
  /** A stdout line → the context it shows in use, for the loop's own hard stop; absent where the agent streams none. */
  readonly contextTokens?: (line: string) => number | undefined
}

const optional = (flag: string, value: string | undefined): readonly string[] =>
  value === undefined || value === "" ? [] : [flag, value]

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined

const costOf = (value: unknown): number => (typeof value === "number" && value > 0 ? value : 0)

// `stream-json` (which `-p` refuses without `--verbose`) carries each
// assistant message's usage as it happens — the loop's own hard stop, should
// the hook not fire — and ends in the same `result` envelope `json` prints.
// An `is_error` envelope is a failed turn even at exit 0 (max turns hit, an
// execution error mid-turn) — landing it would land the failure as work; an
// error envelope carries no `result` key, so the envelope is found by its type.
// A hook that stopped the turn shows only as `hook_stopped`; which hook did is
// for the loop to tell. Without an envelope (killed, crashed) the stream is
// the whole transcript, so only its tail stands in for the answer.
const STREAM_TAIL_LINES = 5

const claude: AgentCli = {
  command: "claude",
  args: (turn) => [
    "-p",
    turn.sessionFlag,
    turn.sessionId,
    ...optional("--model", turn.model),
    ...optional("--system-prompt", turn.system),
    "--settings",
    JSON.stringify(hookSettings(turn.hook)),
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
  ],
  read: (exit) => {
    const lines = exit.stdout.split("\n")
    let envelope: unknown
    for (let i = lines.length - 1; i >= 0 && envelope === undefined; i--) {
      const event = parseJson(lines[i]!)
      if (field(event, "type") === "result" || field(event, "result") !== undefined)
        envelope = event
    }
    const result = field(envelope, "result")
    const hookStopped = field(envelope, "terminal_reason") === "hook_stopped"
    return {
      ok: exit.code === 0 && field(envelope, "is_error") !== true && !hookStopped,
      text: typeof result === "string" ? result : lines.slice(-STREAM_TAIL_LINES).join("\n"),
      cost: costOf(field(envelope, "total_cost_usd")),
      hookStopped,
    }
  },
  // A subagent's message (`parent_tool_use_id` set) fills its own context, not the turn's.
  contextTokens: (line) => {
    const event = parseJson(line)
    if (field(event, "type") !== "assistant") return undefined
    if (field(event, "parent_tool_use_id") != null) return undefined
    return usageTokens(field(field(event, "message"), "usage"))
  },
}

const hookSettings = (command: string) => {
  const hook = [{ hooks: [{ type: "command", command }] }]
  return { hooks: { PostToolUse: hook, PreCompact: hook } }
}

// pi's `--mode json` streams one event per line; the answer and its cost sit
// on the last assistant `message_end`, and any `error` event fails the turn.
const pi: AgentCli = {
  command: "pi",
  args: (turn) => [
    "-p",
    turn.sessionFlag,
    turn.sessionId,
    ...optional("--model", turn.model),
    ...optional("--system-prompt", turn.system),
    "--mode",
    "json",
    "--no-approve",
  ],
  read: (exit) => {
    const events = exit.stdout
      .split("\n")
      .map(parseJson)
      .filter((event) => event !== undefined)
    const message = field(
      events.findLast(
        (event) =>
          field(event, "type") === "message_end" &&
          field(field(event, "message"), "role") === "assistant",
      ),
      "message",
    )
    const content = field(message, "content")
    const text = (Array.isArray(content) ? content : [])
      .filter((part) => field(part, "type") === "text")
      .map((part) => String(field(part, "text")))
      .join("\n")
    return {
      ok: exit.code === 0 && !events.some((event) => field(event, "type") === "error"),
      text: text === "" ? exit.stdout : text,
      cost: costOf(field(field(field(message, "usage"), "cost"), "total")),
      hookStopped: false,
    }
  },
}

export const agentCli = (name: AgentName): AgentCli => (name === "pi" ? pi : claude)
