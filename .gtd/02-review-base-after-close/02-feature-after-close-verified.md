# Cucumber: after closing, the next run reports verified

End-to-end scenario proving both feature edges compose: once a close commit
exists in history, re-running gtd on a clean tree resolves to `verified` rather
than re-triggering a fresh `human-review`. This guards Answered Question 2 /
the `computeReviewBase` close-candidate edge (package 02 task 01).

## Files

- `tests/integration/features/review.feature` — add the scenario below.
- `tests/integration/support/steps/*` — reuse existing composable steps:
  - `a test project` (`common.steps.ts:9`)
  - `a commit {string} that adds {string} with:` (`common.steps.ts:19-28`)
  - `I run gtd`, `it succeeds`, `stdout contains`, `stdout does not contain`
    (`common.steps.ts:78-102`)
  - There is already a generic "a commit ... that adds ... with:" step that
    creates a real commit; use it to lay down the close commit. Only add a new
    composable Given if no existing step can land a `git rm`-style deletion
    commit — prefer reusing `a commit ... that adds ...` against a fresh file so
    the working tree ends clean. If a deletion commit is genuinely needed, add a
    small generic step (one step = one commit) that exposes the committed
    subject in the scenario text, e.g.
    `Given a commit {string}` (empty/marker commit) rather than hiding intent.

## Scenario

"After closing, the next run reports verified, not a fresh review"

Setup that yields a clean working tree whose closest review-base ancestor is a
`chore(gtd): close approved review for <sha>` commit, with no diff between that
commit and HEAD:
- A test project with some committed source.
- A `chore(gtd): close approved review for <short-sha>` commit at HEAD (the close
  commit landed by package 01's prompt; lay it down with the generic commit
  step). Working tree clean, no REVIEW.md present.

Assertions:
- [ ] `Then it succeeds`
- [ ] `And stdout contains "working tree healthy and fully reviewed"` (the
      `verified` prompt's report line — see `src/prompts/verified.md:21`).
- [ ] `And stdout does not contain "# Review:"` and does not contain the
      human-review prompt's REVIEW.md-generation copy (e.g.
      `And stdout does not contain "Generate REVIEW.md"` /
      `"create review for"` as appropriate — assert against the actual
      human-review.md heading "Generate REVIEW.md after successful verification",
      `src/prompts/human-review.md:14`).

## Constraints / notes

- This scenario MUST run after package 01 exists (the close-review prompt
  produces the commit subject this scenario relies on) AND after package 02 task
  01 (the `computeReviewBase` candidate) — both are in scope by the time this
  task runs. Without the base candidate, the close commit would still be an
  ancestor but the merge-base candidate could win and re-trigger human-review;
  this scenario is the regression guard for that.
- Keep the history minimal but ensure the close commit is the closest ancestor
  of HEAD (i.e. HEAD === close commit, or only non-diff commits after it) so
  `diffRef(closeCommit, HEAD)` is empty.

## Acceptance criteria

- [ ] New scenario added using only composable Given steps with real content in
      scenario text.
- [ ] Asserts `verified` ("working tree healthy and fully reviewed") and NOT a
      fresh human-review.
- [ ] The cucumber suite passes.
