import { human } from "../../flows/index.js"
import type { CollectRound } from "../../workflow-kit/index.js"
import * as t from "../shared/text.js"
import { riskTierOn } from "./tier.js"
import { planner, REFACTOR, REQUIREMENTS } from "../shared/steps.js"

// Kept on the published feature entry.
export { answerReviewQuestions, collecting, fixNits } from "../shared/steps.js"

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
