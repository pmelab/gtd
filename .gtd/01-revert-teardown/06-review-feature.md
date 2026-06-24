# Update `review.feature` for the revert-based teardown + `reviewPresent` routing

Migrate the review e2e scenarios from the old reset-sequence assertions to the
new revert teardown, and add a scenario pinning the Q2 `reviewPresent` routing
(a note + dirty source goes to `review-process`, NOT `code-changes`).

This task owns `tests/integration/features/review.feature` exclusively. The
asserted strings come from the rewritten prompt (sibling task 05) and the new
`reviewPresent` gate (sibling tasks 02/03); all land in the same commit, and the
cucumber `BeforeAll` hook rebuilds the bundle from `src`, so the suite is green as
a package unit.

## Files (exclusive to this task)

- `tests/integration/features/review.feature`

## What to do

Follow AGENTS.md cucumber conventions: reuse the existing composable Given steps
(`a commit "…" that adds "REVIEW.md" with`, `"REVIEW.md" is modified to`,
`a file "…" with`); do not invent one-off setup steps.

1. **Scenario "Review process prompt instructs creating TODO.md and deleting
   REVIEW.md"** (~32-61): replace the assertion
   `And stdout contains "git checkout -- ."` (~61) with
   `And stdout contains "git revert --no-edit"`. Keep the `TODO.md` / `REVIEW.md`
   assertions.

2. **Scenario "… committing TODO.md and REVIEW.md deletion together"** (~63-90):
   replace the teardown-commit assertion
   `And stdout contains "docs(review): process review feedback into TODO.md"`
   (~90) with `And stdout contains "chore(gtd): close approved review"`.

3. **Scenario "… recording raw feedback before reset"** (~92-120): keep
   `And stdout contains "docs(review): record raw feedback for"` (~120) and
   `# Process Review Feedback`. (The word "reset" in the title may be reworded to
   "teardown" but is not load-bearing.)

4. **Add a new scenario — note + dirty source routes to `review-process`,
   artifact-free after revert.** A modified REVIEW.md with a prose note AND a
   dirty source file must route to `review-process` (NOT `code-changes`), proving
   the Q2 `reviewPresent` gate. Use the existing Given steps; e.g. a committed
   `review(gtd): create review for abc1234` REVIEW.md, then `"REVIEW.md" is
   modified to` a version with a note line added, plus `a file "src/scratch.ts"
   with` some content. Assert:
   - `And stdout contains "# Process Review Feedback"`
   - `And stdout does not contain "## Task: Commit the uncommitted changes"`
     (i.e. NOT code-changes)
   - `And stdout contains "git revert --no-edit"` (the teardown reverts the
     source edit committed in "x", leaving an artifact-free tree)

   NOTE: this REPLACES/UPDATES the existing scenario "Ticking a checkbox plus a
   source-file edit commits verbatim first" (~202-229), which today asserts
   code-changes wins. Under the new gate, a note (not a pure tick) + dirty source
   routes to review-process. Distinguish the two cases carefully:
   - If REVIEW.md has ONLY forward ticks (approval) + dirty source: the existing
     "code-changes preserves REVIEW.md" scenario (~231-260) covers the path where
     `reviewApprovedNoChanges` is false because a source file is dirty. Verify
     against the actual gate: with `reviewPresent` true, `codeDirty` is suppressed;
     a pure-tick REVIEW.md with `onlyReviewDirty` false yields
     `reviewApprovedNoChanges=false`, `reviewModified=true` →
     **`review-process`**. So scenario ~202-229 ("commits verbatim first") and
     ~231-260 ("code-changes preserves REVIEW.md") must be RE-EXAMINED: under the
     new gate they route to `review-process`, not `code-changes`. Update their
     assertions to `# Process Review Feedback` + `git revert --no-edit` and
     remove the `## Task: Commit the uncommitted changes` /
     `git restore --staged REVIEW.md` expectations. Confirm the actual leaf by
     running the suite; the gate is the source of truth.

5. **Keep unchanged** the scenarios that already match the new behavior:
   "Modified REVIEW.md triggers review-process" (~3-30), "Ticking all checkboxes …
   routes to close-review" (~122-148), "Un-ticking … routes to review-process"
   (~150-173), "Ticking + prose routes to review-process" (~175-200), "Error when
   base comment is missing" (~262-284), "Untracked files … committed verbatim
   first" (~286-314), "unmodified committed REVIEW.md is the review gate"
   (~316-331), and both post-close `verified` scenarios (~333-368). Only adjust
   their assertions if the suite shows a routing change under the new gate.

## Constraints

- Use existing composable Given steps only; one step ↔ one commit where the step
  commits.
- Do NOT assert harvested `!!` body text anywhere.
- The reverted tree must be asserted artifact-free via the teardown commands in
  stdout (this is a prompt-text e2e; the agent is not actually run), i.e. assert
  the prompt instructs `git revert --no-edit` rather than inspecting a real tree.

## Acceptance criteria

- [ ] No scenario asserts `git checkout -- .` or
      `docs(review): process review feedback into TODO.md`.
- [ ] The teardown scenario asserts `git revert --no-edit` and
      `chore(gtd): close approved review`.
- [ ] A scenario pins note+dirty-source → `review-process` (NOT
      `## Task: Commit the uncommitted changes`).
- [ ] Scenarios formerly asserting code-changes-wins under a present REVIEW.md
      are updated to the actual leaf under the `reviewPresent` gate.
- [ ] `npm run test:e2e` (cucumber) is green.
