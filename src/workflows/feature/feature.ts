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
import { FEEDBACK, fixCheck, QUALITY, REQUIREMENTS } from "../shared/steps.js"
import { refusePendingHandOff, tail } from "../shared/tail.js"
import * as t from "../shared/text.js"
import {
  criterionIds,
  requireCriteriaFrozen,
  requireStableIds,
  type StableIds,
  skipDesign,
  sliceIds,
  statedCriteria,
  type CriteriaSlice,
  type StatedCriteria,
} from "./criteria.js"
import { design } from "./planning.js"
import { buildTail, isCode, reUnwind, review, type ReviewOutcome } from "./review.js"
import { implement, implementing, seamBuild } from "./seam.js"
import { sliceCap, sliceCriteria, slicing } from "./slicing.js"
import { recordRisk, riskTierOn, type RiskTier } from "./tier.js"

// The ordinary start. Any change to the tree starts a process: `idle` →
// `unwind` reverts the sketch (its intent survives in history) → a
// green-baseline gate → design → per slice of the criteria, a naive pass,
// judged with `flagMode` on: it lands as the implementation, or (refactoring
// first when the judge asks) is built fresh from → the health loop → the
// quality lap → after the last slice, human review of the whole change, which
// signs off (the episode ends back at `idle`) or sends a design → implement
// lap.

/** Revert the sketch that started the process out of the working tree; its intent survives in history. */
export const unwind = (): Promise<void> => {
  const commit = head()
  return run("unwind", revertScript(commit, FEEDBACK, t.unwindFailure(commit)), {
    label: "Unwinding your input",
  })
}

export { reUnwind }

/**
 * The slices `design.slicing` grouped the criteria into, each built in turn
 * from where the previous one landed; design must have run since `firstBase`.
 */
export const buildFeature = async (firstBase: string): Promise<void> => {
  const tier = riskTierOn() ? recordRisk() : undefined
  const slices = await slicing()
  // Every ID handed out, gathered before a later narrowing can drop one: none is ever reused.
  const handedOut = new Set(listedIds())
  // A single slice keeps the unnumbered names and builds against every criterion.
  const one = slices.length === 1
  // A steer may delete every criterion of a later slice: there is nothing to build there.
  const built = (i: number): boolean => sliceIds(sliceCriteria(slices, i))?.length !== 0
  for (const i of slices.keys()) {
    if (!built(i)) continue
    const n = one ? "" : `-${i + 1}`
    await buildSlice(i === 0 ? firstBase : head(), {
      tier,
      criteria: sliceCriteria(slices, i),
      refactor: `refactor${n}`,
      feature: `feature${n}`,
      // A steer or a narrowing may empty every later slice.
      more: () => slices.some((_, j) => j > i && built(j)),
      // Every slice but the one is built unreviewed, so the review covers them all.
      reviewBase: one ? undefined : firstBase,
      handedOut,
    })
  }
}

const listedIds = (): readonly string[] => criterionIds(read(REQUIREMENTS) ?? "")

const gather = (handedOut: Set<string>): readonly string[] => {
  for (const id of listedIds()) handedOut.add(id)
  return [...handedOut]
}

interface SliceBuild {
  readonly tier: RiskTier | undefined
  readonly criteria: CriteriaSlice | undefined
  readonly refactor: string
  readonly feature: string
  readonly more: () => boolean
  /** Absent: the slice's own base. */
  readonly reviewBase?: string | undefined
  /** Every criterion ID handed out so far; the slice adds those a steer adds. */
  readonly handedOut: Set<string>
}

/** A naive pass (judged only with `flagMode` on), then implement and the quality lap; after the last slice, the review. */
const buildSlice = async (sliceBase: string, build: SliceBuild): Promise<void> => {
  const seam = await seamBuild(sliceBase, { criteria: build.criteria, refactor: build.refactor })
  const used = gather(build.handedOut)
  await slice(build.feature, async () => {
    const closed = await implementing({
      reference: seam.reference,
      tier: build.tier,
      afterRefactor: seam.refactored,
      naive: seam.land === true ? seam.reference : undefined,
      rebuild: seam.rebuild,
      slice: build.criteria,
      base: build.criteria === undefined ? undefined : sliceBase,
      more: build.more,
    })
    // Closing kept the criteria exactly when there is more to build, so this reads as it did.
    const more = build.more()
    // A feature slice with no code beyond the carried-over tests: the refactor carried the
    // feature, so the lap covers the whole slice.
    const carried = seam.rebuild?.acceptance?.tests ?? []
    const base =
      seam.refactored === true &&
      !changesSince(seam.base).some((c) => isCode(c.path) && !carried.includes(c.path))
        ? sliceBase
        : seam.base
    if (more) {
      // The criteria stay in the tree for the next slice; no quality fix may move them.
      const guard = () => requireCriteriaFrozen(REQUIREMENTS)
      await tail(settleQuality, { green: true, lensBase: base, guard, guardRests: false })
      return
    }
    const reviewBase = build.reviewBase ?? base
    await featureFeedback(await reviewedTail(reviewBase, base), base, { closed, used })
  })
}

// Between slices nothing reviews the lap's leftovers, and the next lap appends to the file.
// Empty counts as resolved, as the lap reads it.
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
  // The person may have fixed code by hand there; nothing else checks it before the review.
  if (rested) await healthy(() => fixCheck())
}

/** The triaged quality lap, then the human review since `base`. */
const reviewedTail = (base: string, lensBase: string): Promise<ReviewOutcome> =>
  tail((escalations, report) => review(base, escalations, { report }), {
    green: true,
    lensBase,
    triage: true,
  })

// seam.naive / seam.judge never run on a feedback lap: its design → implement is built unjudged
// and unrefactored, held to every criterion's coverage since the process start.
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
    closed = await implementing({ tier, amend: true })
    outcome = await reviewedTail(outcome.base, lensBase)
  }
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
    outcome = await buildTail(outcome.base, { green: true })
  }
}

/** An ordinary start: wait at `idle`, unwind the sketch, check the baseline, then plan and build. */
export const ordinaryStart = async (): Promise<void> => {
  await human("idle", { message: t.idleMessage(), label: "Idle", file: ".gtd/TODO.md" })
  refusePendingHandOff()
  // Read right after idle, so a bad value refuses the landing that would pin it.
  flagModeOn()
  sliceCap()
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
