import {
  changes,
  changesSince,
  head,
  human,
  read,
  revertScript,
  run,
  start,
} from "../../flows/index.js"
import { gate } from "../shared/health.js"
import { naiveTestOn, shipped } from "../shared/options.js"
import { FEEDBACK, REQUIREMENTS } from "../shared/steps.js"
import { refusePendingHandOff } from "../shared/tail.js"
import * as t from "../shared/text.js"
import {
  criterionIds,
  requireStableIds,
  type StableIds,
  skipDesign,
  statedCriteria,
  type StatedCriteria,
} from "./criteria.js"
import { design } from "./planning.js"
import { buildTail, isCode, reUnwind, type ReviewOutcome } from "../shared/review.js"
import { implement, implementing, seamBuild } from "./seam.js"
import { recordRisk, riskTierOn } from "./tier.js"

// The ordinary start. Any change to the tree starts a process: `idle` →
// `unwind` reverts the sketch (its intent survives in history) → a
// green-baseline gate → design → a naive pass, tried by a person with
// `naiveTest` on and judged when the requirements ask for a release flag: it
// lands as the implementation, or (refactoring first when the judge asks) is
// built fresh from → the health loop → the triaged quality lap and its finding gate → a
// reviewer's walkthrough of the whole change for the human, which signs off
// (the episode ends back at `idle`) or sends a design → implement lap.

/** Revert the sketch that started the process out of the working tree; its intent survives in history. */
export const unwind = (): Promise<void> => {
  const commit = head()
  return run("unwind", revertScript(commit, FEEDBACK, t.unwindFailure(commit)), {
    label: "Unwinding your input",
  })
}

export { reUnwind }

/**
 * A naive pass (judged only when a release flag is asked for), then implement and the
 * quality lap, then the review; design must have run since `firstBase`.
 */
export const buildFeature = async (firstBase: string): Promise<void> => {
  const tier = riskTierOn() ? recordRisk() : undefined
  // Every ID handed out, gathered before a later edit can drop one: none is ever reused.
  const handedOut = new Set(listedIds())
  const seam = await seamBuild(firstBase)
  const used = gather(handedOut)
  // Read before the implementation closes the file: the quality lap's coverage lens checks them.
  const requirements = read(REQUIREMENTS)
  const closed = await implementing({
    reference: seam.reference,
    tier,
    afterRefactor: seam.refactored,
    naive: seam.land === true ? seam.reference : undefined,
    rebuild: seam.rebuild,
  })
  // A feature with no code beyond the carried-over tests: the refactor carried
  // it, so the lap covers the whole change.
  const carried = seam.rebuild?.acceptance?.tests ?? []
  const base =
    seam.refactored === true &&
    !changesSince(seam.base).some((c) => isCode(c.path) && !carried.includes(c.path))
      ? firstBase
      : seam.base
  const outcome = await buildTail(base, { green: true, lensBase: base, requirements })
  await featureFeedback(outcome, base, { closed, used })
}

const listedIds = (): readonly string[] => criterionIds(read(REQUIREMENTS) ?? "")

const gather = (handedOut: Set<string>): readonly string[] => {
  for (const id of listedIds()) handedOut.add(id)
  return [...handedOut]
}

// seam.naive / seam.judge never run on a feedback lap: its design → implement is built unjudged
// and unrefactored.
const featureFeedback = async (
  first: ReviewOutcome,
  lensBase: string,
  ids: StableIds,
): Promise<void> => {
  let outcome = first
  let closed = ids.closed
  const handedOut = new Set([...ids.used, ...ids.closed])
  while (outcome.verdict === "feedback") {
    await reUnwind(outcome)
    const lap = { closed, used: [...handedOut] }
    // Gathered every round, so an ID one round adds and the next drops is never reused.
    await design(outcome.base, () => {
      requireStableIds(REQUIREMENTS, lap)
      gather(handedOut)
    })
    const tier = riskTierOn() ? recordRisk() : undefined
    const requirements = read(REQUIREMENTS)
    closed = await implementing({ tier, amend: true })
    outcome = await buildTail(outcome.base, {
      green: true,
      lensBase,
      requirements,
      lap: "feedback",
    })
  }
}

/** Design — skipped when the sketch's own criteria are judged clear — then `buildFeature`. */
export const planAndBuild = async (firstBase: string, stated?: StatedCriteria): Promise<void> => {
  // GTD_FLAG_RISK_TIER: the tier is proposed at triage and set at the design gate, so no skip.
  if (!(await skipDesign(riskTierOn() ? undefined : stated))) await design(firstBase)
  await buildFeature(firstBase)
}

// seam.naive / seam.judge never run here: a re-plan's seam is built unjudged and unrefactored.
/** After a tail that skipped planning: stop on sign-off, re-plan on feedback. */
export const afterTail = async (first: ReviewOutcome): Promise<void> => {
  let outcome = first
  while (outcome.verdict === "feedback") {
    await reUnwind(outcome)
    await design(outcome.base)
    const tier = riskTierOn() ? recordRisk() : undefined
    const requirements = read(REQUIREMENTS)
    await implement({ tier, amend: true })
    outcome = await buildTail(outcome.base, { green: true, requirements })
  }
}

/** An ordinary start: wait at `idle`, unwind the sketch, check the baseline, then plan and build. */
export const ordinaryStart = async (): Promise<void> => {
  await human("idle", { message: t.idleMessage(), label: "Idle", file: ".gtd/TODO.md" })
  refusePendingHandOff()
  // Read right after idle, so a bad value refuses the landing that would pin it.
  naiveTestOn()
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
