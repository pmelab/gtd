// The only way the main session's model moves gtd: tools the mod serves. Each
// checks the run before it acts, so a model cannot skip a rest or answer one
// gtd has already left.

import type { Run } from "../types"
import { humanVerdicts } from "./judge"
import type { Judgment } from "./judge"

export const TOOL = {
  continue: "mcp__gtd__continue",
  note: "mcp__gtd__note",
  handoff: "mcp__gtd__handoff",
  ship: "mcp__gtd__ship",
  browser: "mcp__gtd__browser",
} as const

export const TOOLS = [
  {
    name: "continue",
    description:
      "Moves the gtd process on from the step it waits at. Call it ONLY after the person explicitly said to continue. `rest` is the rest id gtd gave you for this step. `verdicts` only at a step gtd's judge could not decide: each question id mapped to the person's chosen answer. Refused when gtd has moved on, while a step runs, or when the step's file does not validate; the result says why.",
    inputSchema: {
      type: "object",
      properties: {
        rest: { type: "string" },
        verdicts: { type: "object", additionalProperties: { type: ["string", "number"] } },
      },
      required: ["rest"],
    },
  },
  {
    name: "note",
    description:
      "Records a request the person makes while gtd runs a step (a change, something to consider), for the next step that waits on them. Use it instead of editing files while gtd runs.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "handoff",
    description:
      "Hands the gtd process to someone else: pushes the branch and opens or refreshes a draft pull request assigned to them. Call it only when the person asks. `to`: their GitHub username; omit it to leave the process for anyone.",
    inputSchema: { type: "object", properties: { to: { type: "string" } } },
  },
  {
    name: "ship",
    description:
      "Combines the finished gtd process into one commit, pushes it and opens or updates its pull request. Call it only after the person agreed. `dryRun` previews without writing anything.",
    inputSchema: { type: "object", properties: { dryRun: { type: "boolean" } } },
  },
  {
    name: "browser",
    description:
      "Starts gtd's browser view of the step it waits at and returns its address. Call it only when the person wants it.",
    inputSchema: { type: "object", properties: {} },
  },
]

// A rest is the state gtd waits at on a given HEAD: once either moves, an
// answer meant for it no longer applies. Survives a mod reload, unlike a counter.
export const restId = (head: string, state: string | undefined) =>
  `${head.slice(0, 12)}:${state ?? "?"}`

export type Proceed = { refuse: string } | { refuse?: undefined; verdict?: string }

export type ContinueIo = {
  // the rest gtd is at now; undefined when it cannot say
  current(): Promise<string | undefined>
  // the rest's own `gtd validate` script, run; ok when there is nothing to check
  validate(): Promise<{ ok: boolean; out: string }>
  judgment(): Promise<Judgment | undefined>
  // a ship or hand-off running or queued: it writes the tree the driver would
  busy?: JobName
}

export type JobName = "ship" | "handoff"

export const JOB_NAME: Record<JobName, string> = { ship: "ship", handoff: "hand-off" }

const busyText = (job: JobName) => `A ${JOB_NAME[job]} is still running: wait for its report.`

// Only these leave the tree alone (ship and throw refuse for themselves); any
// other verb, unknown ones included, may switch branch or write .gtd/. `stop`
// is not here: `command` takes the bare word itself, and `stop <words>` is a
// requirement. `ui` is not: its page writes steering files.
const WHILE_BUSY = new Set(["status", "throw", "ship"])

export function decideCommand(arg: string, busy: JobName | undefined): string | undefined {
  if (!busy) return undefined
  const verb = arg.trim().split(/\s+/)[0] ?? ""
  return WHILE_BUSY.has(verb) ? undefined : busyText(busy)
}

// Pure: a refused job leaves the run, and so `continue`, as it was.
export function decideJob(run: Run, job: JobName): string | undefined {
  if (run.isRunning) return "gtd is running a step: wait for it to rest."
  if (run.pending) return "A continue is already waiting for this turn to end."
  const kind = run.stop?.kind
  if (job === "ship" && (kind === "gate" || kind === "stalled" || kind === "error")) {
    return "gtd still waits on the person at this step: answer it with continue first."
  }
  return undefined
}

// What `continue` may do from here. `rest` undefined is the band's Continue,
// which always means the rest on screen.
export async function decideContinue(
  run: Run,
  rest: string | undefined,
  verdicts: unknown,
  io: ContinueIo,
): Promise<Proceed> {
  if (run.isRunning) return { refuse: "gtd is already running a step." }
  if (io.busy) return { refuse: busyText(io.busy) }
  const stop = run.stop
  if (!stop) return { refuse: "Nothing is waiting: gtd has no rest open. /gtd drives it." }
  if (stop.kind === "done") {
    return { refuse: `The process is finished: ${TOOL.ship} opens its pull request.` }
  }
  if (rest !== undefined && rest !== run.rest) {
    return {
      refuse: "gtd has moved on from that step; it no longer waits there. Nothing was changed.",
    }
  }
  // Another terminal or a branch switch can move gtd under a waiting answer.
  const now = await io.current()
  if (now !== undefined && now !== run.rest) {
    return {
      refuse:
        "gtd is no longer at that step (it changed outside this session): /gtd shows where it is.",
    }
  }
  if (stop.kind === "gate" && stop.isJudge) return judged(verdicts, io)
  if (verdicts !== undefined) return { refuse: "This step takes no verdicts." }
  if (stop.kind === "gate") {
    const v = await io.validate()
    if (!v.ok) return { refuse: `The step's file does not validate yet:\n${v.out}` }
  }
  return {}
}

// No verdicts lands the gate untouched: the cautious default.
async function judged(verdicts: unknown, io: ContinueIo): Promise<Proceed> {
  if (verdicts === undefined) return {}
  const j = await io.judgment()
  if (!j) return { refuse: "gtd no longer has a judgment open here." }
  const v = humanVerdicts(j, verdicts)
  return typeof v === "string"
    ? { refuse: `Those verdicts don't fit: ${v}` }
    : { verdict: JSON.stringify(v) }
}
