// `design.triage`'s grader: the shared core plus the one state-specific
// check — whether `## Open Questions` appears is exactly the two-sided axis
// this case exercises (see evals/cases/design-triage.mjs).
import spec from "../cases/design-triage.mjs"
import { SHARED_CHECKS, safeGrade } from "./shared.mjs"

const fail = (reason) => ({ pass: false, score: 0, reason })

function checkOpenQuestions(result, caseDef, variant) {
  const hasOpenQuestions = /^## Open Questions/m.test(result.feedback)
  const shouldHave = variant === "violation"
  if (hasOpenQuestions === shouldHave) return undefined
  return fail(
    shouldHave
      ? "REQUIREMENTS.md has no `## Open Questions` section for a genuinely undecided product fork"
      : "REQUIREMENTS.md raised `## Open Questions` for a decision the sketch already settled",
  )
}

export default function grade(output, context) {
  return safeGrade(output, context, spec, [...SHARED_CHECKS, checkOpenQuestions])
}
