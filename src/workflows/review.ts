import {
  changes,
  codeChanges,
  head,
  judge,
  numeric,
  read,
  refuse,
  removeScript,
  run,
  scope,
  sectionBodies,
  sections,
  vars,
  wrote,
  type Change,
  type JudgeQuestion,
} from "../flows/index.js"
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
export const qualityLenses = (): readonly string[] =>
  (vars.qualityReviews ?? "")
    .split(",")
    .map((lens) => lens.trim())
    .filter((lens) => lens !== "")

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
      /** The commit the human's review edit landed as. */
      readonly base: string
      /** The code paths that edit changed, with their content before it. */
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
  const chunks = sections(review)
  const bodies = sectionBodies(review, chunks)
  const evidence = Object.fromEntries(chunks.map((_, i) => [`chunk-${i + 1}`, bodies[i]!]))
  const { answers, truncated } = await judge("review.triage", {
    questions: triageQuestions(chunks),
    evidence,
    message: t.buildReviewTriageMessage(),
    label: "Judging feedback actionability",
  })
  const minP = numeric(vars.reviewNoteActionable, 0)
  // A chunk counts as actionable unless the judge confidently said no, or
  // said yes without enough confidence; a cut or unanswered chunk is actionable.
  return (
    chunks.length === 0 ||
    chunks.some((_, i) => {
      const id = `chunk-${i + 1}`
      const answer = answers[id]
      if (truncated.includes(id) || answer === undefined) return true
      if (answer.answer === "no") return false
      return answer.p >= minP
    })
  )
}

const collect = async (capture: string): Promise<"signoff" | "feedback"> => {
  await collecting(capture)
  if (wrote(REQUIREMENTS)) return "feedback"
  if (changes().length === 0) return "signoff"
  return refuse(
    "gtd land: no declared pattern matches the pending changes — write .gtd/REQUIREMENTS.md from the feedback, or change nothing when it asks for nothing",
  )
}

/**
 * A reviewer writes `.gtd/REVIEW.md` over everything since `base`, a human
 * reviews and signs off or comments, and a comment is classified into
 * requirements for another lap.
 */
export const review = async (base: string): Promise<ReviewOutcome> => {
  for (;;) {
    await reviewing(base)
    await awaitReview(base)
    if (changes(REVIEW).some((c) => c.status === "deleted")) {
      refuse(
        "gtd land: review-doc: .gtd/REVIEW.md was deleted — restore it, or leave a note (or edit code) to request changes.",
      )
    }
    const edited = codeChanges()
    const round = head()
    const record = read(REVIEW)
    if (record === undefined) {
      await reviewMissing(round)
      continue
    }
    // The review gate clears every tick before its commit, so a changed
    // REVIEW.md is a note, never a tick.
    const noted = changes(REVIEW).length > 0
    const outcome = (verdict: "signoff" | "feedback"): ReviewOutcome =>
      verdict === "signoff" ? { verdict } : { verdict, base: round, edited }
    await run("review.closing", removeScript([REVIEW]), {
      label: "Closing the review",
      base: round,
    })
    if (edited.length > 0) return outcome(await collect(t.reviewEditsCapture(round)))
    if (!noted || !(await actionable(record))) return { verdict: "signoff" }
    return outcome(await collect(t.reviewNotesCapture(round)))
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
