# Task: spec-harvest scenario — out-of-scope `!!` is NOT harvested

## Goal

Prove the new scope: a `!!` comment in a file that is NOT referenced by the
current `REVIEW.md` and is NOT dirty (committed before the review, untouched by
the session) is NOT harvested.

## Scenario shape

Add ONE scenario to `tests/integration/features/spec-harvest.feature` using
existing composable Given steps only (`a test project`,
`a commit … that adds … with:`, `"<path>" is modified to:`). Mirror the existing
scenarios' structure:

1. `a test project`
2. a commit that adds a REFERENCED file (e.g. `src/app.ts`) WITHOUT a `!!`
   comment — it is the file the REVIEW.md chunk points at
3. a commit that adds a SECOND, UNREFERENCED file (e.g. `src/other.ts` or
   `docs/notes.md`) that DOES contain a `// !! …` comment, committed before the
   review and left untouched
4. a commit `review(gtd): create review for abc1234` that adds `REVIEW.md` with
   a `<!-- base: … -->` line and a chunk ref to ONLY the first file
   (`- [ ] ./src/app.ts#1`)
5. `"REVIEW.md" is modified to:` tick that chunk (`- [x] ./src/app.ts#1`)

When I run gtd. Then:

- it succeeds
- stdout contains `# Process Review Feedback` (the review-process prompt is
  emitted — REVIEW.md exists and is modified)
- stdout does NOT contain the unreferenced file's `!!` text (proving it was not
  harvested)

## Acceptance criteria

- [ ] New scenario in `tests/integration/features/spec-harvest.feature`
- [ ] An UNREFERENCED, non-dirty committed file carries the only `!!` comment
- [ ] The REVIEW.md chunk references a DIFFERENT file (the one without `!!`)
- [ ] Asserts `# Process Review Feedback` IS emitted
- [ ] Asserts the unreferenced `!!` text is NOT in stdout
- [ ] Existing spec-harvest scenarios remain untouched and passing
- [ ] Uses only existing Given/When/Then steps (no new step definitions)
- [ ] `npm run test:e2e` GREEN

## Files

- `tests/integration/features/spec-harvest.feature` (only this file)

## Constraints / edge cases

- File-disjoint from task 01 (impl) and task 03 (docs). This scenario PASSES
  only once task 01's scoping lands; both ship in the same package commit, so
  the package as a whole is green.
- REVIEW.md fixture MUST include the `<!-- base: … -->` comment or gatherEvents
  errors.
- Pick `!!` text distinctive enough that a "does not contain" assertion is
  meaningful (avoid words that appear elsewhere in the prompt).
- Keep the unreferenced file OUT of the working-tree dirty set (commit it, then
  don't modify it) so it is excluded by both halves of the scope union.
