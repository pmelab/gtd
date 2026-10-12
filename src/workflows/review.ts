import {
  answered,
  judge,
  numeric,
  removeScript,
  run,
  scope,
  vars,
  type JudgeQuestion,
} from "../flows/index.js"
import type { ReviewNote } from "../steering/index.js"
import * as kit from "../workflow-kit/index.js"
import { escalation, FIX_CAP, healthy, type EscalationCount } from "./health.js"
import type { BuiltPlan } from "./packages.js"
import { guarded, type FrozenScenarios } from "./scenarios.js"
import {
  answerReviewQuestions,
  ARCHITECTURE,
  awaitReview,
  collecting,
  fixCheck,
  fixNits,
  fixQuality,
  fixRisks,
  QUALITY,
  REQUIREMENTS,
  REVIEW,
  reviewing,
  reviewMissing,
  reviewQuality,
} from "./steps.js"
import * as t from "./text.js"

/** Split a `qualityReviews` value into its lenses: on `,`, trimmed, blanks dropped. */
export const lensesOf = kit.lensesOf

/**
 * One review turn per lens over the whole change, each appending every
 * finding to `.gtd/QUALITY.md`. Resolves `"findings"` when that file
 * has any.
 */
export const qualityLap = (): Promise<"clean" | "findings"> =>
  kit.qualityLap(lensesOf(vars.qualityReviews ?? ""), reviewQuality, QUALITY)

/** Resolves `true` once `.gtd/QUALITY.md` is resolved, `false` when the fix cap escalated instead. */
export const fixQualityFindings = (
  escalations: EscalationCount,
  frozen?: FrozenScenarios,
): Promise<boolean> =>
  kit.fixFindings({
    fix: guarded(frozen, fixQuality),
    findings: QUALITY,
    cap: FIX_CAP,
    escalate: () => escalation(escalations),
  })

export type { ReviewOutcome } from "../workflow-kit/index.js"

const VERDICTS: readonly kit.Verdict[] = ["edit", "question", "nit", "praise"]

/** One four-way choice per note the human added to `.gtd/REVIEW.md`. */
const verdictQuestion = (note: ReviewNote): JudgeQuestion => ({
  id: note.id,
  primitive: "choice",
  instructions: `Classify the human's note on review item "${note.anchor}" (in .gtd/REVIEW.md). Its evidence holds the anchor, the reviewer's text and the human's text.`,
  criteria:
    "edit: a request to change behaviour, design or scope — anything needing a plan, or any note you are unsure about. question: asks something and wants an answer, with no change requested. nit: a small, local, unambiguous fix (naming, typo, formatting, comment wording) needing no re-plan. praise: an approving remark with nothing to do.",
})

/**
 * One judge rest, one verdict per note. Dismissing a note is the risky
 * direction, so only a confident non-`edit` verdict on uncut evidence counts;
 * a cut, unanswered or below-floor note is an `edit`, and a blank floor makes
 * every note one.
 */
const triage = async (notes: readonly ReviewNote[]): Promise<ReadonlyMap<string, kit.Verdict>> => {
  const { answers, truncated } = await judge("review.triage", {
    questions: notes.map(verdictQuestion),
    evidence: Object.fromEntries(
      notes.map((n) => [
        n.id,
        `Anchor: ${n.anchor}\nReviewer's text: ${n.before}\nHuman's text: ${n.text}`,
      ]),
    ),
    message: t.buildReviewTriageMessage(),
    label: "Judging each note",
  })
  const minP = numeric(vars.reviewNoteActionable, Infinity)
  return new Map(
    notes.map((n): [string, kit.Verdict] => {
      const verdict = VERDICTS.find((v) => v !== "edit" && answered(answers[n.id], v, minP))
      return [n.id, truncated.includes(n.id) || verdict === undefined ? "edit" : verdict]
    }),
  )
}

const isCode = (path: string): boolean => path !== ".gtd" && !path.startsWith(".gtd/")

/**
 * A reviewer writes `.gtd/REVIEW.md` over everything since `base`, a human
 * reviews and signs off or comments, and each note is judged: edits go to
 * another planning lap, questions are answered in place, nits fixed in one
 * batch, praise dropped.
 */
export const review = (
  base: string,
  escalations: EscalationCount = { rounds: 0 },
  frozen?: FrozenScenarios,
): Promise<kit.ReviewOutcome> =>
  kit.review(base, {
    file: REVIEW,
    feedback: REQUIREMENTS,
    isCode,
    reviewing,
    fixRisks: (risks) => guarded(frozen, () => fixRisks(risks), "review")(),
    keepGreen: () => healthy(guarded(frozen, fixCheck, "review"), { escalations }),
    awaitReview,
    reviewMissing,
    collecting,
    triage,
    answerQuestions: answerReviewQuestions,
    fixNits: (notes) => guarded(frozen, () => fixNits(notes), "review")(),
    close: (round) =>
      run("review.closing", removeScript([REVIEW]), { label: "Closing the review", base: round }),
    captures: {
      edits: t.reviewEditsCapture,
      notes: t.reviewNotesCapture,
      editNotes: t.reviewEditNotesCapture,
    },
    refusals: {
      deleted:
        "gtd land: review-doc: .gtd/REVIEW.md was deleted — restore it, or leave a note (or edit code) to request changes.",
      unmatched:
        "gtd land: no declared pattern matches the pending changes — write .gtd/REQUIREMENTS.md from the feedback, or change nothing when it asks for nothing",
    },
  })

/** The build tail: fix (when entered red), keep green, the quality lap, then human review since `base`. */
export const buildTail = (
  fixFirst: boolean,
  base: string,
  built?: BuiltPlan,
): Promise<kit.ReviewOutcome> =>
  scope("build", async () => {
    const frozen = built?.frozen
    const escalations: EscalationCount = { rounds: 0 }
    const guardedFix = guarded(frozen, () => fixCheck())
    let redFirst = fixFirst
    // fixFirst's own fix + healthy below already is the full run.
    if (!fixFirst) {
      await healthy(
        guarded(frozen, () => fixCheck(built)),
        { escalations, sweepOnGreen: [ARCHITECTURE] },
      )
    }
    // The lap runs once a tail: after its findings are fixed, review follows.
    let lapped = false
    for (;;) {
      if (redFirst) {
        await guardedFix()
        await healthy(guardedFix, { fixesSoFar: 1, escalations })
        redFirst = false
      }
      const lap = lapped ? "clean" : await qualityLap()
      lapped = true
      if (lap === "clean") return review(base, escalations, frozen)
      if (await fixQualityFindings(escalations, frozen)) {
        await healthy(guardedFix, { escalations })
      } else redFirst = true
    }
  })
