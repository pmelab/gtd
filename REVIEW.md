# Review: 9820256

<!-- base: 9820256139b7d75bbefa26036f453ce7ef727543 -->

Adds the `close-review` leaf: when a reviewer ticks `REVIEW.md` checkboxes
forward (`[ ]` → `[x]`) with no other edits, the loop treats it as approval,
deletes `REVIEW.md`, commits a close marker, and resolves the following run to
`verified` instead of churning through review-process. Two code edges plus
prompt, docs, and tests.

## Detect a forward-tick-only REVIEW.md diff

`gatherEvents` compares the working `REVIEW.md` against its committed version
and sets `reviewApprovedNoChanges` true iff every differing line is a forward
tick (committed `- [ ]`, working `- [x]`, otherwise identical), with equal line
counts and no other dirty path. Un-ticks, prose edits, or any source change make
it false and fall through to review-process.

- [ ] ./src/Events.ts#185
- [ ] ./src/Git.ts#152

## Route to the close-review leaf

New `close-review` leaf in `LeafState`, guarded by `reviewApprovedNoChanges` and
ordered **before** `reviewModified → review-process` (a forward tick also sets
`reviewModified`, so it must win). Registered as a final, auto-advance state.

- [ ] ./src/Machine.ts#67
- [ ] ./src/Machine.ts#135

## close-review prompt

New `close-review.md`: test gate, then `git checkout -- REVIEW.md` →
`git rm REVIEW.md` → commit `chore(gtd): close approved review for <short-sha>`,
auto-advance. The short-sha is read from `REVIEW.md`'s `<!-- base: -->` marker
(buildContext does not surface `baseRef` without a `refDiff`).

- [ ] ./src/prompts/close-review.md#1
- [ ] ./src/Prompt.ts#16

## computeReviewBase resolves to verified after close

`lastCloseCommit` greps the newest `chore(gtd): close approved review …` commit
and adds it as a `computeReviewBase` candidate, so the run after a close uses
the close commit as base and falls through to `verified` rather than
re-reviewing.

- [ ] ./src/Events.ts#82
- [ ] ./src/Git.ts#121

## Tests

Unit: `showHead`/`lastCloseCommit` (Git), close-review leaf + ordering
regression (Machine), close-review prompt render (Prompt). Integration: replaced
the obsolete "checkbox-only processed as valid" churn scenario with a
close-review happy path, three strict-predicate negatives (un-tick, prose,
source edit), and an "after closing → verified" scenario.

- [ ] ./tests/integration/features/review.feature#92
- [ ] ./src/Machine.test.ts#1
- [ ] ./src/Git.test.ts#1
- [ ] ./src/Prompt.test.ts#1

## Docs

README state table/diagram and SKILL.md updated for the new leaf, the
forward-tick rule, and the close-commit review base.

- [ ] ./README.md#1
- [ ] ./SKILL.md#1
