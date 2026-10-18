import { changes, head, human, revertScript, run, slice, start, vars } from "../../flows/index.js"
import { gate } from "../shared/health.js"
import { shipped } from "../shared/options.js"
import { FEEDBACK } from "../shared/steps.js"
import { refusePendingHandOff } from "../shared/tail.js"
import * as t from "../shared/text.js"
import { packages } from "./packages.js"
import { architecture, design } from "./planning.js"
import { buildTail, reUnwind, type ReviewOutcome } from "./review.js"
import { implement, seamBuild } from "./seam.js"
import { recordRisk, riskTierOn } from "./tier.js"

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

export { reUnwind }

/** Plan, build and review until a review round signs off; feedback re-plans from scratch. */
export const planAndBuild = async (firstBase: string): Promise<void> => {
  // GTD_FLAG_NAIVE_PASS: the record is pinned at the process start, so a mid-process flip never moves a process.
  if (vars.flag_naive_pass === "1") return naivePlanAndBuild(firstBase)
  let base = firstBase
  for (;;) {
    await design(base)
    await architecture()
    await packages()
    const outcome = await buildTail(false, base, true)
    if (outcome.verdict === "signoff") return
    await reUnwind(outcome)
    base = outcome.base
  }
}

// seam.naive / seam.judge run once: a feedback lap is design → implement on every verdict, so a
// seam a re-plan turns up is built unjudged and unrefactored.
const naivePlanAndBuild = async (firstBase: string): Promise<void> => {
  await design(firstBase)
  const tier = riskTierOn() ? recordRisk() : undefined
  const seam = await seamBuild(firstBase)
  await slice("feature", async () => {
    await implement(seam.reference, tier)
    await featureFeedback(await buildTail(false, seam.base, true))
  })
}

// `lensBase` is accepted for the per-slice quality lap; not yet threaded.
const featureFeedback = async (first: ReviewOutcome, _lensBase?: string): Promise<void> => {
  let outcome = first
  while (outcome.verdict === "feedback") {
    await reUnwind(outcome)
    await design(outcome.base)
    const tier = riskTierOn() ? recordRisk() : undefined
    await implement(undefined, tier)
    outcome = await buildTail(false, outcome.base, true)
  }
}

/** After a tail that skipped planning: stop on sign-off, re-plan on feedback. Opens no slice: slices cannot nest. */
export const afterTail = async (outcome: ReviewOutcome): Promise<void> => {
  if (outcome.verdict === "signoff") return
  if (vars.flag_naive_pass === "1") return featureFeedback(outcome)
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
