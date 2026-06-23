# Task: Document the scoped `!!` harvesting

## Goal

Per CLAUDE.md ("every significant change reflected in the README"), update the
user-facing docs to state that `!!` harvesting is scoped to the files the
current `REVIEW.md` covers (its referenced files ∪ the dirty working tree), NOT
the whole tracked tree.

## Changes

### `README.md`

- Update the `!!` follow-up comments callout (~lines 108-112) and any other
  prose describing harvesting (e.g. the review walkthrough ~lines 251-255) to
  note that harvesting is scoped to the files referenced by the current
  `REVIEW.md` (its chunk references) plus the dirty working tree — not every
  `!!` in the tree.

### `SKILL.md`

- Update the `review-process` / harvesting wording (~lines 132-133, 175) to
  reflect the same scoped behavior.

### `src/prompts/review-process.md`

- Update Step 4.3 (~lines 42-49) wording so "scan the reviewed code" is
  consistent with the scope actually implemented: gtd has already harvested the
  in-scope `!!` comments (the files the current `REVIEW.md` covers plus the
  dirty tree) and inlined them in the Context — the prompt should not imply a
  whole-tree scan.

## Acceptance criteria

- [ ] `README.md` states `!!` harvesting is scoped to REVIEW.md-referenced files
      ∪ dirty working tree, not the whole tracked tree
- [ ] `SKILL.md` harvesting wording matches the scoped behavior
- [ ] `src/prompts/review-process.md` Step 4.3 wording is consistent with the
      scoped harvest (no implication of a whole-tree scan)
- [ ] No code files touched (docs/prompt prose only)
- [ ] Existing test suite remains GREEN (`npm run test`, `npm run test:e2e`) —
      note review.feature / spec-harvest assert on specific prompt task
      headings; do not alter the `# Process Review Feedback` heading or the
      `## Step 4` structure those tests rely on

## Files

- `README.md`
- `SKILL.md`
- `src/prompts/review-process.md`

## Constraints / edge cases

- File-disjoint from tasks 01 and 02. These three doc files are owned solely by
  this task.
- Do NOT change prompt headings/anchors that integration tests assert on (e.g.
  `# Process Review Feedback`, `## Task: …`, and the `!!` literal that
  spec-harvest greps for). Edit surrounding explanatory prose only.
- `src/Git.ts`'s grepBang doc comment is updated in task 01, NOT here.
