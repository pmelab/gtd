import {
  answered,
  changes,
  changesSince,
  hasThreadFor,
  head,
  judge,
  numeric,
  read,
  refuse,
  removeScript,
  requireReplies,
  requireThreadsClosed,
  run,
  scope,
  sectionBodies,
  vars,
  type Change,
  type JudgeQuestion,
} from "../flows/index.js"
import { stripCodeThreads } from "../steering/index.js"
import { escalation, FIX_CAP, healthy, type EscalationCount } from "./health.js"
import {
  awaitReview,
  collecting,
  fix,
  fixQuality,
  QUALITY,
  REQUIREMENTS,
  REVIEW,
  reviewing,
  reviewMissing,
  reviewQuality,
} from "./steps.js"
import * as t from "./text.js"

/** The skills the quality lap reviews with, one turn each: the `qualityReviews` var. */
export const qualityLenses = (): readonly string[] => t.splitSkills(vars.qualityReviews)

/**
 * One review turn per lens over the whole change, each appending what it
 * finds blocking to `.gtd/QUALITY.md`. Resolves `"findings"` when that file
 * has any.
 */
export const qualityLap = async (): Promise<"clean" | "findings"> => {
  for (const lens of qualityLenses()) await reviewQuality(lens)
  return (read(QUALITY) ?? "").length > 0 ? "findings" : "clean"
}

/** Resolves `true` once `.gtd/QUALITY.md` is resolved, `false` when the fix cap escalated instead. */
export const fixQualityFindings = async (escalations: EscalationCount): Promise<boolean> => {
  for (let turns = 0; turns < FIX_CAP; turns++) {
    await fixQuality()
    if (changes(QUALITY).some((c) => c.status === "deleted")) return true
  }
  await escalation(escalations)
  return false
}

/** How a review round ended. `feedback` carries what the human edited, for the re-unwind to undo. */
export type ReviewOutcome =
  | { readonly verdict: "signoff" }
  | {
      readonly verdict: "feedback"
      /** The last round's commit, the re-plan base. */
      readonly base: string
      /** The commit `.gtd/REVIEW.md` was written at; edits are restored from it. */
      readonly restoreFrom: string
      /** The code paths the rounds changed, with their content before. */
      readonly edited: readonly Change[]
    }

/** One noul per `## ` chunk of `.gtd/REVIEW.md`: is its note actionable? */
const triageQuestions = (chunks: readonly string[]): JudgeQuestion[] =>
  chunks.map((title, i) => ({
    id: `chunk-${i + 1}`,
    primitive: "noul",
    instructions: `Is the note under review chunk "${title}" (in .gtd/REVIEW.md) actionable — anything beyond an approving remark with no code edit?`,
    criteria:
      "A concrete request, a question, a code comment, or a hand-edit under this chunk answers yes. No note, or a purely approving remark, answers no.",
  }))

/** A note-only round: judge whether any chunk of `review` asks for something. */
const actionable = async (review: string): Promise<boolean> => {
  const found = sectionBodies(review)
  const chunks = found.map((section) => section.title)
  const evidence = Object.fromEntries(found.map(({ body }, i) => [`chunk-${i + 1}`, body]))
  const { answers, truncated } = await judge("review.triage", {
    questions: triageQuestions(chunks),
    evidence,
    message: t.buildReviewTriageMessage(),
    label: "Judging feedback actionability",
  })
  // Dismissing a note is the risky direction, so only a confident "no" on
  // uncut evidence dismisses a chunk; a blank floor dismisses nothing.
  const minP = numeric(vars.reviewNoteActionable, Infinity)
  return (
    chunks.length === 0 ||
    chunks.some((_, i) => {
      const id = `chunk-${i + 1}`
      return truncated.includes(id) || !answered(answers[id], "no", minP)
    })
  )
}

const isCode = (path: string): boolean => path !== ".gtd" && !path.startsWith(".gtd/")

/** A code edit, not a thread-only change: lines that only add, answer or remove code threads don't count. */
const isCodeEdit = (c: Change): boolean =>
  isCode(c.path) &&
  stripCodeThreads(c.path, c.before ?? "") !== stripCodeThreads(c.path, c.after ?? "")

const collect = async (capture: string): Promise<"signoff" | "feedback"> => {
  await collecting(capture)
  if (read(REQUIREMENTS) !== undefined) return "feedback"
  if (changes().length === 0) return "signoff"
  return refuse(
    "gtd land: no declared pattern matches the pending changes — write .gtd/REQUIREMENTS.md from the feedback, or change nothing when it asks for nothing",
  )
}

/** A review with ticks, footnote markers and thread definitions removed: what is left is line notes. */
const notesOf = (text: string): string =>
  text
    .replace(/^\[\^[^\]]+\]:[^\n]*(\n(?: {2,}|\t)[^\n]*|\n(?=\s*\n(?: {2,}|\t)))*/gm, "")
    .replace(/\[\^[^\]]+\]/g, "")
    .replace(/\[x\]/gi, "[ ]")
    .replace(/\s+/g, " ")
    .trim()

