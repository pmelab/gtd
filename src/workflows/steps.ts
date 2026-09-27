import { agent, human, vars } from "../flows/index.js"
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
export const QUALITY = ".gtd/QUALITY.md"
export const SPEC_FEEDBACK = ".gtd/SPEC_FEEDBACK.md"

const planner = (): string => vars.plannerModel ?? ""
const coder = (): string => vars.coderModel ?? ""

// ── Planning ────────────────────────────────────────────────────────────────

/** Turn the sketch since `base` into `.gtd/REQUIREMENTS.md`. */
export const triage = (base: string): Promise<void> =>
  agent("triage", t.withSkills(vars.triageSkills, t.designTriagePrompt(base)), {
    label: "Triaging the change",
    file: REQUIREMENTS,
    mode: "qa",
    model: planner(),
    system: t.designSystem(),
  })

export const author = (): Promise<void> =>
  agent("author", t.withSkills(vars.architectureSkills, t.architectureAuthorPrompt()), {
    label: "Refining the technical plan",
    file: ARCHITECTURE,
    mode: "qa",
    model: planner(),
    system: t.architectSystem(),
  })

export const decompose = (): Promise<void> =>
  agent("decompose", t.withSkills(vars.decomposeSkills, t.architectureDecomposePrompt()), {
    label: "Decomposing into packages",
    model: planner(),
    system: t.architectSystem(),
  })

export const answerProductQuestions = (): Promise<void> =>
  human("gate.answer", {
    message: t.designGateAnswerMessage(),
    label: "Awaiting your product answers",
    file: REQUIREMENTS,
    mode: "qa",
    acceptClean: true,
  })

export const answerTechnicalQuestions = (): Promise<void> =>
  human("gate.answer", {
    message: t.architectureGateAnswerMessage(),
    label: "Awaiting your technical answers",
    file: ARCHITECTURE,
    mode: "qa",
    acceptClean: true,
  })

// ── Packages ────────────────────────────────────────────────────────────────

export const build = (pkg: string): Promise<void> =>
  agent("building", t.withSkills(vars.buildSkills, t.packagesItemBuildingPrompt(pkg)), {
    label: "Building",
    model: coder(),
    system: t.builderSystem(),
  })

export const fixSuite = (): Promise<void> =>
  agent("fix-suite", t.withSkills(vars.fixSkills, t.packagesItemFixSuitePrompt()), {
    label: "Fixing the check",
    file: FEEDBACK,
    model: coder(),
    system: t.builderSystem(),
  })

export const fixSpec = (pkg: string): Promise<void> =>
  agent("fix-spec", t.withSkills(vars.reviewFixSkills, t.packagesItemFixSpecPrompt(pkg)), {
    label: "Fixing review feedback",
    file: SPEC_FEEDBACK,
    model: coder(),
    system: t.builderSystem(),
  })

/** Review `pkg` against its spec, focused on the `failing` sections the pre-judge could not clear. */
export const reviewPackage = (pkg: string, failing: readonly string[] = []): Promise<void> =>
  agent(
    "spec.review",
    t.withSkills(vars.specReviewSkills, t.packagesItemSpecReviewPrompt(pkg, failing)),
    {
      label: "Reviewing the package",
      model: planner(),
      system: t.specReviewerSystem(),
      allowEmpty: true,
    },
  )

// ── Keeping the suite green ─────────────────────────────────────────────────

export const fix = (): Promise<void> =>
  agent("fix", t.withSkills(vars.fixSkills, t.buildFixPrompt()), {
    label: "Fixing the check",
    file: FEEDBACK,
    model: coder(),
    system: t.finisherSystem(),
  })

export const describeEscalation = (): Promise<void> =>
  agent("health.describe", t.withSkills(vars.escalateSkills, t.healthDescribePrompt()), {
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

/** One quality review, through the skill `lens`. */
export const reviewQuality = (lens: string): Promise<void> =>
  agent("quality.reviewing", t.withSkills(lens, t.buildQualityReviewingPrompt(lens)), {
    label: "Reviewing (one quality lens)",
    file: QUALITY,
    model: planner(),
    system: t.reviewerSystem(),
    allowEmpty: true,
  })

export const fixQuality = (): Promise<void> =>
  agent("fix-quality", t.withSkills(vars.reviewFixSkills, t.buildFixQualityPrompt()), {
    label: "Fixing quality findings",
    file: QUALITY,
    model: coder(),
    system: t.finisherSystem(),
    allowEmpty: true,
  })

/** Write `.gtd/REVIEW.md` over everything since `base`. */
export const reviewing = (base: string): Promise<void> =>
  agent("review.reviewing", t.withSkills(vars.reviewSkills, t.buildReviewReviewingPrompt(base)), {
    label: "Reviewing",
    file: REVIEW,
    mode: "review",
    model: planner(),
    system: t.reviewerSystem(),
    base,
  })

export const awaitReview = (base: string): Promise<void> =>
  human("review.await-review", {
    message: t.buildReviewAwaitReviewMessage(base),
    label: "Awaiting your review",
    file: REVIEW,
    mode: "review",
    base,
  })

/** The round at commit `round` left no `.gtd/REVIEW.md`. */
export const reviewMissing = (round: string): Promise<void> =>
  human("review.review-missing", {
    message: t.buildReviewReviewMissingMessage(round),
    label: "Nothing to review",
  })

/** Turn the review round `capture` describes into `.gtd/REQUIREMENTS.md`, or change nothing. */
export const collecting = (capture: string): Promise<void> =>
  agent(
    "review.collecting",
    t.withSkills(vars.reviewSkills, t.buildReviewCollectingPrompt(capture)),
    {
      label: "Collecting your feedback",
      file: REQUIREMENTS,
      mode: "qa",
      model: planner(),
      system: t.reviewerSystem(),
      allowEmpty: true,
    },
  )
