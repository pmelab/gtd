import { quote, read, refuse, removeScript, run, scope, vars } from "../../flows/index.js"
import * as kit from "../../workflow-kit/index.js"
import { escalation, FIX_CAP, healthy, type EscalationCount } from "./health.js"
import { guarded, type FrozenScenarios } from "./scenarios.js"
import {
  ARCHITECTURE,
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
import type { BuildContext } from "./text.js"

/** The reviewer's own `.gtd/REVIEW.md`, kept beside the human's notes so `fix` can tell them apart. */
export const REVIEW_ORIG = ".gtd/REVIEW.orig.md"

/**
 * One review turn per lens over the whole change, each appending every
 * finding to `.gtd/QUALITY.md`. Resolves `"findings"` when that file
 * has any.
 */
export const qualityLap = (): Promise<"clean" | "findings"> =>
  kit.qualityLap(kit.lensesOf(vars.qualityReviews ?? ""), reviewQuality, QUALITY)

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

/** What the tail's full run knows of a plan the process built. */
export interface TailPlan extends BuildContext {
  readonly frozen: FrozenScenarios | undefined
}

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
 * `finish` — the human review, as the calling workflow runs it.
 */
export const tail = <T>(
  fixFirst: boolean,
  finish: (escalations: EscalationCount, frozen: FrozenScenarios | undefined) => Promise<T>,
  built?: TailPlan,
): Promise<T> =>
  scope("build", async () => {
    const frozen = built?.frozen
    const escalations: EscalationCount = { rounds: 0 }
    const guardedFix = guarded(frozen, () => fixCheck())
    const repair = async () => {
      await guardedFix()
      await healthy(guardedFix, { fixesSoFar: 1, escalations })
    }
    // fixFirst's own fix + healthy below already is the full run.
    if (fixFirst) await repair()
    else {
      await healthy(
        guarded(frozen, () => fixCheck(built)),
        { escalations, sweepOnGreen: [ARCHITECTURE] },
      )
    }
    // The lap runs once a tail: after its findings are fixed, review follows.
    if ((await qualityLap()) === "findings") {
      if (await fixQualityFindings(escalations, frozen)) {
        await healthy(guardedFix, { escalations })
      } else await repair()
    }
    return finish(escalations, frozen)
  })

// The committed blob, not the working copy: the human's notes already landed over it.
const handOffScript = (reviewed: string): string =>
  [
    "#!/usr/bin/env sh",
    "set -e",
    `git show ${quote(`${reviewed}:${REVIEW}`)} > ${quote(REVIEW_ORIG)}`,
    "",
  ].join("\n")

/**
 * The review and fix workflows' human review since `base`: a sign-off closes
 * `.gtd/REVIEW.md`; a note leaves it, with the reviewer's own version as
 * `REVIEW_ORIG`, for the next `fix` to read — never a re-plan.
 */
export const handOffReview = (base: string, escalations: EscalationCount): Promise<void> =>
  kit.reviewToHandOff(base, {
    file: REVIEW,
    reviewing,
    fixRisks,
    keepGreen: () => healthy(() => fixCheck(), { escalations }),
    awaitReview: (b) => awaitReview(b, t.handOffAwaitReviewMessage(b)),
    reviewMissing,
    close: closeReview,
    handOff: (reviewed) =>
      run("review.handing-off", handOffScript(reviewed), {
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
export const handOffTail = (fixFirst: boolean, base: string): Promise<void> =>
  tail(fixFirst, (escalations) => handOffReview(base, escalations))
