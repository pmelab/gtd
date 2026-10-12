import { start, type WorkflowBase } from "../../flows/index.js"
import { gate } from "../shared/health.js"
import { shipped } from "../shared/options.js"
import { handOffTail, refusePendingHandOff } from "../shared/tail.js"
import * as t from "../shared/text.js"

/**
 * Pure review of everything since `reviewBase`: a green gate, the quality
 * lap, then the human review. A note ends the process with `.gtd/REVIEW.md`
 * left for `fix`; it never re-plans.
 */
export const reviewFlow = async (): Promise<void> => {
  refusePendingHandOff()
  await gate("review-gate", t.reviewGateBlockedMessage())
  await handOffTail(false, start())
}

export const review = shipped(
  reviewFlow,
  {
    review: {
      args: [{ name: "base", optional: true }],
      vars: ({ base }) => (base === undefined ? {} : { reviewBase: base }),
    },
  },
  (_workflow, vars) => vars.reviewBase || "",
)

/** @deprecated The `review` factory carries its own base; kept so a hand-written `review` re-exporting it still maps `reviewBase`. */
export const base: WorkflowBase = (workflow, vars) =>
  workflow === "review" ? (vars.reviewBase ?? "") : undefined
