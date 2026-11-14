// What the main session's model is told when gtd stops for the person. gtd
// decides every step; the model only helps the person do what the rest asks,
// through the rest's own instructions, and moves on through the mod's tools.
// Workflow-agnostic on purpose: the rest's message is the protocol.

import type { Stop } from "../types"
import { RELOAD_CUT_SCRIPT } from "./wording"
import type { Done } from "./git"
import { JOB_NAME, TOOL } from "./tools"
import type { JobName } from "./tools"

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
}

// No wake for a finished process or a stop the person asked for.
export function wakes(stop: Stop): boolean {
  if (stop.kind === "stopped") return stop.text === RELOAD_CUT_SCRIPT
  return stop.kind !== "done"
}

const step = (s: Stop) => s.label ?? s.state ?? "the current step"

// The text can come from commit messages anyone on the branch wrote: the fence
// is longer than any run of ~ inside it, so the text cannot close it early.
const fence = (text: string) => {
  const body = text.trim()
  const bar = "~".repeat(Math.max(4, ...[...body.matchAll(/~+/g)].map((m) => m[0].length + 1)))
  return `${bar}text\n${body}\n${bar}`
}

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
  lines.push(
    `1. Read ${file}. Summarise in two or three lines what it decides and what it asks.`,
    `2. Walk its widgets one at a time — a heading opening with 🔘, ☑️, ❔ or 🔍. Put each one's checkboxes to the person as the choices, and record every answer in ${file} right away: tick the box, or write their own answer after ✏️. For a 🔍 checklist, show the diff of each hunk it points at and tick the hunks they have read.`,
    `3. Answer the person's questions yourself, read-only. When the answer should change the document, offer to record it as a footnote annotation ([^1]) in ${file} for gtd's agent to work in, instead of rewriting it yourself.`,
    `4. With nothing left to answer, ask whether to accept it as written or send it back with the annotations recorded.`,
    `5. Write only to ${file}.`,
  )
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

export function wakePrompt(w: Wake): string {
  const { stop } = w
  const body = stop.kind === "gate" ? (stop.isJudge ? judged(w) : gate(w)) : trouble(w)
  const notes = w.notes?.length
    ? [
        `While gtd ran, the person asked for the following. Fold each in now in the way this step allows, or tell them why it does not fit here:\n${w.notes.map((n) => `- ${n}`).join("\n")}`,
      ]
    : []
  const extras = `Only when the person asks: ${TOOL.handoff} hands the process to someone else, ${TOOL.browser} opens gtd's browser view of this step.`
  return [...body, ...notes, RULES, extras].join("\n\n")
}

// The wake after a background hand-off ended. It must not forbid further work:
// an agent with standing instructions (a review loop, a CI watch) would go idle.
export function jobPrompt(job: JobName, outcome: Done): string {
  const name = JOB_NAME[job]
  if (outcome.ok) {
    return [
      `The ${name} the person asked for finished. gtd's report:`,
      fence(outcome.text),
      "Relay the result to the person in a line or two, with any link in it; then continue with any work the person already asked for.",
    ].join("\n\n")
  }
  return [
    `The ${name} the person asked for failed. gtd reports the failed step:`,
    fence(outcome.text),
    "Tell the person what failed in plain words and what to try. Do not retry it yourself.",
  ].join("\n\n")
}
