import { builtInLenses } from "./steps.js"
import { lensesOf, lensScopes } from "../../workflow-kit/index.js"

// The bundled workflow's default skills, one list per SCOPE, keyed by the
// scope's full name — the same name a `config.skills` entry addresses. A
// nested scope with no entry inherits its parent's; group scopes
// (`implement.fix`, `build.fix`, `build.review.fix`, `build.quality`, `refactor.fix`) run
// no turn and carry no key. `build.quality.<lens>` is one key per
// `qualityReviews` entry, so the export is a function of the vars.
export const skills = (
  vars: Readonly<Record<string, string>>,
): Readonly<Record<string, readonly string[]>> => {
  const build: Record<string, readonly string[]> = {
    build: ["debugging-and-error-recovery"],
    "build.health": ["debugging-and-error-recovery"],
    "build.fix.quality": ["incremental-implementation", "code-simplification"],
    "build.review": ["code-review-and-quality"],
    "build.review.fix.nits": ["incremental-implementation", "code-simplification"],
    "build.review.fix.risks": ["debugging-and-error-recovery", "incremental-implementation"],
  }
  return {
    design: ["spec-driven-development", "planning-and-task-breakdown"],
    // `fix`'s turn over the notes a review handed on.
    notes: ["incremental-implementation", "code-simplification"],
    // `review`'s turn building what a review round collected.
    feedback: ["test-driven-development", "incremental-implementation"],
    // The `tests` workflow's sweep and rewrites.
    tests: ["test-audit", "test-driven-development"],
    "tests.health": ["debugging-and-error-recovery"],
    // The refactor's own turns load `ponytail`; `refactor.build.*` carry the `build.*` lists.
    ...build,
    ...Object.fromEntries(Object.entries(build).map(([name, list]) => [`refactor.${name}`, list])),
    refactor: ["ponytail"],
    "refactor.fix.suite": ["ponytail", "debugging-and-error-recovery"],
    "refactor.health": ["ponytail", "debugging-and-error-recovery"],
    seam: ["incremental-implementation"],
    implement: ["test-driven-development", "incremental-implementation"],
    "implement.fix.suite": ["debugging-and-error-recovery"],
    // `health` is shared code reached from both `implement` and `build`.
    "implement.health": ["debugging-and-error-recovery"],
    ...lensScopes(
      "build.quality",
      lensesOf(vars.qualityReviews ?? ""),
      (lens) => builtInLenses[lens]?.skills ?? [lens],
    ),
    ...lensScopes(
      "refactor.build.quality",
      lensesOf(vars.refactorQualityReviews ?? ""),
      (lens) => builtInLenses[lens]?.skills ?? [lens],
    ),
  }
}
