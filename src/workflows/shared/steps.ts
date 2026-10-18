import { changesSince, env, human } from "../../flows/index.js"
import { removedAssertions } from "../../workflow-kit/index.js"
import * as t from "./text.js"

// The bundled workflow's single steps. A step's name is relative to the
// scope its caller runs it in — `triage` inside `scope("design")` is
// `design.triage` — and the full name is public API: renaming it strands
// every process resting on it.

export const FEEDBACK = ".gtd/FEEDBACK.md"
export const ESCALATION = ".gtd/ESCALATION.md"
export const REQUIREMENTS = ".gtd/REQUIREMENTS.md"
export const ARCHITECTURE = ".gtd/ARCHITECTURE.md"
export const REVIEW = ".gtd/REVIEW.md"
export const REFACTOR = ".gtd/REFACTOR.md"
export const QUALITY = ".gtd/QUALITY.md"

export const planner = (): string => env.plannerModel ?? ""
export const coder = (): string => env.coderModel ?? ""

// ── Keeping the suite green ─────────────────────────────────────────────────

export const fixCheck = (): Promise<void> =>
  t.agentWithSkills("fix", t.buildFixPrompt(), {
    label: "Fixing the check",
    file: FEEDBACK,
    model: coder(),
    system: t.finisherSystem(),
  })

export const describeEscalation = (): Promise<void> =>
  t.agentWithSkills("health.describe", t.healthDescribePrompt(), {
    label: "Describing the escalation",
    file: FEEDBACK,
    model: coder(),
    system: t.escalationSystem(),
    allowEmpty: true,
  })

export const escalate = (): Promise<void> =>
  human("health.stop", {
    message: t.healthStopMessage(),
    label: "Escalating to a human",
    file: ESCALATION,
    acceptClean: true,
  })

export const escalationExhausted = (): Promise<void> =>
  human("health.exhausted", {
    message: t.healthExhaustedMessage(),
    label: "Escalation exhausted",
    file: ESCALATION,
    acceptClean: true,
  })

// ── Quality and review ──────────────────────────────────────────────────────

export interface BuiltInLens {
  readonly skills: readonly string[]
  readonly brief: string
}

/** Lenses the workflow defines itself, not bundled skills: `skills/` is not in the npm package, and a missing lens skill burns a turn silently. */
export const builtInLenses: Readonly<Record<string, BuiltInLens>> = {
  correctness: { skills: ["code-review-and-quality"], brief: t.correctnessBrief },
  conventions: { skills: [], brief: t.conventionsBrief },
  "spec-challenge": { skills: [], brief: t.specChallengeBrief },
}

/** One quality review through `lens`; each lens is its own scope, so its own conversation and skills. */
export const reviewQuality = (lens: string): Promise<void> =>
  t.agentWithSkills(
    `quality.${lens}.reviewing`,
    t.buildQualityReviewingPrompt(lens, builtInLenses[lens]?.brief),
    {
      label: "Reviewing (one quality lens)",
      file: QUALITY,
      model: planner(),
      system: t.reviewerSystem(),
      allowEmpty: true,
    },
  )

export const fixQuality = (): Promise<void> =>
  t.agentWithSkills("fix.quality.fixing", t.buildFixQualityPrompt(), {
    label: "Fixing quality findings",
    file: QUALITY,
    model: coder(),
    system: t.finisherSystem(),
    allowEmpty: true,
  })

/** Write `.gtd/REVIEW.md` over everything since `base`, carrying the answers of commit `carry` when given. */
export const reviewing = (base: string, carry?: string): Promise<void> =>
  t.agentWithSkills(
    "review.reviewing",
    t.buildReviewReviewingPrompt(base, carry, removedAssertions(changesSince(base))),
    {
      label: "Reviewing",
      file: REVIEW,
      mode: "review",
      model: planner(),
      system: t.reviewerSystem(),
      base,
    },
  )

/** Fix the `Risk:`-marked notes the reviewer named; an empty turn means the risk was judged false. */
export const fixRisks = (notes: readonly t.NoteInput[]): Promise<void> =>
  t.agentWithSkills("review.fix.risks.fixing", t.buildReviewFixRisksPrompt(notes), {
    label: "Fixing the reviewer's risks",
    file: REVIEW,
    model: planner(),
    system: t.reviewerSystem(),
    allowEmpty: true,
  })

export const awaitReview = (
  base: string,
  message = t.buildReviewAwaitReviewMessage(base),
): Promise<void> =>
  human("review.await-review", {
    message,
    label: "Awaiting your review",
    file: REVIEW,
    mode: "review",
    base,
    acceptClean: true,
  })

/** The round at commit `round` left no `.gtd/REVIEW.md`. */
export const reviewMissing = (round: string): Promise<void> =>
  human("review.review-missing", {
    message: t.buildReviewReviewMissingMessage(round),
    label: "Nothing to review",
  })