/** Whether anything but thread edits and ticks landed in `.gtd/REVIEW.md` since `commit`. */
const notedSince = (commit: string): boolean =>
  changesSince(commit).some(
    (c) => c.path === REVIEW && notesOf(c.before ?? "") !== notesOf(read(REVIEW) ?? ""),
  )

/**
 * The human gate and its reply rounds: a question gets an answer inside
 * `.gtd/REVIEW.md` and rests at the gate again, without a lap. Resolves the
 * commit of the last `review.collecting` turn, `"missing"` when the round
 * left no review, or `undefined` when no such turn ran.
 */
const converse = async (base: string): Promise<string | undefined> => {
  let collectedAt: string | undefined
  for (;;) {
    await awaitReview(base)
    if (changes(REVIEW).some((c) => c.status === "deleted")) {
      refuse(
        "gtd land: review-doc: .gtd/REVIEW.md was deleted — restore it, or leave a note (or edit code) to request changes.",
      )
    }
    if (read(REVIEW) === undefined) {
      await reviewMissing(head())
      return "missing"
    }
    requireThreadsClosed(REVIEW)
    if (!hasThreadFor("agent", REVIEW)) return collectedAt
    await collecting(t.reviewEditsCapture(head()))
    collectedAt = head()
    requireReplies(REVIEW)
    if (!hasThreadFor("human", REVIEW)) return collectedAt
  }
}

/**
 * What the in-loop `review.collecting` turn left: `folded` when it wrote
 * REQUIREMENTS.md (those folds need their lap whatever is judged later),
 * `settled` when only thread edits and ticks landed after it.
 */
const afterCollect = (collectedAt: string | undefined): { folded: boolean; settled: boolean } =>
  // While the collecting turn is still pending its commit has no hash, so no
  // range can start there; the flow rests at `review.closing` before it matters.
  collectedAt === "" ? { folded: false, settled: false } : settledAfter(collectedAt)

const settledAfter = (collectedAt: string | undefined): { folded: boolean; settled: boolean } => ({
  folded: collectedAt !== undefined && read(REQUIREMENTS) !== undefined,
  settled:
    collectedAt !== undefined &&
    changesSince(collectedAt).every((c) => !isCodeEdit(c)) &&
    !notedSince(collectedAt),
})

const finish = async (
  reviewed: string,
  collectedAt: string | undefined,
): Promise<ReviewOutcome> => {
  const round = head()
  const since = changesSince(reviewed)
  const edited = since.filter(isCodeEdit)
  const record = read(REVIEW) ?? ""
  const { folded, settled } = afterCollect(collectedAt)
  // The review gate clears every tick before its commit, so a changed
  // REVIEW.md is a note, never a tick.
  const noted = since.some((c) => c.path === REVIEW)
  const outcome = (verdict: "signoff" | "feedback"): ReviewOutcome =>
    verdict === "signoff" ? { verdict } : { verdict, base: round, restoreFrom: reviewed, edited }
  await run("review.closing", removeScript([REVIEW]), {
    label: "Closing the review",
    base: round,
  })
  if (settled) return outcome(folded ? "feedback" : "signoff")
  if (edited.length > 0) return outcome(await collect(t.reviewEditsCapture(round)))
  if (!noted || !(await actionable(record))) return outcome(folded ? "feedback" : "signoff")
  return outcome(await collect(t.reviewNotesCapture(round)))
}

/**
 * A reviewer writes `.gtd/REVIEW.md` over everything since `base`, a human
 * reviews and signs off or comments, and a comment is classified into
 * requirements for another lap.
 */
export const review = async (base: string): Promise<ReviewOutcome> => {
  for (;;) {
    await reviewing(base)
    const reviewed = head()
    const collectedAt = await converse(base)
    if (collectedAt !== "missing") return finish(reviewed, collectedAt)
  }
}

/** The build tail: fix (when entered red), keep green, the quality lap, then human review since `base`. */
export const buildTail = (fixFirst: boolean, base: string): Promise<ReviewOutcome> =>
  scope("build", async () => {
    const escalations: EscalationCount = { rounds: 0 }
    let redFirst = fixFirst
    // The lap runs once a tail: after its findings are fixed, review follows.
    let lapped = false
    for (;;) {
      if (redFirst) {
        await fix()
        await healthy(fix, { fixesSoFar: 1, escalations })
        redFirst = false
      }
      const lap = lapped ? "clean" : await qualityLap()
      lapped = true
      if (lap === "clean") return review(base)
      if (await fixQualityFindings(escalations)) await healthy(fix, { escalations })
      else redFirst = true
    }
  })
