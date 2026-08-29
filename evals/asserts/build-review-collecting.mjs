// `build.review.collecting`'s grader: the shared core plus the
// PRODUCT/TECHNICAL classification check `design.triage` (the next reader)
// depends on.
import spec from "../cases/build-review-collecting.mjs"
import { SHARED_CHECKS, runChecks } from "./shared.mjs"

const fail = (reason) => ({ pass: false, score: 0, reason })

function checkClassification(result, caseDef, variant) {
  if (variant !== "violation") return undefined
  if (/\b(PRODUCT|TECHNICAL)\b/.test(result.feedback)) return undefined
  return fail("REQUIREMENTS.md's concern carries no PRODUCT/TECHNICAL classification")
}

export default function grade(output, context) {
  const result = JSON.parse(output)
  const variant = context.vars.variant
  return runChecks([...SHARED_CHECKS, checkClassification], result, spec, variant)
}
