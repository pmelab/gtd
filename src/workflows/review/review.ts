import { removeScript, run, start, type WorkflowBase } from "../../flows/index.js"
import { buildTail, reUnwind } from "../shared/review.js"
import { gate } from "../shared/health.js"
import { shipped } from "../shared/options.js"
import { coder, REQUIREMENTS } from "../shared/steps.js"
import { refusePendingHandOff } from "../shared/tail.js"
import * as t from "../shared/text.js"

/** Build the concerns a review round collected into `.gtd/REQUIREMENTS.md`, then remove it. */
const fixFeedback = async (): Promise<void> => {
  await t.agentWithSkills("feedback.fixing", t.reviewFeedbackFixPrompt(), {
    label: "Fixing your review feedback",
    file: REQUIREMENTS,
    model: coder(),
    system: t.finisherSystem(),
  })
  await run("feedback.closing", removeScript([REQUIREMENTS]), { label: "Closing the feedback" })
}

/**
 * The feature's review of everything since `reviewBase` — a green gate, the
 * triaged quality lap, then the human review — with no design phase: a
 * review that asks for changes is fixed in place and reviewed again, until
 * sign-off.
 */
export const reviewFlow = async (): Promise<void> => {
  refusePendingHandOff()
  await gate("review-gate", t.reviewGateBlockedMessage())
  const base = start()
  // The gate just proved the tree green.
  let outcome = await buildTail(base, { green: true })
  while (outcome.verdict === "feedback") {
    await reUnwind(outcome)
    await fixFeedback()
    // The human reviews the whole change again; the lenses only what the fix changed.
    outcome = await buildTail(base, { lensBase: outcome.base })
  }
}

export const review = shipped(
  reviewFlow,
  {
    review: {
      args: [{ name: "base", optional: true }],
      // Annotated: inferred, the literal union only fits under exactOptionalPropertyTypes.
      vars: ({ base }): Readonly<Record<string, string>> =>
        base === undefined ? {} : { reviewBase: base },
    },
  },
  (_workflow, vars) => vars.reviewBase || "",
)

/** @deprecated The `review` factory carries its own base; kept so a hand-written `review` re-exporting it still maps `reviewBase`. */
export const base: WorkflowBase = (workflow, vars) =>
  workflow === "review" ? (vars.reviewBase ?? "") : undefined
