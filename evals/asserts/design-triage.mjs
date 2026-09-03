// `design.triage`'s grader: the shared core plus two state-specific checks —
// whether `## Open Questions` re-raises `settledDecision` (the
// violation/clean axis) and whether a footnote was consumed (the orthogonal
// `footnote` variant — see evals/cases/design-triage.mjs). The footnote
// fixture's own footnote deliberately comments on something OTHER than
// `settledDecision`, so `checkOpenQuestions`'s clean-side bar (never
// re-raise `settledDecision`) and folding the footnote in correctly never
// contradict each other.
import spec from "../cases/design-triage.mjs"
import { SHARED_CHECKS, safeGrade } from "./shared.mjs"

const fail = (reason) => ({ pass: false, score: 0, reason })

/** The `## Open Questions` section of a REQUIREMENTS.md, heading excluded, or "" when absent. */
function openQuestions(feedback) {
  const start = feedback.search(/^## Open Questions\s*$/m)
  if (start === -1) return ""
  const body = feedback.slice(start).replace(/^## .*\n/, "")
  const end = body.search(/^## /m)
  return end === -1 ? body : body.slice(0, end)
}

// Grades WHICH decision is left open, never whether the document asks
// anything at all. The two fixtures differ on exactly one point — the
// `settledDecision` — so re-raising it on the clean side is the failure, and
// raising it on the violation side is the requirement. A clean-side turn
// that settles it and then asks about some genuinely open point it
// discovered (what a "day" means, what a repeat refund does) is passing
// `unified.yaml`'s own question bar, not failing this case.
function checkOpenQuestions(result, caseDef, variant) {
  const raised = openQuestions(result.feedback).includes(caseDef.settledDecision)
  const shouldRaise = variant === "violation"
  if (raised === shouldRaise) return undefined
  return fail(
    shouldRaise
      ? `\`## Open Questions\` does not raise "${caseDef.settledDecision}", a genuinely undecided product fork`
      : `\`## Open Questions\` re-raises "${caseDef.settledDecision}", which the sketch already settled`,
  )
}

// Consumption: the footnote variant's whole point. The turn reads a
// footnote-bearing `.gtd/REQUIREMENTS.md` (a return lap) and folds it in —
// the rewritten `.gtd/REQUIREMENTS.md` must carry no `[^` left, marker or
// definition alike, proving it was acted on and deleted rather than copied
// through or silently dropped.
function checkFootnoteConsumed(result, caseDef, variant) {
  if (variant !== "footnote") return undefined
  if (!result.feedback.includes("[^")) return undefined
  return fail("REQUIREMENTS.md still carries a `[^` footnote marker or definition")
}

export default function grade(output, context) {
  return safeGrade(output, context, spec, [
    ...SHARED_CHECKS,
    checkOpenQuestions,
    checkFootnoteConsumed,
  ])
}
