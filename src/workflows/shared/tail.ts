import { read, refuse, removeScript, run, scope, showScript, vars } from "../../flows/index.js"
import * as kit from "../../workflow-kit/index.js"
import {
  escalation,
  FIX_CAP,
  guarded,
  healthy,
  type EscalationCount,
  type Guard,
} from "./health.js"
import {
  awaitReview,
  fixCheck,
  fixQuality,
  fixRisks,
  QUALITY,
  REVIEW,
  reviewing,
  reviewMissing,
  reviewQuality,
} from "./steps.js"
import * as t from "./text.js"

/** The reviewer's own `.gtd/REVIEW.md`, kept beside the human's notes so `fix` can tell them apart. */
export const REVIEW_ORIG = ".gtd/REVIEW.orig.md"

/**
 * One review turn per lens over the whole change, each appending every
 * finding to `.gtd/QUALITY.md`. Resolves `"findings"` when that file
 * has any.
 */
export const qualityLap = (guard?: Guard): Promise<"clean" | "findings"> =>
  kit.qualityLap(kit.lensesOf(vars.qualityReviews ?? ""), guarded(reviewQuality, guard), QUALITY)

/** Resolves `true` once `.gtd/QUALITY.md` is resolved, `false` when the fix cap escalated instead. */
export const fixQualityFindings = (escalations: EscalationCount, guard?: Guard): Promise<boolean> =>
  kit.fixFindings({
    fix: guarded(fixQuality, guard),
    findings: QUALITY,
    cap: FIX_CAP,
    escalate: () => escalation(escalations, guard),
  })

/** `.gtd/REVIEW.md` removed at the end of a round at commit `round`. */
export const closeReview = (round: string): Promise<void> =>
  run("review.closing", removeScript([REVIEW, REVIEW_ORIG]), {
    label: "Closing the review",
    base: round,
  })

/** Refuses while a reviewer's notes still await `gtd door fix`. */
export const refusePendingHandOff = (): void => {
  if (read(REVIEW_ORIG) !== undefined) {
    refuse(
      `gtd: ${REVIEW_ORIG} is a pending hand-off — run \`gtd door fix\`, or remove ${REVIEW} and ${REVIEW_ORIG}.`,
    )
  }
}

/**
 * The build tail: fix (when entered red), keep green, the quality lap, then
 * `finish` — the human review, as the calling workflow runs it. `green`: the
 * caller just left the full suite green (the package loop), so no run opens it.
 */
export const tail = <T>(
  fixFirst: boolean,
  finish: (escalations: EscalationCount) => Promise<T>,
  green = false,
  guard?: Guard,
): Promise<T> =>
  scope("build", async () => {
    const escalations: EscalationCount = { rounds: 0 }
    const fix = fixCheck
    const repair = async () => {
      await guarded(fix, guard)()
      await healthy(fix, { fixesSoFar: 1, escalations, guard })
    }
    // fixFirst's own fix + healthy below already is the full run.
    if (fixFirst) await repair()
    else if (!green) await healthy(fix, { escalations, guard })
    // The lap runs once a tail: after its findings are fixed, review follows.
    if ((await qualityLap(guard)) === "findings") {
      if (await fixQualityFindings(escalations, guard)) {
        await healthy(fix, { escalations, guard })
      } else await repair()
    }
    return finish(escalations)
  })

/**
 * The review and fix workflows' human review since `base`: a sign-off closes
 * `.gtd/REVIEW.md`; a note leaves it, with the reviewer's own version as
 * `REVIEW_ORIG`, for the next `fix` to read — never a re-plan.
 */
export const handOffReview = (
  base: string,
  escalations: EscalationCount,
  guard?: Guard,
): Promise<void> =>
  kit.reviewToHandOff(base, {
    file: REVIEW,
    reviewing: guarded(reviewing, guard),
    fixRisks: guarded(fixRisks, guard),
    keepGreen: () => healthy(fixCheck, { escalations, guard }),
    awaitReview: (b) => awaitReview(b, t.handOffAwaitReviewMessage(b)),
    reviewMissing,
    close: closeReview,
    handOff: (reviewed) =>
      // The committed blob, not the working copy: the human's notes already landed over it.
      run("review.handing-off", showScript(reviewed, REVIEW, REVIEW_ORIG), {
        label: "Handing your notes to fix",
      }),
    threadsPending:
      "gtd land: open-threads: a thread in .gtd/REVIEW.md or an `H:` code comment waits on the agent — nothing answers it here; delete it, or turn it into a note for fix.",
    unparsed:
      "gtd land: review-doc: your edit to .gtd/REVIEW.md contains no note fix can read — restore the deleted chunk, or write the note as a line under its entry.",
    deleted:
      "gtd land: review-doc: .gtd/REVIEW.md was deleted — restore it, or leave a note to hand to fix.",
  })

/** The tail the review and fix workflows run: ends at the hand-off review since `base`. */
export const handOffTail = (fixFirst: boolean, base: string, guard?: Guard): Promise<void> =>
  tail(fixFirst, (escalations) => handOffReview(base, escalations, guard), false, guard)
