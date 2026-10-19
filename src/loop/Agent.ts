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
  /** The turn was stopped at its context limit, by the hook or by the loop. */
  readonly contextLimit: boolean
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
// execution error mid-turn) — landing it would land the failure as work. A
// hook's `stopReason` never reaches stdout; `hook_stopped` is the only trace,
// and the context-limit hook is the only one the loop installs.
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
    const envelope = exit.stdout
      .split("\n")
      .map(parseJson)
      .findLast((event) => field(event, "result") !== undefined)
    const result = field(envelope, "result")
    const contextLimit =
      exit.stopped === true || field(envelope, "terminal_reason") === "hook_stopped"
    return {
      ok: exit.code === 0 && field(envelope, "is_error") !== true && !contextLimit,
      text: typeof result === "string" ? result : exit.stdout,
      cost: costOf(field(envelope, "total_cost_usd")),
      contextLimit,
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
      contextLimit: false,
    }
  },
}

export const agentCli = (name: AgentName): AgentCli => (name === "pi" ? pi : claude)
