// The bundled workflow's default skills, one list per agent step, keyed by
// the step's FULL name (its scope prefixes included) — the same name a
// `.gtdrc` `skills:` entry addresses. A step's name is not derivable from
// flow code alone (loops, branches, shared calls), so this map is the only
// place every addressable name is declared up front; `steps.test.ts` pins
// each step's declared list against a renamed map key.
//
// `packages.item.health.describe` and `build.health.describe` are not a
// duplicate: the escalation loop (`healthy()`, in `./health.ts`) is shared
// code reached from both `scope("packages") -> scope("item")` and
// `scope("build")`, so the one `health.describe` step name resolves to two
// different full names depending on which caller is looping.
export const skills: Readonly<Record<string, readonly string[]>> = {
  "design.triage": ["spec-driven-development", "planning-and-task-breakdown"],
  "architecture.author": ["api-and-interface-design", "documentation-and-adrs", "ponytail"],
  "architecture.decompose": ["incremental-implementation", "planning-and-task-breakdown"],
  "packages.item.building": ["test-driven-development", "incremental-implementation"],
  "packages.item.fix-suite": ["debugging-and-error-recovery"],
  "packages.item.health.describe": ["debugging-and-error-recovery"],
  "build.fix": ["debugging-and-error-recovery"],
  "build.health.describe": ["debugging-and-error-recovery"],
  // No bundled default: unlike every other entry, the lens named in the
  // prompt BODY already varies per turn (see `reviewQuality` in
  // `./steps.ts`), which is what the preamble falls back to naming instead —
  // a fixed bundled list here would repeat one entry on every turn. A
  // `.gtdrc` `skills:` entry still overrides that per-turn fallback, on the
  // wire and in the preamble alike (`resolveSkills` in `../replay/Replay.ts`
  // is what both share).
  "build.quality.reviewing": [],
  "build.fix-quality": ["incremental-implementation", "code-simplification"],
  "build.review.reviewing": ["code-review-and-quality"],
  "build.review.answer-review-questions": ["code-review-and-quality"],
  "build.review.fix-nits": ["incremental-implementation", "code-simplification"],
  "build.review.fix-risks": ["debugging-and-error-recovery", "incremental-implementation"],
  "build.review.collecting": ["code-review-and-quality"],
}
