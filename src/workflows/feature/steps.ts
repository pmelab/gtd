import { human, scope, type ScopeAccess } from "../../flows/index.js"
import type { CollectRound } from "../../workflow-kit/index.js"
import * as t from "../shared/text.js"
import { riskTierOn } from "./tier.js"
import { planner, REFACTOR, REQUIREMENTS, REVIEW } from "../shared/steps.js"

/** Turn the sketch since `base` into `.gtd/REQUIREMENTS.md`. */
export const triage = (base: string): Promise<void> =>
  t.agentWithSkills("triage", t.designTriagePrompt(base, riskTierOn()), {
    label: "Triaging the change",
    file: REQUIREMENTS,
    mode: "qa",
    model: planner(),
    system: t.designSystem(),
  })

export const answerProductQuestions = (): Promise<void> =>
  human("gate.answer", {
    message: t.designGateAnswerMessage(riskTierOn()),
    label: "Awaiting your product answers",
    file: REQUIREMENTS,
    mode: "qa",
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
export const refactorCollecting = (
  capture: string,
  round: CollectRound,
  strays: readonly string[],
): Promise<void> =>
  t.agentWithSkills(
    "review.collecting",
    t.buildReviewCollectingPrompt(capture, { strays, round }),
    {
      label: "Collecting your refactor feedback",
      file: REFACTOR,
      model: planner(),
      system: t.reviewerSystem(),
      allowEmpty: true,
    },
  )
