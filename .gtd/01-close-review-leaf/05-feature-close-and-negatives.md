# Cucumber: close-review happy path + strict-predicate negatives (REPLACE churn scenario)

Per AGENTS.md, add cucumber scenarios for the feature. Reuse the existing
composable Given steps; expose real REVIEW.md content in scenario text. The
existing scenario that contradicts this feature MUST be replaced.

## Files

- `tests/integration/features/review.feature`
  - REPLACE the scenario "Checkbox-only REVIEW.md with no text feedback is
    processed as valid" (`:92-116`) — it encodes the exact churn this feature
    eliminates and now asserts the wrong outcome.
  - Add the new negative scenarios below.
- `tests/integration/support/steps/*` — reuse existing steps. The needed steps
  already exist:
  - `a test project` (`common.steps.ts:9`)
  - `a commit {string} that adds {string} with:` (`common.steps.ts:19-28`)
  - `{string} is modified to:` (`common.steps.ts:30-33`)
  - `a file {string} with:` (`common.steps.ts:13-17`)
  - `I run gtd`, `it succeeds`, `stdout contains {string}`,
    `stdout does not contain {string}` (`common.steps.ts:78-102`)
  - Do NOT add one-off steps; if a generic gap appears, add a small composable
    Given (one step = one commit) rather than hiding setup.

## Scenarios to add/replace

### REPLACE: forward-tick-only REVIEW.md routes to close-review

Same setup as the old scenario (commit a REVIEW.md with two `- [ ]` boxes, then
modify it to tick both to `- [x]`, nothing else changed), but assert the new
outcome:
- [ ] `Then it succeeds`
- [ ] `And stdout contains "chore(gtd): close approved review"`
- [ ] `And stdout does not contain "# Process Review Feedback"`

### NEW: Un-ticking a box routes to review-process, not close

Committed REVIEW.md has `- [x] ./src/foo.ts#1`; modify it to `- [ ] ./src/foo.ts#1`
(a backward un-tick), nothing else changed.
- [ ] `Then it succeeds`
- [ ] `And stdout contains "# Process Review Feedback"`
- [ ] `And stdout does not contain "chore(gtd): close approved review"`

### NEW: Checkbox tick plus a prose edit routes to review-process

Committed REVIEW.md has `- [ ] ./src/foo.ts#1`; modify it to tick the box AND add
a prose line (e.g. "Please rename foo to bar.").
- [ ] `Then it succeeds`
- [ ] `And stdout contains "# Process Review Feedback"`
- [ ] `And stdout does not contain "chore(gtd): close approved review"`

### NEW: Checkbox tick plus a source-file edit routes to review-process

Committed REVIEW.md has `- [ ] ./src/foo.ts#1`; modify it to tick the box, AND
add an untracked/modified source file (use `a file "src/scratch.ts" with:` so the
working tree has a non-REVIEW.md dirty path → `codeDirty`).
- [ ] `Then it succeeds`
- [ ] `And stdout contains "# Process Review Feedback"`
- [ ] `And stdout does not contain "chore(gtd): close approved review"`

## Constraints

- Every committed REVIEW.md must include the `<!-- base: <full-hash> -->` marker
  (see existing scenarios at `:5-15`), otherwise the "missing base ref" failure
  fires first.
- The "After closing, the next run reports verified" scenario is intentionally
  NOT here — it depends on the `computeReviewBase` edge and lives in package 02.

## Acceptance criteria

- [ ] The old "processed as valid" scenario is gone, replaced by the
      close-review happy-path scenario.
- [ ] Three negative scenarios prove the predicate is strict (un-tick, prose,
      source edit all route to review-process).
- [ ] All scenarios use only composable Given steps with real file content in the
      scenario text.
- [ ] `npm test` (or the project's cucumber command) passes for these scenarios.
