import { human, run } from "../../flows/index.js"
import * as t from "../shared/text.js"
import { riskTierOn } from "./tier.js"
import {
  ARCHITECTURE,
  coder,
  FEEDBACK,
  planner,
  REFACTOR,
  REQUIREMENTS,
  REVIEW,
} from "../shared/steps.js"

/** Turn the sketch since `base` into `.gtd/REQUIREMENTS.md`. */
export const triage = (base: string): Promise<void> =>
  t.agentWithSkills("triage", t.designTriagePrompt(base, riskTierOn()), {
    label: "Triaging the change",
    file: REQUIREMENTS,
    mode: "qa",
    model: planner(),
    system: t.designSystem(),
  })

export const author = (): Promise<void> =>
  t.agentWithSkills("author", t.architectureAuthorPrompt(), {
    label: "Refining the technical plan",
    file: ARCHITECTURE,
    mode: "qa",
    model: planner(),
    system: t.architectSystem(),
  })

export const decompose = (): Promise<void> =>
  t.agentWithSkills("decompose.decomposing", t.architectureDecomposePrompt(), {
    label: "Decomposing into packages",
    model: planner(),
    system: t.architectSystem(),
  })

export const answerProductQuestions = (): Promise<void> =>
  human("gate.answer", {
    message: t.designGateAnswerMessage(riskTierOn()),
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

export const build = (pkg: string): Promise<void> =>
  t.agentWithSkills("building", t.packagesItemBuildingPrompt(pkg), {
    label: "Building",
    model: coder(),
    system: t.builderSystem(),
  })

export const fixSuite = (): Promise<void> =>
  t.agentWithSkills("fix.suite.fixing", t.packagesItemFixSuitePrompt(), {
    label: "Fixing the check",
    file: FEEDBACK,
    model: coder(),
    system: t.builderSystem(),
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
export const fixNits = (notes: readonly t.NoteInput[]): Promise<void> =>
  t.agentWithSkills("review.fix.nits.fixing", t.buildReviewFixNitsPrompt(notes), {
    label: "Fixing your nits",
    file: REVIEW,
    model: planner(),
    system: t.reviewerSystem(),
  })

/** Turn the review round `capture` describes into `.gtd/REQUIREMENTS.md`, or change nothing. */
export const collecting = (capture: string): Promise<void> =>
  t.agentWithSkills("review.collecting", t.buildReviewCollectingPrompt(capture), {
    label: "Collecting your feedback",
    file: REQUIREMENTS,
    mode: "qa",
    model: planner(),
    system: t.reviewerSystem(),
    allowEmpty: true,
  })

/** Turn the refactor review round `capture` describes into `.gtd/REFACTOR.md`, or change nothing. */
export const refactorCollecting = (capture: string, strays: readonly string[]): Promise<void> =>
  t.agentWithSkills("review.collecting", t.refactorReviewCollectingPrompt(capture, strays), {
    label: "Collecting your refactor feedback",
    file: REFACTOR,
    model: planner(),
    system: t.reviewerSystem(),
    allowEmpty: true,
  })

/** `build.review.defer`: append `notes` to `.gtd/TODO.md` as one section; the step's landing is the commit. */
export const deferNotes = (notes: readonly t.NoteInput[], round: string): Promise<void> =>
  run("review.defer", t.deferNotesScript(notes, round), {
    label: "Deferring could-notes to TODO.md",
    file: ".gtd/TODO.md",
  })
