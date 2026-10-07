import { builtInLenses } from "./steps.js"
import { lensesOf } from "./review.js"

// The bundled workflow's default skills, one list per SCOPE, keyed by the
// scope's full name — the same name a `.gtdrc` `skills:` entry addresses. A
// nested scope with no entry inherits its parent's; group scopes
// (`packages.item.fix`, `build.fix`, `build.review.fix`, `build.quality`) run
// no turn and carry no key. `build.quality.<lens>` is one key per
// `qualityReviews` entry, so the export is a function of the vars.
export const skills = (
  vars: Readonly<Record<string, string>>,
): Readonly<Record<string, readonly string[]>> => ({
  design: ["spec-driven-development", "planning-and-task-breakdown"],
  architecture: ["api-and-interface-design", "documentation-and-adrs", "ponytail"],
  "architecture.decompose": ["incremental-implementation", "planning-and-task-breakdown"],
  "packages.item": ["test-driven-development", "incremental-implementation"],
  "packages.item.fix.suite": ["debugging-and-error-recovery"],
  "packages.item.fix.spec": ["incremental-implementation", "code-simplification"],
  "packages.item.spec": ["code-review-and-quality", "spec-driven-development"],
  // `health` is shared code reached from both `packages.item` and `build`.
  "packages.item.health": ["debugging-and-error-recovery"],
  build: ["debugging-and-error-recovery"],
  "build.health": ["debugging-and-error-recovery"],
  "build.fix.quality": ["incremental-implementation", "code-simplification"],
  "build.review": ["code-review-and-quality"],
  "build.review.fix.nits": ["incremental-implementation", "code-simplification"],
  "build.review.fix.risks": ["debugging-and-error-recovery", "incremental-implementation"],
  ...Object.fromEntries(
    lensesOf(vars.qualityReviews ?? "").map((lens) => [
      `build.quality.${lens}`,
      builtInLenses[lens]?.skills ?? [lens],
    ]),
  ),
})
