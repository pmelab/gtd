# Task: Cucumber scenario — `code-changes` preserves `REVIEW.md`

## Goal

Add a scenario proving that when both a source file and `REVIEW.md` are dirty,
the emitted `code-changes` prompt instructs committing the source edit while
LEAVING `REVIEW.md` uncommitted, so the next fold can reach `review-process`.

## Important: how gtd is tested here

gtd EMITS a prompt; it does NOT execute the prompt's git commands itself (no LLM
in the test harness). So a literal "run gtd twice and assert REVIEW.md stays
dirty" is not achievable in cucumber. Instead, assert on the EMITTED prompt
text — the same pattern existing scenarios use (e.g. `review.feature` asserts
`stdout contains "## Task: Commit the uncommitted changes"`).

## Scenario shape

Add to `tests/integration/features/review.feature` (the home of the existing
code-changes-on-the-review-path scenario near line 228). Use existing composable
Given steps only — `a test project`, `a commit … that adds … with:`,
`"<path>" is modified to:`, `a file … with:`. Setup:

1. `a test project`
2. a commit `review(gtd): create review for abc1234` that adds `REVIEW.md`
   (include a `<!-- base: abc1234567890abcdef1234 -->` line and a chunk ref, so
   it parses)
3. `"REVIEW.md" is modified to:` — add a reviewer note line
4. a dirty source file (e.g. `a file "src/app.ts" with:` some content, OR a
   commit that adds it then `"src/app.ts" is modified to:` so it is dirty)

When I run gtd. Then:

- it succeeds
- stdout contains `## Task: Commit the uncommitted changes` (the code-changes
  leaf wins because codeDirty sits above reviewModified)
- stdout contains `git restore --staged REVIEW.md` (the new instruction proving
  REVIEW.md is excluded from the commit)

## Acceptance criteria

- [ ] New scenario added to `tests/integration/features/review.feature`
- [ ] Scenario sets up a committed `REVIEW.md`, a modified `REVIEW.md` with a
      note, AND a dirty non-control source file
- [ ] Scenario asserts the emitted prompt is `code-changes`
      (`## Task: Commit the uncommitted changes`)
- [ ] Scenario asserts the prompt instructs `git restore --staged REVIEW.md`
- [ ] Uses only existing Given/When/Then steps (no new step definitions); if a
      needed step truly does not exist, prefer composing existing ones
- [ ] `npm run test` (or the project test command) is GREEN after the package's
      prompt change lands

## Files

- `tests/integration/features/review.feature` (only this file)

## Constraints / edge cases

- File-disjoint from task 01: this task edits ONLY the feature file; the prompt
  edit lives in task 01. Both run in parallel within this package.
- Do NOT add a "run gtd twice" step — assert on emitted prompt text instead.
- The `REVIEW.md` fixture MUST contain the `<!-- base: … -->` comment or
  gatherEvents fails with "REVIEW.md is corrupted: missing base ref".
