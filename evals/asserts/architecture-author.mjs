// `architecture.author`'s grader: the shared core plus the merge-decision
// check — `## Merged Concerns` must appear, well-formed, exactly when the
// fixture's two concerns share a footprint (see
// evals/cases/architecture-author.mjs).
import spec from "../cases/architecture-author.mjs"
import { SHARED_CHECKS, safeGrade } from "./shared.mjs"

const fail = (reason) => ({ pass: false, score: 0, reason })

function checkMergedConcerns(result, caseDef, variant) {
  const heading = /^## Merged Concerns\s*\n+(\S[^\n]*)/m.exec(result.feedback)
  const shouldMerge = variant === "violation"
  if (!shouldMerge) {
    if (!/^## Merged Concerns/m.test(result.feedback)) return undefined
    return fail("ARCHITECTURE.md merged two concerns with disjoint file footprints")
  }
  if (!heading) {
    return fail(
      "ARCHITECTURE.md has no well-formed `## Merged Concerns` heading for two same-file concerns",
    )
  }
  return undefined
}

export default function grade(output, context) {
  return safeGrade(output, context, spec, [...SHARED_CHECKS, checkMergedConcerns])
}
