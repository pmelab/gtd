import {
  answered,
  changes,
  judge,
  moveScript,
  numeric,
  openQuestions,
  read,
  refuse,
  requireAnswers,
  requireProgress,
  run,
  scope,
  sections,
  vars,
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
import * as t from "./text.js"

/**
 * Stop for a human only while `file` is missing or still has open questions.
 * Resolves `true` when the human answered (the author revises), `false` when
 * no question was left.
 */
const questionGate = async (file: string, answer: () => Promise<void>): Promise<boolean> => {
  const content = read(file)
  if (content !== undefined && openQuestions(content).length === 0) return false
  await answer()
  requireAnswers(file)
  return true
}

/** Triage the sketch since `base` into requirements, until no product question is open. */
export const design = (base: string): Promise<void> =>
  scope("design", async () => {
    do {
      await triage(base)
      requireProgress(REQUIREMENTS)
    } while (await questionGate(REQUIREMENTS, answerProductQuestions))
  })

/** Work out the technical plan, then decompose it into package files. */
export const architecture = (): Promise<void> =>
  scope("architecture", async () => {
    do await author()
    while (await questionGate(ARCHITECTURE, answerTechnicalQuestions))
    await decompose()
    if (changes(".gtd/packages/**").length === 0) {
      refuse("gtd land: decompose: write at least one package under .gtd/packages/")
    }
  })

/** A package file name from a plan's first heading. */
const slug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "package"

/** Whether the settled plan needs its own architecture pass, or goes straight to one package. */
export const architecturePass = async (): Promise<void> => {
  const { answers, truncated } = await judge("architecture-pre", {
    questions: [
      {
        id: "architectureWarranted",
        primitive: "noul",
        instructions:
          "Given the settled concerns in `.gtd/REQUIREMENTS.md` (in state), does this plan warrant a dedicated architecture pass — real structural decisions, multiple integration points, or a non-obvious tradeoff — before packages are written?",
        criteria:
          "Answer yes if uncertain; a trivial, single-concern, mechanical plan with no real design decision answers no.",
      },
    ],
    evidence: { requirements: read(REQUIREMENTS) ?? "" },
    message: t.architecturePreMessage(),
    label: "Judging whether this plan warrants an architecture pass",
  })
  // A plan the budget cut can hide its structural concerns from the judge:
  // never skip the architecture pass on it, however confident the "no".
  const skip =
    truncated.length === 0 &&
    answered(answers.architectureWarranted, "no", numeric(vars.architectureSkipMinP, Infinity))
  const plan = read(REQUIREMENTS)
  if (skip && plan !== undefined) {
    const target = `.gtd/packages/01-${slug(sections(plan)[0] ?? "")}.md`
    await run("architecture-promote", moveScript(REQUIREMENTS, target), {
      label: "Promoting the plan straight to a package",
    })
    return
  }
  await architecture()
}
