import {
  answered,
  changesSince,
  judge,
  numeric,
  read,
  run,
  vars,
  writeScript,
  type JudgeQuestion,
} from "../../flows/index.js"
import type { ReviewDecision } from "../../steering/index.js"
import {
  conflictBody,
  conflictFor,
  conflictTitle,
  isConflictTitle,
  oneLine,
  parseStandards,
  renderStandards,
  STANDARDS,
  type Conflict,
  type Standards,
} from "./standards.js"
import { REVIEW } from "./steps.js"

interface Candidate {
  readonly decision: ReviewDecision
  readonly text: string
}

const SUMMARY_MAX = 200

const summary = (body: string): string => {
  const first = oneLine(body.split(/\n\s*\n/).find((p) => p.trim() !== "") ?? "")
  return first.length > SUMMARY_MAX ? `${first.slice(0, SUMMARY_MAX - 1)}…` : first
}

/** The standard a won't-fix or an own answer would make; a fix states none. */
const candidateOf = (d: ReviewDecision): Candidate[] => {
  const anchor = oneLine(d.anchor)
  if (d.choice === "wontfix") {
    const why = summary(d.body)
    return [{ decision: d, text: `Won't fix: ${anchor}${why === "" ? "" : ` — ${why}`}` }]
  }
  if (d.choice === "answer") return [{ decision: d, text: `${oneLine(d.text)} (re: ${anchor})` }]
  return []
}

const without = (list: readonly string[], drop: readonly string[]): string[] =>
  list.filter((s) => !drop.includes(s))

const adding = (list: readonly string[], text: string): string[] =>
  list.includes(text) ? [...list] : [...list, text]

/**
 * Keep the new one, keep the old one, or replace both with the human's own
 * wording. Another conflict naming a replaced standard names its replacement.
 */
const resolve = (standards: Standards, d: ReviewDecision): Standards => {
  const c = conflictFor(standards, d.anchor)
  if (c === undefined) return standards
  const others = standards.undecided.filter((u) => u !== c)
  if (d.choice === "wontfix") return { decided: standards.decided, undecided: others }
  const kept = d.choice === "fix" ? c.text : oneLine(d.text)
  const undecided = others.map((u) => ({
    text: u.text,
    olds: u.olds.reduce<string[]>((olds, o) => adding(olds, c.olds.includes(o) ? kept : o), []),
  }))
  return { decided: adding(without(standards.decided, c.olds), kept), undecided }
}

const contradicts = (i: number, id: string, other: string): JudgeQuestion => ({
  id: `standard-${i}.contradicts-${id}`,
  primitive: "noul",
  instructions: `Does the "Standard:" line of evidence "standard-${i}" contradict ${other}?`,
  criteria:
    "yes: following one breaks the other. no: both can be followed — they are compatible or unrelated.",
})

// Each candidate against every kept standard and every candidate before it.
const questionsFor = (i: number, anchor: string, decided: readonly string[]): JudgeQuestion[] => [
  {
    id: `standard-${i}`,
    primitive: "noul",
    instructions: `Is the human's answer to review note "${anchor}" (evidence "standard-${i}") a reusable standard for this codebase — a rule later changes and reviews should follow — rather than a call about this one note? Its "Standard:" line is the wording gtd would keep.`,
    criteria:
      "yes: it states a rule or preference that applies beyond this note. no: it is specific to this note, a one-off call, or unclear.",
  },
  ...decided.map((_, k) =>
    contradicts(i, `${k + 1}`, `kept standard ${k + 1} (evidence "kept-${k + 1}")`),
  ),
  ...Array.from({ length: i - 1 }, (_, j) =>
    contradicts(i, `new-${j + 1}`, `the "Standard:" line of evidence "standard-${j + 1}"`),
  ),
]

const evidenceOf = (c: Candidate): string =>
  [
    `Note: ${c.decision.anchor}`,
    `Reviewer's text: ${c.decision.body}`,
    `Human's answer: ${c.decision.choice === "wontfix" ? "won't fix" : c.decision.text}`,
    `Standard: ${c.text}`,
  ].join("\n")

/**
 * One judge rest over every candidate. Only a confident `yes` on uncut
 * evidence makes a standard; a contradiction the judge does not confidently
 * rule out goes to the human instead of overwriting what they decided before.
 * Each kept standard is its own evidence key, so a long file cuts one, not all.
 */
