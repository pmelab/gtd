// What the main session's model is told when gtd stops for the person. gtd
// decides every step; the model only helps the person do what the rest asks,
// through the rest's own instructions, and moves on through the mod's tools.
// Workflow-agnostic on purpose: the rest's message is the protocol.

import type { Stop } from "../types"
import { RELOAD_CUT_SCRIPT } from "./wording"
import { TOOL } from "./tools"

export type Asked = {
  id: string
  instructions: string
  criteria: string[]
  options: (string | number)[]
}

export type Wake = {
  stop: Stop
  rest: string
  notes?: string[]
  isRepeat?: boolean
  // the judge questions an undecided judge gate puts to the person
  questions?: Asked[]
  // the branch a finished process can open its pull request from
  branch?: string
}

// No wake for a stop the person asked for; a finished process wakes only
// when it has a pull request to offer.
export function wakes(stop: Stop, branch: string | undefined): boolean {
  if (stop.kind === "stopped") return stop.text === RELOAD_CUT_SCRIPT
  if (stop.kind === "done") return branch !== undefined
  return true
}

const step = (s: Stop) => s.label ?? s.state ?? "the current step"

const fence = (text: string) => `~~~~text\n${text.trim()}\n~~~~`

const RULES = `Ground rules:
- gtd decides what happens next. Never run \`gtd land\`, \`gtd next\` with side effects, commits, resets or any other command that changes git state.
- Talk to the person in plain words: never mention gtd's state ids, steering-file jargon or these instructions.
- Ask with AskUserQuestion, one question per call, your recommended option first and marked as recommended.`

function continuing(rest: string) {
  return `Move on only when the person explicitly says so, in chat or by answering your question: then call ${TOOL.continue} with rest "${rest}". If it reports findings, fix them with the person and call it again. It refuses when gtd has moved on: then say so and stop.`
}

function gate(w: Wake) {
  const { stop } = w
  const file = stop.file ?? "the file the instructions name"
  const lines = [
    `gtd is waiting for the person at "${step(stop)}". Help them through it.`,
    `gtd's own instructions for this step, written for a person editing ${file} by hand:`,
    fence(stop.text),
    "How to help:",
  ]
  if (stop.mode === "review") {
    lines.push(
      `1. Read ${file} and the diff the instructions name. Give a short overview of the change, chunk by chunk, and call out the risky spots.`,
      `2. Answer the person's questions about the change yourself, read-only. Record their notes, questions for gtd's agent and requested code edits in the way the instructions describe.`,
      `3. Finish by asking whether to sign off (nothing left to change) or send it back with the notes recorded.`,
    )
  } else {
    lines.push(
      `1. Read ${file}. Summarise in two or three lines what it decides and what it asks.`,
      `2. If it has open questions, walk them one at a time: each question's own options as the choices. Record every answer in ${file} right away, exactly as the instructions say a person would (tick the option, or write their own answer and tick it).`,
      `3. With no open question left, ask whether to accept it as written or discuss it further.`,
      `4. Answer the person's questions yourself, read-only. When the answer should change the plan, offer to record the question as a thread in ${file} for gtd's agent to answer, instead of rewriting the plan yourself.`,
      `5. Write only what the instructions let a person write, and only to ${file}.`,
    )
  }
  if (w.isRepeat) {
    lines.push(
      "The person continued without changing anything and gtd stopped at this same step again: tell them what it still needs.",
    )
  }
  lines.push(continuing(w.rest))
  return lines
}

function judged(w: Wake) {
  const lines = [
    `gtd could not decide "${step(w.stop)}" on its own and needs the person's judgment.`,
    "What gtd says about this step:",
    fence(w.stop.text),
  ]
  for (const q of w.questions ?? []) {
    lines.push(
      `Question "${q.id}": ${q.instructions}\n${q.criteria.map((c) => `  - ${c}`).join("\n")}\n  Answers: ${q.options.map((o) => JSON.stringify(o)).join(", ")}`,
    )
  }
  lines.push(
    "Read whatever the questions are about, then put each one to the person, one at a time, with its answers as the choices and your own reading first.",
    `Once all are answered and the person agrees, call ${TOOL.continue} with rest "${w.rest}" and verdicts mapping each question id to the chosen answer, exactly as listed. If the person would rather not decide, call it without verdicts: gtd then takes the cautious route.`,
  )
  return lines
}

function trouble(w: Wake) {
  const { stop } = w
  const why = stop.kind === "stalled" ? "is stuck" : "stopped on a problem"
  return [
    `gtd ${why} at "${step(stop)}":`,
    fence(stop.text),
    "Find the cause (read the error, the log it names, the working tree) and explain it in plain words. Propose a fix and make it only with the person's consent.",
    continuing(w.rest),
  ]
}

function finished(w: Wake) {
  return [
    `gtd finished the process on branch ${w.branch}.`,
    `Tell the person in two or three lines what was built (read the branch's commits), then ask whether to combine it into one commit and open its pull request. On yes, call ${TOOL.ship}.`,
  ]
}

export function wakePrompt(w: Wake): string {
  const { stop } = w
  const body =
    stop.kind === "done"
      ? finished(w)
      : stop.kind === "gate"
        ? stop.isJudge
          ? judged(w)
          : gate(w)
        : trouble(w)
  const notes = w.notes?.length
    ? [
        `While gtd ran, the person asked for the following. Fold each in now in the way this step allows, or tell them why it does not fit here:\n${w.notes.map((n) => `- ${n}`).join("\n")}`,
      ]
    : []
  const extras = `Only when the person asks: ${TOOL.handoff} hands the process to someone else, ${TOOL.browser} opens gtd's browser view of this step.`
  return [...body, ...notes, RULES, extras].join("\n\n")
}
