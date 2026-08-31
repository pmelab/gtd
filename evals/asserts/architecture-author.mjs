// `architecture.author`'s grader: the shared core plus the merge-decision
// check — whether the two fixture concerns were actually MERGED is the
// two-sided axis this case exercises (see evals/cases/architecture-author.mjs).
import spec from "../cases/architecture-author.mjs"
import { SHARED_CHECKS, safeGrade } from "./shared.mjs"

const fail = (reason) => ({ pass: false, score: 0, reason })

// Markdown decoration a requirement picks up when it is carried into another
// section — blockquote markers when it is quoted, emphasis when it is
// restated in bold — plus the wrapping every `.gtd/*.md` file gets from
// oxfmt's `proseWrap`. Stripping all three is what lets "carried verbatim"
// be tested as a fact about the TEXT rather than about the formatting the
// author happened to choose.
function flowed(markdown) {
  return markdown
    .replace(/^\s*>\s?/gm, "")
    .replace(/[*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** The named `## <title>` section of a markdown document, heading excluded, or "" when absent. */
function section(markdown, title) {
  const start = markdown.search(new RegExp(`^## ${title}\\s*$`, "m"))
  if (start === -1) return ""
  const body = markdown.slice(start).replace(/^## .*\n/, "")
  const end = body.search(/^## /m)
  return end === -1 ? body : body.slice(0, end)
}

// The requirement bodies the fixture planted, read straight out of the
// variant's own REQUIREMENTS.md rather than duplicated into the case as a
// second copy that can drift from it.
function plantedRequirements(variant) {
  const requirements = spec.variants[variant][".gtd/REQUIREMENTS.md"]
  return requirements
    .split(/^## .*$/m)
    .map(flowed)
    .filter(Boolean)
}

// A merge RECORD is the thing being graded, never the heading: the workflow
// asks for both merged requirements "verbatim" under `## Merged Concerns`,
// so carrying both is what proves a merge happened. A section that carries
// neither — "No concerns were merged. The two footprints are disjoint." — is
// an author correctly DOCUMENTING the non-merge, which the disjoint fixture
// must accept rather than fail for the heading alone.
function recordsAMerge(feedback, variant) {
  const merged = flowed(section(feedback, "Merged Concerns"))
  if (!merged) return false
  return plantedRequirements(variant).every((requirement) => merged.includes(requirement))
}

function checkMergedConcerns(result, caseDef, variant) {
  const merged = recordsAMerge(result.feedback, variant)
  const shouldMerge = variant === "violation"
  if (merged === shouldMerge) return undefined
  return fail(
    shouldMerge
      ? "ARCHITECTURE.md records no merge of two concerns centered on the same file — `## Merged Concerns` must carry both requirements verbatim"
      : "ARCHITECTURE.md merged two concerns with disjoint file footprints",
  )
}

export default function grade(output, context) {
  return safeGrade(output, context, spec, [...SHARED_CHECKS, checkMergedConcerns])
}
