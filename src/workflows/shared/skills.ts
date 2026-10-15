import { builtInLenses } from "./steps.js"
import { lensesOf, lensScopes } from "../../workflow-kit/index.js"

// The bundled workflow's default skills, one list per SCOPE, keyed by the
// scope's full name — the same name a `config.skills` entry addresses. A
// nested scope with no entry inherits its parent's; group scopes
// (`packages.item.fix`, `build.fix`, `build.review.fix`, `build.quality`, `refactor.fix`) run
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
  // `health` is shared code reached from both `packages.item` and `build`.
  "packages.item.health": ["debugging-and-error-recovery"],
  build: ["debugging-and-error-recovery"],
  "build.health": ["debugging-and-error-recovery"],
  "build.fix.quality": ["incremental-implementation", "code-simplification"],
  "build.review": ["code-review-and-quality"],
  "build.review.fix.nits": ["incremental-implementation", "code-simplification"],
  "build.review.fix.risks": ["debugging-and-error-recovery", "incremental-implementation"],
  // `fix`'s turn over the notes a review handed on.
  notes: ["incremental-implementation", "code-simplification"],
  // Every refactor agent turn loads `ponytail`.
  refactor: ["ponytail"],
  "refactor.fix.suite": ["ponytail", "debugging-and-error-recovery"],
  "refactor.health": ["ponytail", "debugging-and-error-recovery"],
  ...lensScopes(
    "build.quality",
    lensesOf(vars.qualityReviews ?? ""),
    (lens) => builtInLenses[lens]?.skills ?? [lens],
  ),
})
