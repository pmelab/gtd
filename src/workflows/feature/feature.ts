import {
  changes,
  changesSince,
  head,
  human,
  read,
  revertScript,
  run,
  slice,
  start,
} from "../../flows/index.js"
import { gate, healthy } from "../shared/health.js"
import { flagModeOn, shipped } from "../shared/options.js"
import { FEEDBACK, fixCheck, QUALITY } from "../shared/steps.js"
import { refusePendingHandOff, tail } from "../shared/tail.js"
import * as t from "../shared/text.js"
import { skipDesign, statedCriteria, type StatedCriteria } from "./criteria.js"
import { design } from "./planning.js"
import { buildTail, isCode, reUnwind, type ReviewOutcome } from "./review.js"
import { implement, seamBuild } from "./seam.js"
import { recordRisk, riskTierOn } from "./tier.js"

// The ordinary start. Any change to the tree starts a process: `idle` →
// `unwind` reverts the sketch (its intent survives in history) → a
// green-baseline gate → design → a naive pass, judged with `flagMode` on: it
// lands as the implementation, or (refactoring first when the judge asks) is
// built fresh from → the health loop → the quality lap, and the episode ends
// back at `idle`. Human review is the `review` door's.

/** Revert the sketch that started the process out of the working tree; its intent survives in history. */
export const unwind = (): Promise<void> => {
  const commit = head()
  return run("unwind", revertScript(commit, FEEDBACK, t.unwindFailure(commit)), {
    label: "Unwinding your input",
  })
}

export { reUnwind }

/** A naive pass (judged only with `flagMode` on), then implement and the quality lap; design must have run since `firstBase`. */
export const buildFeature = async (firstBase: string): Promise<void> => {
  const tier = riskTierOn() ? recordRisk() : undefined
  const seam = await seamBuild(firstBase)
  await slice("feature", async () => {
    await implement({
      reference: seam.reference,
      tier,
      afterRefactor: seam.refactored,
      naive: seam.land === true ? seam.reference : undefined,
      rebuild: seam.rebuild,
    })
    // A feature slice with no code beyond the carried-over tests: the refactor carried the
    // feature, so the lap covers the whole change.
    const carried = seam.rebuild?.acceptance?.tests ?? []
    const base =
      seam.refactored === true &&
      !changesSince(seam.base).some((c) => isCode(c.path) && !carried.includes(c.path))
        ? firstBase
        : seam.base
    await tail(settleQuality, { green: true, lensBase: base })
  })
}

// The lap is feature's last look: findings the fix cap left must not end the process, nor reach
// the next one's lap, which appends to the file. Empty counts as resolved, as the lap reads it.
const settleQuality = async (): Promise<void> => {
  let rested = false
  while ((read(QUALITY) ?? "").length > 0) {
    rested = true
    await human("quality-unresolved", {
      message: t.qualityUnresolvedMessage(),
      label: "Quality findings left unresolved",
      file: QUALITY,
    })
  }
  // The person may have fixed code by hand there; nothing else checks it before idle.
  if (rested) await healthy(() => fixCheck())
}

/** Design — skipped when the sketch's own criteria are judged clear — then `buildFeature`. */
export const planAndBuild = async (firstBase: string, stated?: StatedCriteria): Promise<void> => {
  // GTD_FLAG_RISK_TIER: the tier is proposed at triage and set at the design gate, so no skip.
  if (!(await skipDesign(riskTierOn() ? undefined : stated))) await design(firstBase)
  await buildFeature(firstBase)
}

// seam.naive / seam.judge never run here: a re-plan's seam is built unjudged and unrefactored.
/** After a tail that skipped planning: stop on sign-off, re-plan on feedback. Opens no slice: slices cannot nest. */
export const afterTail = async (first: ReviewOutcome): Promise<void> => {
  let outcome = first
  while (outcome.verdict === "feedback") {
    await reUnwind(outcome)
    await design(outcome.base)
    const tier = riskTierOn() ? recordRisk() : undefined
    await implement({ tier, amend: true })
    outcome = await buildTail(outcome.base, { green: true, lap: "feedback" })
  }
}

/** An ordinary start: wait at `idle`, unwind the sketch, check the baseline, then plan and build. */
export const ordinaryStart = async (): Promise<void> => {
  await human("idle", { message: t.idleMessage(), label: "Idle", file: ".gtd/TODO.md" })
  refusePendingHandOff()
  // Read right after idle, so a bad value refuses the landing that would pin it.
  flagModeOn()
  const stated = statedCriteria(changes(), head())
  await unwind()
  if (changes(FEEDBACK).some((c) => c.status !== "deleted")) {
    await human("unwind-failed", {
      message: t.unwindFailedMessage(),
      label: "Could not unwind your input",
      file: FEEDBACK,
    })
  }
  await gate("start-gate", t.startGateBlockedMessage())
  await planAndBuild(start(), stated)
}

export const feature = shipped(ordinaryStart)
