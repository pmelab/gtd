// `build.review.reviewing`'s grader: the shared core plus the review's own
// required shape (first line, base marker, at least one chunk heading) —
// see `unified.yaml`'s `humanReview.reviewing` prompt for the contract this
// checks.
import spec from "../cases/build-review-reviewing.mjs"
import { SHARED_CHECKS, safeGrade } from "./shared.mjs"

const fail = (reason) => ({ pass: false, score: 0, reason })

function firstNonBlankLine(text) {
  return text.split("\n").find((line) => line.trim().length > 0) ?? ""
}

// One (predicate, reason) row per shape requirement — a flat table the loop
// below just walks, so this stays a single early-return per failure instead
// of nested branching.
function reviewShapeViolations(result) {
  const firstLine = firstNonBlankLine(result.feedback)
  return [
    [
      !/^# Review: [0-9a-f]{4,}/.test(firstLine),
      `REVIEW.md's first non-blank line was "${firstLine}", expected "# Review: <hash>"`,
    ],
    [
      !result.feedback.includes("<!-- base:"),
      "REVIEW.md is missing its `<!-- base: ... -->` marker",
    ],
    [!/^## /m.test(result.feedback), "REVIEW.md has no `## <Chunk Title>` heading"],
  ]
}

function checkReviewShape(result) {
  const violation = reviewShapeViolations(result).find(([failed]) => failed)
  return violation ? fail(violation[1]) : undefined
}

export default function grade(output, context) {
  return safeGrade(output, context, spec, [...SHARED_CHECKS, checkReviewShape])
}
