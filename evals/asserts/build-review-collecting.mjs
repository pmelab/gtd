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
// concern), scoped to the `footnote` variant's own fields instead — and
// requires BOTH the anchor path and the footnote's own substance, so a
// file-level paraphrase ("src/checkout.ts is under-tested overall", which
// names the path but never the hunk) still fails. Only a concern naming the
// anchored defect itself proves the hunk was read, not just the file.
function checkFootnoteAnchor(result, caseDef, variant) {
  if (variant !== "footnote") return undefined
  if (!result.feedback.includes(caseDef.footnoteAnchor)) {
    return fail(`feedback did not name the footnote's anchored file "${caseDef.footnoteAnchor}"`)
  }
  if (!caseDef.footnoteSubstance.test(result.feedback)) {
    return fail(
      `feedback names "${caseDef.footnoteAnchor}" but not the footnote's own defect — looks like a whole-file remark instead of the anchored hunk`,
    )
  }
  return undefined
}

export default function grade(output, context) {
  return safeGrade(output, context, spec, [
    ...SHARED_CHECKS,
    checkClassification,
    checkFootnoteAnchor,
  ])
}
