# 01 — Refactor slice and its review

Introduces `reviewedRefactor`, `requireNoTestFiles`, the `buildTail` options,
the `tail`/`qualityLap` lens override, `refactorQualityReviews` and
`testFileGlobs`. Package 02 wires them into the naive path. **Until 02 lands,
`seamBuild` still calls `refactorFirst` and `seam.approve` still runs** — the
existing seam and refactor-first scenarios must stay green unchanged.

Interfaces, call stacks and settled answers: `.gtd/ARCHITECTURE.md`.

## Requirements

### 2. Refactor review and its feedback loop (PRODUCT)

- **Step names: the refactor tail nests under `refactor` —
  `refactor.build.review.*`, `refactor.build.quality.<lens>`**; the feature tail
  keeps `build.review.*` / `build.quality.<lens>` on every path
- **`skills` keys are per full scope name**: a `build.review` or
  `build.quality.<lens>` entry does not reach the refactor scopes; they need
  their own entries, and ship with the same default skills as their feature
  counterparts
- **Refactor review covers the refactor slice's commits only**
- Same review flow as the feature review: questions answered in place, nits
  fixed, could-notes deferred to `.gtd/TODO.md`, edits loop
- **An edit note re-runs the refactor, never a re-plan**, under the same guards:
  stray paths only, no new or added flag reads, no test file touched
- **Quality-lap fixes, fix-check turns and nit fixes in the refactor slice run
  under those guards too**
- A note asking for a change outside the strays is refused by the guard; the way
  out is abandon and restart
- The human's code edits at the refactor review are re-unwound, as at the
  feature review

### 4. No test file touched by the refactor (TECHNICAL)

- **A refactor turn (building, fix, quality fix, nit) that changes a test file
  is refused at `gtd land`**, even when the file is a stray — today's package
  rule "a test file only when it is one of them" goes
- Refactor package text and prompts drop that exception
- **Fixed list `testFileGlobs`, no setting: `*_test.go`, `test_*.py` and other
  naming get no refusal**

### 5. `refactorQualityReviews` setting (PRODUCT)

- **New process setting `refactorQualityReviews`, default
  `correctness, ponytail-review, conventions`**: the lenses of the refactor
  slice's quality lap (`refactor.build.quality.<lens>`); `qualityReviews` keeps
  driving the feature slice
- Settable like `qualityReviews`: factory option, `GTD_REFACTORQUALITYREVIEWS`;
  blank runs no refactor lap

## Tasks

### 1. `testFileGlobs` and `refactorQualityReviews` settings

Paths: `src/workflows/shared/vars.ts`, `src/workflows/shared/options.ts`,
`src/workflows/shared/options.test.ts`

- [ ] `testFileGlobs` exported with exactly `**/*.test.*`, `**/*.spec.*`,
      `**/*.feature`, `**/tests/**`, `**/test/**`, `**/__tests__/**`
- [ ] `defaults.seamAllow` built from `[...testFileGlobs, ".gtd/**"]`,
      **byte-equal to today's string** (test pins it)
- [ ] `defaults.refactorQualityReviews` is
      `correctness, ponytail-review, conventions`; `ShippedOptions` and
      `FlagOptions` gain it; a factory option wins over the default (test)

### 2. `tail` / `qualityLap` take a guard and lenses

Paths: `src/workflows/shared/tail.ts`, `src/workflows/shared/tail.test.ts`

- [ ] Additive trailing `guard?` and `lenses?` parameters; existing callers
      unchanged
- [ ] `lenses` overrides `qualityReviews`; `[]` runs no lens turn (test)
- [ ] `guard` runs after quality-fix turns

### 3. `buildTail` options; `reUnwind` moves to `review.ts`

Paths: `src/workflows/feature/review.ts`,
`src/workflows/feature/review.test.ts`, `src/workflows/feature/feature.ts`

- [ ] `BuildTailOptions { guard, lenses, feedback }` and `FeedbackTarget` as in
      the architecture; default feedback stays `.gtd/REQUIREMENTS.md` via
      `collecting`
- [ ] `feedback.file` replaces `.gtd/REQUIREMENTS.md` as the feedback test;
      `unmatched` is the refusal when the collecting turn changed something but
      not `file` (test)
- [ ] `guard` runs after fix-check, risk-fix, nit-fix and escalation-describe
      turns (test covers risk-fix and nit-fix)
- [ ] `reUnwind` body moved unchanged to `review.ts`, re-exported from
      `feature.ts` under the same name; restores edited paths from `restoreFrom`
      and removes added ones, in the caller's scope (test)