const judged = async (
  candidates: readonly Candidate[],
  decided: readonly string[],
  minP: number,
): Promise<{ added: string[]; raised: Conflict[] }> => {
  const { answers, truncated } = await judge("review.standards.judge", {
    questions: candidates.flatMap((c, i) => questionsFor(i + 1, c.decision.anchor, decided)),
    evidence: Object.fromEntries([
      ...candidates.map((c, i) => [`standard-${i + 1}`, evidenceOf(c)]),
      ...decided.map((s, k) => [`kept-${k + 1}`, s]),
    ]),
    message:
      "Judging whether your answers are standards to keep: run `gtd judge run`, or land without a verdict, which keeps none.",
    label: "Learning your standards",
  })
  const ruledOut = (i: number, id: string): boolean =>
    answered(answers[`standard-${i}.contradicts-${id}`], "no", minP)
  const added: { i: number; text: string }[] = []
  const raised: Conflict[] = []
  candidates.forEach((c, n) => {
    const i = n + 1
    if (truncated.includes(`standard-${i}`)) return
    if (decided.some((_, k) => truncated.includes(`kept-${k + 1}`))) return
    if (!answered(answers[`standard-${i}`], "yes", minP)) return
    const olds = [
      ...decided.filter((_, k) => !ruledOut(i, `${k + 1}`)),
      ...added.filter((a) => !ruledOut(i, `new-${a.i}`)).map((a) => a.text),
    ]
    if (olds.length === 0) added.push({ i, text: c.text })
    else raised.push({ text: c.text, olds })
  })
  return { added: added.map((a) => a.text), raised }
}

/**
 * Settles every answer to a standard conflict, then learns standards from
 * the won't-fix ticks and own answers: kept in `.gtd/STANDARDS.md`, a
 * contradicting one as a new conflict note in `.gtd/REVIEW.md`.
 */
export const learnStandards = async (decisions: readonly ReviewDecision[]): Promise<void> => {
  const before = parseStandards(read(STANDARDS) ?? "")
  const rest = decisions.filter((d) => !isConflictTitle(d.anchor))
  const settled = decisions.filter((d) => isConflictTitle(d.anchor)).reduce(resolve, before)
  const known = new Set([...settled.decided, ...settled.undecided.map((c) => c.text)])
  const candidates = rest
    .flatMap(candidateOf)
    .filter((c, i, all) => !known.has(c.text) && all.findIndex((o) => o.text === c.text) === i)
  // Blank keeps none, so there is nothing to ask.
  const minP = numeric(vars.standardMinP, Infinity)
  const { added, raised } =
    candidates.length === 0 || !Number.isFinite(minP)
      ? { added: [], raised: [] }
      : await judged(candidates, settled.decided, minP)
  const after: Standards = {
    decided: [...settled.decided, ...added],
    undecided: [...settled.undecided, ...raised],
  }
  if (renderStandards(after) !== renderStandards(before)) {
    await run("review.standards.recording", writeScript(STANDARDS, renderStandards(after)), {
      label: "Recording your standards",
    })
  }
  if (raised.length > 0) {
    const chunks = raised.map((c) => `## ${conflictTitle(c)}\n\n${conflictBody(c)}`)
    await run(
      "review.standards.raising",
      writeScript(REVIEW, `${(read(REVIEW) ?? "").trimEnd()}\n\n${chunks.join("\n\n")}\n`),
      { label: "Asking about a contradicting standard", file: REVIEW },
    )
  }
}

/** A conflict's answer is settled by `learnStandards` alone. */
export const settlesStandard = (d: ReviewDecision): boolean => isConflictTitle(d.anchor)

/** Whether a standard conflict still waits on the human. */
export const standardsPending = (): boolean =>
  parseStandards(read(STANDARDS) ?? "").undecided.length > 0

/** Standards decided now that were not at `base`. */
export const standardsAddedSince = (base: string): readonly string[] => {
  const change = changesSince(base).get(STANDARDS)
  if (change === undefined) return []
  const was = new Set(parseStandards(change.before ?? "").decided)
  return parseStandards(change.after ?? "").decided.filter((s) => !was.has(s))
}
