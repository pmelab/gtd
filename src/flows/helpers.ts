import {
  changes,
  codeThreads,
  head,
  openQuestions,
  read,
  refuse,
  run,
  threads,
  type Change,
  type JudgeAnswer,
} from "./runtime.js"
import { checkScript } from "./scripts.js"

/** Whether a judge answered `expected` at a probability of at least `minP`. */
export const answered = (
  answer: JudgeAnswer | undefined,
  expected: string,
  minP: number,
): boolean => answer !== undefined && answer.answer === expected && answer.p >= minP

/** A numeric var, or `fallback` when it is unset, blank or not a finite number. */
export const numeric = (value: string | undefined, fallback: number): number => {
  const n = Number(value)
  return value === undefined || value.trim() === "" || !Number.isFinite(n) ? fallback : n
}

/** Whether the last step added or rewrote `path`. */
export const wrote = (path: string): boolean => changes(path).some((c) => c.status !== "deleted")

export interface CheckOptions {
  /** Where a failing run leaves its output. */
  readonly report: string
  readonly label?: string | undefined
  /** Paths removed before the command runs. */
  readonly sweep?: readonly string[] | undefined
  /** Paths removed once it passes. */
  readonly sweepOnGreen?: readonly string[] | undefined
}

/**
 * A step that runs `command` through the driver and keeps its outcome in the
 * tree: a failure writes `report`, a pass removes it. Resolves `true` when the
 * command passed.
 */
export const check = async (
  name: string,
  command: string,
  options: CheckOptions,
): Promise<boolean> => {
  const { report, label, sweep, sweepOnGreen } = options
  await run(
    name,
    checkScript(command, { report, stamp: head().slice(0, 7), sweep, sweepOnGreen }),
    { label },
  )
  return !wrote(report)
}

const isCode = (path: string): boolean => path !== ".gtd" && !path.startsWith(".gtd/")

/** The last step's changes outside `.gtd/`. */
export const codeChanges = (): readonly Change[] => changes().filter((c) => isCode(c.path))

/** Refuse a turn whose only change deletes `file` — unless it says it found nothing to do. */
export const requireProgress = (file: string): void => {
  const change = changes().get(file)
  if (change?.status !== "deleted") return
  if (codeChanges().length > 0) return
  if ((change.before ?? "").trim().startsWith("NOTHING ACTIONABLE")) return
  refuse(
    `gtd land: feedback-progress: ${file} was deleted without addressing its instructions — implement the changes it lists (then delete it), don't just remove the file.`,
  )
}

/** Refuse a turn that leaves a question in `file` unanswered. An untouched tree is silence, and allowed. */
export const requireAnswers = (file: string): void => {
  if (changes().length === 0) return
  const open = openQuestions(read(file) ?? "")
  if (open.length === 0) return
  const list = open.map((q) => `  - ${file}:${q.line}: ${q.question}`).join("\n")
  refuse(
    `gtd land: answer-completeness: ${open.length} open question(s) in ${file} not answered — tick exactly one option per question, or delete a question you don't want to answer. To accept the plan as-is instead, revert everything and re-run:\n${list}`,
  )
}

/** Footnote threads in `file` waiting on `waitingOn`, plus any with a syntax fault — a fault refuses both ways. */
const threadLines = (file: string, waitingOn: "human" | "agent"): string[] =>
  threads(read(file) ?? "")
    .filter((t) => t.waitingOn === waitingOn || t.faults.length > 0)
    .flatMap((t) => [
      `  - ${file}:${t.line}: [^${t.name}]`,
      ...t.faults.map((fault) => `    ${fault}`),
    ])

/** Code threads waiting on `waitingOn`, plus any with a syntax fault — a fault refuses both ways. */
const codeThreadLines = (waitingOn: "human" | "agent"): string[] =>
  codeThreads()
    .filter((t) => t.waitingOn === waitingOn || t.faults.length > 0)
    .flatMap((t) => [
      `  - ${t.path}:${t.line}: ${t.first}`,
      ...t.faults.map((fault) => `    ${fault}`),
    ])

const countOf = (lines: readonly string[]): number =>
  lines.filter((line) => line.startsWith("  - ")).length

/** Whether a thread waits on `waitingOn`: one in footnote file `file`, or any code thread in the process's changed files. */
export const hasThreadFor = (waitingOn: "human" | "agent", file?: string): boolean =>
  (file !== undefined && threads(read(file) ?? "").some((t) => t.waitingOn === waitingOn)) ||
  codeThreads().some((t) => t.waitingOn === waitingOn)

/** Refuse any landing while a thread in `file` or a code thread in a changed file waits on the human (its last entry is the agent's), or has a syntax fault. */
export const requireThreadsClosed = (file: string): void => {
  const open = [...threadLines(file, "human"), ...codeThreadLines("human")]
  if (open.length === 0) return
  refuse(
    `gtd land: open-threads: ${countOf(open)} thread(s) in ${file} or code comments wait on you — reply with a conclusion, or delete the thread:\n${open.join("\n")}`,
  )
}

/** Refuse an agent turn that leaves a thread in `file`, or a code thread in a changed file, waiting on the agent (its last entry is `H:`) or with a syntax fault. */
export const requireReplies = (file: string): void => {
  const open = [...threadLines(file, "agent"), ...codeThreadLines("agent")]
  if (open.length === 0) return
  refuse(
    `gtd land: unanswered-threads: ${countOf(open)} thread(s) in ${file} or code comments still wait on the agent — append one "- A:" reply to each (one "A:" comment line, same token and indentation, directly below a code thread's last line), or fold a concluded thread and delete it:\n${open.join("\n")}`,
  )
}

/** Refuse a turn that did not undo the code edits `edited` recorded, back to their content before `base`. */
export const requireRevert = (edited: readonly Change[], base: string): void => {
  const residue = edited.filter((c) => read(c.path) !== c.before).map((c) => c.path)
  if (residue.length === 0) return
  const quoted = residue.map((path) => `'${path.replace(/'/g, "'\\''")}'`).join(" ")
  refuse(
    `gtd land: require-revert: ${residue.join(", ")} still differ from ${base}~1 — the revert did not take. Run \`git checkout ${base}~1 -- ${quoted}\`, then \`gtd land\` again.`,
  )
}
