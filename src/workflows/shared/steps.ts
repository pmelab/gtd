import { changesSince, env, human, scope, type ScopeAccess } from "../../flows/index.js"
import { removedAssertions, type CollectRound } from "../../workflow-kit/index.js"
import * as t from "./text.js"

// The bundled workflow's single steps. A step's name is relative to the
// scope its caller runs it in — `triage` inside `scope("design")` is
// `design.triage` — and the full name is public API: renaming it strands
// every process resting on it.

export const FEEDBACK = ".gtd/FEEDBACK.md"
export const ESCALATION = ".gtd/ESCALATION.md"
export const REQUIREMENTS = ".gtd/REQUIREMENTS.md"
export const REVIEW = ".gtd/REVIEW.md"
export const REFACTOR = ".gtd/REFACTOR.md"
export const REFACTOR_NOTE = ".gtd/REFACTOR-NOTE.md"
export const QUALITY = ".gtd/QUALITY.md"
export const NAIVE_TEST = ".gtd/NAIVE-TEST.md"

export const planner = (): string => env.plannerModel ?? ""
export const coder = (): string => env.coderModel ?? ""

// ── Keeping the suite green ─────────────────────────────────────────────────

export const fixCheck = (rules?: string): Promise<void> =>
  t.agentWithSkills("fix", t.buildFixPrompt(rules), {
    label: "Fixing the check",
    file: FEEDBACK,
    model: coder(),
    system: t.finisherSystem(),
  })

export const describeEscalation = (rules?: string): Promise<void> =>
  t.agentWithSkills("health.describe", t.healthDescribePrompt(rules), {
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
  "criteria-coverage": { skills: [], brief: t.criteriaCoverageBrief },
}

const coderLenses: ReadonlySet<string> = new Set(["conventions", "ponytail-review", "test-audit"])

/**
 * One quality review through `lens`; each lens is its own scope, so its own
 * conversation and skills. `requirements`, when given, are quoted in the prompt.
 */
export const reviewQuality = (
  lens: string,
  base?: string,
  model?: string,
  requirements?: string,
): Promise<void> =>
  t.agentWithSkills(
    `quality.${lens}.reviewing`,
    t.buildQualityReviewingPrompt(lens, builtInLenses[lens]?.brief, base, requirements),
    {
      label: "Reviewing (one quality lens)",
      file: QUALITY,
      model: model || (coderLenses.has(lens) ? coder() : planner()),
      system: t.reviewerSystem(),
      allowEmpty: true,
    },
  )

export const fixQuality = (rules?: string): Promise<void> =>
  t.agentWithSkills("fix.quality.fixing", t.buildFixQualityPrompt(rules), {
    label: "Fixing quality findings",
    file: QUALITY,
    model: coder(),
    system: t.finisherSystem(),
    allowEmpty: true,
  })

/** Write `.gtd/REVIEW.md` over everything since `base`, carrying the answers of commit `carry` when given; `extra` joins the prompt. */
export const reviewing = (
  base: string,
  carry?: string,
  lap: t.ReviewRange = "first",
  extra = "",
): Promise<void> =>
  t.agentWithSkills(
    "review.reviewing",
    t.buildReviewReviewingPrompt(base, lap, carry, removedAssertions(changesSince(base)), extra),
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
export const fixRisks = (
  notes: readonly t.NoteInput[],
  access?: ScopeAccess,
  rules?: string,
): Promise<void> => {
  const fixing = (name: string): Promise<void> =>
    t.agentWithSkills(name, t.buildReviewFixRisksPrompt(notes, rules), {
      label: "Fixing the reviewer's risks",
      file: REVIEW,
      model: planner(),
      system: t.reviewerSystem(),
      allowEmpty: true,
    })
  return access === undefined
    ? fixing("review.fix.risks.fixing")
    : scope({ name: "review.fix.risks", access }, () => fixing("fixing"))
}

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

/** Answer every `question` note inline in `.gtd/REVIEW.md`. */
export const answerReviewQuestions = (notes: readonly t.NoteInput[]): Promise<void> =>
  t.agentWithSkills("review.answer-review-questions", t.buildReviewAnswerQuestionsPrompt(notes), {
    label: "Answering your questions",
    file: REVIEW,
    mode: "review",
    model: planner(),
    system: t.reviewerSystem(),
  })

/** Fix every `nit` note in one turn. */
export const fixNits = (
  notes: readonly t.NoteInput[],
  access?: ScopeAccess,
  rules?: string,
): Promise<void> => {
  const fixing = (name: string): Promise<void> =>
    t.agentWithSkills(name, t.buildReviewFixNitsPrompt(notes, rules), {
      label: "Fixing your nits",
      file: REVIEW,
      model: planner(),
      system: t.reviewerSystem(),
    })
  return access === undefined
    ? fixing("review.fix.nits.fixing")
    : scope({ name: "review.fix.nits", access }, () => fixing("fixing"))
}

/** Turn the review round `capture` describes into `.gtd/REQUIREMENTS.md`, or change nothing. */
export const collecting = (capture: string, round?: CollectRound): Promise<void> =>
  t.agentWithSkills("review.collecting", t.buildReviewCollectingPrompt(capture, undefined, round), {
    label: "Collecting your feedback",
    file: REQUIREMENTS,
    mode: "qa",
    model: planner(),
    system: t.reviewerSystem(),
    allowEmpty: true,
  })

/** The round at commit `round` left no `.gtd/REVIEW.md`. */
export const reviewMissing = (round: string): Promise<void> =>
  human("review.review-missing", {
    message: t.buildReviewReviewMissingMessage(round),
    label: "Nothing to review",
  })
