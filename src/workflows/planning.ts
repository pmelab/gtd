import {
  changes,
  hasThreadFor,
  refuse,
  requireAnswers,
  requireReplies,
  requireThreadsClosed,
  requireProgress,
  scope,
} from "../flows/index.js"
import {
  answerProductQuestions,
  answerTechnicalQuestions,
  ARCHITECTURE,
  author,
  decompose,
  REQUIREMENTS,
  triage,
} from "./steps.js"

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

/** Triage the sketch since `base` into requirements, until no product question is open. */
export const design = (base: string): Promise<void> =>
  scope("design", async () => {
    do {
      await triage(base)
      requireProgress(REQUIREMENTS)
      requireReplies(REQUIREMENTS)
    } while (await noteGate(REQUIREMENTS, answerProductQuestions))
  })

/** Work out the technical plan, then decompose it into package files. */
export const architecture = (): Promise<void> =>
  scope("architecture", async () => {
    do {
      await author()
      requireReplies(ARCHITECTURE)
    } while (await noteGate(ARCHITECTURE, answerTechnicalQuestions))
    await decompose()
    if (changes(".gtd/packages/**").length === 0) {
      refuse("gtd land: decompose: write at least one package under .gtd/packages/")
    }
    if (changes(ARCHITECTURE).some((c) => c.status === "deleted")) {
      refuse(
        "gtd land: decompose: keep .gtd/ARCHITECTURE.md — the build tail's full run needs it; it is removed only once that run is green",
      )
    }
  })