- [ ] `lint:boundaries` passes — no `feature.ts` ↔ `refactor.ts` cycle

### 4. `requireNoTestFiles` in the refactor guard

Paths: `src/workflows/feature/refactor.ts`,
`src/workflows/feature/refactor.test.ts`,
`tests/integration/features/refactor-package.feature`

- [ ] Refuses with `gtd land: refactor-tests: …`, naming each changed path of
      the turn's own `changes()` matching `testFileGlobs`, **strays included**
      (test)
- [ ] Passes non-test paths and `.gtd/` paths (test)
- [ ] **A narrowed `seamAllow` does not narrow the refusal** (test)
- [ ] `refactorFirst` guard = `requireWithin(strays)` +
      `requireNoNewFlags(pattern, entry)` + `requireNoTestFiles()`, `entry` =
      HEAD at the refactor scope's entry; signature unchanged
- [ ] Scenario: `refactorFirst` with a test file among its strays refuses a
      build turn changing it, `refactor-tests` on stderr

### 5. Refactor prompts and the collecting step

Paths: `src/workflows/shared/text.ts`, `src/workflows/shared/text.test.ts`,
`src/workflows/feature/steps.ts`

- [ ] `refactorRules` / `packageLines`: "a test file only when it is one of
      them" becomes "never a test file" (test)
- [ ] `refactorBuildingPrompt` gains `feedback?`; on true it adds the
      act-on-`## Review feedback` line (test)
- [ ] `refactorReviewCollectingPrompt` names `.gtd/REFACTOR.md`, never
      `.gtd/REQUIREMENTS.md`, and says a non-stray, test-file or flag concern
      cannot be built — abandon and restart (test)
- [ ] `refactorCollecting` step `review.collecting` (full name
      `refactor.build.review.collecting`) writes `.gtd/REFACTOR.md`, no qa mode

### 6. `reviewedRefactor`

Paths: `src/workflows/feature/refactor.ts`,
`src/workflows/feature/refactor.test.ts`, `src/workflows/feature/index.ts`

- [ ] One
      `scope({ name: "refactor", access: { write: [...strays, ".gtd/**"] } })`:
      derive → build → health → close, then
      `buildTail(false, entry, true, { guard, lenses: lensesOf(vars.refactorQualityReviews), feedback: REFACTOR.md target })`
- [ ] After closing, the tail's steps are `refactor.build.*` and the review base
      is HEAD at scope entry (test)
- [ ] Feedback → `reUnwind` → `refactor.deriving` re-derives a package holding
      `## Review feedback` and the collected text, strays fixed; then
      `refactor.building` with `feedback: true` (test)
- [ ] `refactor.closing` removes the package before the tail
- [ ] Guard runs after quality-fix, nit-fix and fix-check turns (test)
- [ ] `land` or unreadable shapes resolve false with no step (test)
- [ ] Package rules say "never a test file" (test)
- [ ] Exported via `@pmelab/gtd/workflows`

### 7. Skills and access for `refactor.build.*`

Paths: `src/workflows/shared/skills.ts`, `src/workflows/shared/skills.test.ts`,
`src/workflows/shared/access.ts`, `src/workflows/shared/access.test.ts`

- [ ] `skills(vars)` adds `refactor.build`, `refactor.build.health`,
      `refactor.build.fix.quality`, `refactor.build.review`,
      `refactor.build.review.fix.nits`, `refactor.build.review.fix.risks` with
      their `build.*` counterparts' lists, plus one
      `refactor.build.quality.<lens>` per `refactorQualityReviews` entry (test)
- [ ] `access(vars)` adds only `refactor.build.quality.<lens>` as `write: []`;
      no other `refactor.build.*` key (test)
- [ ] Fix the "every refactor agent turn loads ponytail" comment in `skills.ts`:
      `refactor.build.*` carry the `build.*` lists

### 8. Gate

- [ ] `npm test` green (all release-flag states), `lint:boundaries` clean,
      `format:check` clean

## Tests

- unit: `src/workflows/shared/options.test.ts`
- unit: `src/workflows/shared/tail.test.ts`
- unit: `src/workflows/feature/review.test.ts`
- unit: `src/workflows/feature/refactor.test.ts`
- unit: `src/workflows/shared/text.test.ts`
- unit: `src/workflows/shared/skills.test.ts`
- unit: `src/workflows/shared/access.test.ts`
- e2e: `tests/integration/features/refactor-package.feature`
