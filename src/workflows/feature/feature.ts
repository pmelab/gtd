import {
  changes,
  head,
  human,
  requireRevert,
  restoreScript,
  revertScript,
  run,
  start,
} from "../../flows/index.js"
import { gate } from "../shared/health.js"
import { shipped } from "../shared/options.js"
import type { FrozenScenarios } from "../shared/scenarios.js"
import { FEEDBACK, REVIEW } from "../shared/steps.js"
import { refusePendingHandOff } from "../shared/tail.js"
import * as t from "../shared/text.js"
import { packages } from "./packages.js"
import { architecture, design } from "./planning.js"
import { buildTail, type ReviewOutcome } from "./review.js"

// The ordinary start. Any change to the tree starts a process: `idle` →
// `unwind` reverts the sketch (its intent survives in history) → a
// green-baseline gate → design, architecture and one package per concern →
// the quality lap → human review, which signs off (the episode ends back at
// `idle`) or sends a full re-plan lap.

/** Revert the sketch that started the process out of the working tree; its intent survives in history. */
export const unwind = (): Promise<void> => {
  const commit = head()
  return run("unwind", revertScript(commit, FEEDBACK, t.unwindFailure(commit)), {
    label: "Unwinding your input",
  })
}

/**
 * Undo the human's review-round code edits. A path changed since the human
 * left it is not overwritten; requireRevert names it instead.
 */
export const reUnwind = async (
  feedback: Extract<ReviewOutcome, { verdict: "feedback" }>,
): Promise<void> => {
  const { base, restoreFrom, edited } = feedback
  const restore = edited.filter((c) => c.status !== "added").map((c) => c.path)
  const remove = edited.filter((c) => c.status === "added").map((c) => c.path)
  await run("re-unwind", restoreScript(base, { restore, remove }, restoreFrom), {
    label: "Re-unwinding your review edit",
    file: REVIEW,
    base,
  })
  requireRevert(edited, base)
}

/** Plan, build and review until a review round signs off; feedback re-plans from scratch. */
export const planAndBuild = async (firstBase: string): Promise<void> => {
  let base = firstBase
  let carried: FrozenScenarios | undefined
  for (;;) {
    await design(base)
    await architecture()
    const built = await packages(carried)
    carried = built.frozen
    const outcome = await buildTail(false, base, built)
    if (outcome.verdict === "signoff") return
    await reUnwind(outcome)
    base = outcome.base
  }
}

/** After a tail that skipped planning: stop on sign-off, re-plan on feedback. */
export const afterTail = async (outcome: ReviewOutcome): Promise<void> => {
  if (outcome.verdict === "signoff") return
  await reUnwind(outcome)
  await planAndBuild(outcome.base)
}

/** An ordinary start: wait at `idle`, unwind the sketch, check the baseline, then plan and build. */
export const ordinaryStart = async (): Promise<void> => {
  await human("idle", { message: t.idleMessage(), label: "Idle", file: ".gtd/TODO.md" })
  refusePendingHandOff()
  await unwind()
  if (changes(FEEDBACK).some((c) => c.status !== "deleted")) {
    await human("unwind-failed", {
      message: t.unwindFailedMessage(),
      label: "Could not unwind your input",
      file: FEEDBACK,
    })
  }
  await gate("start-gate", t.startGateBlockedMessage())
  await planAndBuild(start())
}

export const feature = shipped(ordinaryStart)
