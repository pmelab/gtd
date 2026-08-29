// `build.review.collecting`'s grader: the shared core plus the
// PRODUCT/TECHNICAL classification check `design.triage` (the next reader)
// depends on.
import spec from "../cases/build-review-collecting.mjs"
import { SHARED_CHECKS, safeGrade } from "./shared.mjs"

const fail = (reason) => ({ pass: false, score: 0, reason })

function checkClassification(result, caseDef, variant) {
  if (variant !== "violation") return undefined
  if (/\b(PRODUCT|TECHNICAL)\b/.test(result.feedback)) return undefined
  return fail("REQUIREMENTS.md's concern carries no PRODUCT/TECHNICAL classification")
}

export default function grade(output, context) {
  return safeGrade(output, context, spec, [...SHARED_CHECKS, checkClassification])
}
