// `build.review.reviewing`'s grader: the shared core plus the review's own
// required shape (first line, base marker, at least one chunk heading) —
// see `unified.yaml`'s `humanReview.reviewing` prompt for the contract this
// checks.
import spec from "../cases/build-review-reviewing.mjs"
import { SHARED_CHECKS, runChecks } from "./shared.mjs"

const fail = (reason) => ({ pass: false, score: 0, reason })

function checkReviewShape(result) {
  const firstLine = result.feedback.split("\n").find((line) => line.trim().length > 0) ?? ""
  if (!/^# Review: [0-9a-f]{4,}/.test(firstLine)) {
    return fail(`REVIEW.md's first non-blank line was "${firstLine}", expected "# Review: <hash>"`)
  }
  if (!result.feedback.includes("<!-- base:")) {
    return fail("REVIEW.md is missing its `<!-- base: ... -->` marker")
  }
  if (!/^## /m.test(result.feedback)) {
    return fail("REVIEW.md has no `## <Chunk Title>` heading")
  }
  return undefined
}

export default function grade(output, context) {
  const result = JSON.parse(output)
  const variant = context.vars.variant
  return runChecks([...SHARED_CHECKS, checkReviewShape], result, spec, variant)
}
