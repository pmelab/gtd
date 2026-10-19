import {
  changes,
  changesSince,
  head,
  human,
  revertScript,
  run,
  slice,
  start,
} from "../../flows/index.js"
import { gate } from "../shared/health.js"
import { flagModeOn, shipped } from "../shared/options.js"
import { FEEDBACK } from "../shared/steps.js"
import { refusePendingHandOff } from "../shared/tail.js"
import * as t from "../shared/text.js"
import { design } from "./planning.js"
import { buildTail, isCode, reUnwind, type ReviewOutcome } from "./review.js"
import { implement, seamBuild, type SeamOutcome } from "./seam.js"
import { recordRisk, riskTierOn } from "./tier.js"

// The ordinary start. Any change to the tree starts a process: `idle` →
// `unwind` reverts the sketch (its intent survives in history) → a
// green-baseline gate → design → a judged naive pass (refactoring first when
// the judge asks; with `flagMode` off, neither) → implement → the quality lap
// → human review, which signs off (the episode ends back at `idle`) or sends a
// design → implement lap.

/** Revert the sketch that started the process out of the working tree; its intent survives in history. */
export const unwind = (): Promise<void> => {
  const commit = head()
  return run("unwind", revertScript(commit, FEEDBACK, t.unwindFailure(commit)), {
    label: "Unwinding your input",
  })
}

export { reUnwind }

// seam.naive / seam.judge run once: a feedback lap is design → implement on every verdict, so a
// seam a re-plan turns up is built unjudged and unrefactored.
/** A judged naive pass (none with `flagMode` off), then implement and review until a review round signs off; design must have run since `firstBase`. */
export const buildFeature = async (firstBase: string): Promise<void> => {
  const tier = riskTierOn() ? recordRisk() : undefined
  const seam: Omit<SeamOutcome, "reference"> & { reference?: string } = flagModeOn()
    ? await seamBuild(firstBase)
    : { base: firstBase }
  await slice("feature", async () => {
    await implement({ reference: seam.reference, tier, afterRefactor: seam.refactored })
    // An empty feature slice: the refactor carried the feature, so review the whole change.
    const base =
      seam.refactored === true && !changesSince(seam.base).some((c) => isCode(c.path))
        ? firstBase
        : seam.base
    await featureFeedback(await buildTail(base, { green: true, lensBase: base }), base)
  })
}

/** Design, then `buildFeature`. */
export const planAndBuild = async (firstBase: string): Promise<void> => {
  await design(firstBase)
  await buildFeature(firstBase)
}

const featureFeedback = async (first: ReviewOutcome, lensBase?: string): Promise<void> => {
  let outcome = first
  while (outcome.verdict === "feedback") {
    await reUnwind(outcome)
    await design(outcome.base)
    const tier = riskTierOn() ? recordRisk() : undefined
    await implement({ tier, amend: true })
    outcome = await buildTail(outcome.base, { green: true, lap: "feedback", lensBase })
  }
}

/** After a tail that skipped planning: stop on sign-off, re-plan on feedback. Opens no slice: slices cannot nest. */
export const afterTail = (outcome: ReviewOutcome): Promise<void> => featureFeedback(outcome)

/** An ordinary start: wait at `idle`, unwind the sketch, check the baseline, then plan and build. */
export const ordinaryStart = async (): Promise<void> => {
  await human("idle", { message: t.idleMessage(), label: "Idle", file: ".gtd/TODO.md" })
  refusePendingHandOff()
  // Read right after idle, so a bad value refuses the landing that would pin it.
  flagModeOn()
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
