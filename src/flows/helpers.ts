import {
  changes,
  head,
  openQuestions,
  read,
  refuse,
  run,
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

/** Refuse a turn that did not undo the code edits `edited` recorded, back to their content before `base`. */
export const requireRevert = (edited: readonly Change[], base: string): void => {
  const residue = edited.filter((c) => read(c.path) !== c.before).map((c) => c.path)
  if (residue.length === 0) return
  const quoted = residue.map((path) => `'${path.replace(/'/g, "'\\''")}'`).join(" ")
  refuse(
    `gtd land: require-revert: ${residue.join(", ")} still differ from ${base}~1 — the revert did not take. Run \`git checkout ${base}~1 -- ${quoted}\`, then \`gtd land\` again.`,
  )
}
