import {
  changes,
  hasThreadFor,
  requireAnswers,
  requireReplies,
  requireThreadsClosed,
  requireProgress,
  scope,
} from "../../flows/index.js"
import { REQUIREMENTS } from "../shared/steps.js"
import { requireCriteria } from "./criteria.js"
import { answerProductQuestions, triage } from "./steps.js"

/**
 * Always stop for the human. Resolves `true` when the round changed anything
 * (the author revises), `false` on a clean re-run. Open threads refuse every
 * landing; unticked questions only refuse a round with no thread for the
 * agent to answer.
 */
const noteGate = async (file: string, answer: () => Promise<void>): Promise<boolean> => {
  await answer()
  requireThreadsClosed(file)
  if (changes().length === 0) return false
  if (!hasThreadFor("agent", file)) requireAnswers(file)
  return true
}

/** Triage the sketch since `base` into requirements, until no product question is open; `guard` holds every round's criteria. */
export const design = (base: string, guard?: () => void): Promise<void> =>
  scope("design", async () => {
    do {
      await triage(base)
      requireProgress(REQUIREMENTS)
      requireReplies(REQUIREMENTS)
      requireCriteria(REQUIREMENTS)
      guard?.()
    } while (await noteGate(REQUIREMENTS, answerProductQuestions))
  })
