// `build.review.collecting`'s grader: the shared core plus the
// PRODUCT/TECHNICAL classification check `design.triage` (the next reader)
// depends on.
import spec from "../cases/build-review-collecting.mjs"
import { SHARED_CHECKS, safeGrade } from "./shared.mjs"

const fail = (reason) => ({ pass: false, score: 0, reason })

function checkClassification(result, caseDef, variant) {
  if (variant !== "violation" && variant !== "footnote") return undefined
  if (/\b(PRODUCT|TECHNICAL)\b/.test(result.feedback)) return undefined
  return fail("REQUIREMENTS.md's concern carries no PRODUCT/TECHNICAL classification")
}

// Reuses the same planted-identifier machinery `checkPlantedIdentifier`
// applies to `violation` (grep the anchor verbatim into the written
// concern), scoped to the `footnote` variant's own anchor field instead —
// proving the concern is grounded in the footnote's exact hunk
// (`src/checkout.ts`), not a paraphrase of the src/retry.ts scene-setting
// prose or a generic whole-file remark.
function checkFootnoteAnchor(result, caseDef, variant) {
  if (variant !== "footnote") return undefined
  if (result.feedback.includes(caseDef.footnoteAnchor)) return undefined
  return fail(
    `feedback did not name the footnote's anchored hunk "${caseDef.footnoteAnchor}" — looks like a whole-file remark instead`,
  )
}

export default function grade(output, context) {
  return safeGrade(output, context, spec, [
    ...SHARED_CHECKS,
    checkClassification,
    checkFootnoteAnchor,
  ])
}
