// Building blocks workflows share. Policy-free: every skill list,
// lens, prompt, step, path and threshold arrives as a parameter, so a new
// workflow composes these without inheriting the shipped one's choices.
import * as review from "./review.js"

export {
  escalation,
  gate,
  healthy,
  untilSettled,
  type EscalationCount,
  type EscalationSteps,
  type Health,
  type RetryVerdict,
} from "./health.js"
export {
  fixFindings,
  lensEntriesOf,
  lensOf,
  lensesOf,
  lensScopes,
  qualityLap,
  type FindingsFix,
  type LensEntry,
} from "./quality.js"
export {
  assertionLines,
  removedAssertions,
  type Assertion,
  type RemovedAssertions,
} from "./scenarios.js"
export {
  review,
  reviewToHandOff,
  type CollectRound,
  type HandOffPolicy,
  type Requested,
  type ReviewOutcome,
  type ReviewPolicy,
  type ReviewRisk,
  type Verdict,
} from "./review.js"

/** @deprecated Internal to `review()`, which routes every round's notes itself. Leaves this entrypoint in a later major. */
export const routeNotes = review.routeNotes
/** @deprecated `routeNotes`' round. Leaves this entrypoint in a later major. */
export type ReviewRound = review.Round
/** @deprecated `routeNotes`' result. Leaves this entrypoint in a later major. */
export type ReviewFinish = review.Finish
