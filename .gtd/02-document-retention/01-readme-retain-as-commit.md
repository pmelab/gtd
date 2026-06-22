# Document the retain-as-commit behavior in the README

## Description

Update `README.md` so the review, decompose, and states documentation describe
the new "retain user-provided information as direct commits" behavior introduced
in package 01. Per the user's standing rule, every significant change must be
reflected in the README.

This package is sequential AFTER package 01 — it documents behavior that package
01 implements in the prompts. Read the final, merged
`src/prompts/review-process.md` and `src/prompts/decompose.md` before writing so
the README matches the exact commit subjects the prompts emit.

## What to update in `README.md`

1. **`## What it does` states table** (around lines 52-65): the `review-process`
   and `decompose` rows. Reflect that:
   - `review-process` now first commits the reviewer's raw dirty tree as
     `docs(review): record raw feedback for <base>` before resetting and
     synthesizing `TODO.md`.
   - `decompose` now records `TODO.md` as `docs(plan): record TODO.md` (when not
     already in `HEAD`) before deleting it.
   Keep the table concise — extend the existing "Prompt" cells or add a short
   clarifying note below the table rather than bloating the cells.

2. **`## Workflow` walkthrough** (the numbered "A typical feature" list, around
   lines 136-160, especially steps 5 and 9): note that decomposing records
   `TODO.md` before deleting it, and that processing review feedback first
   commits the raw feedback verbatim before folding it into a fresh `TODO.md`.

3. **`## Build orchestration` → `### 1. Decompose`** (around lines 169-191):
   update the decompose description so it states `TODO.md` is recorded as a
   `docs(plan): record TODO.md` commit (when not already in `HEAD`) before
   deletion, preserving the plan and its Q&A history.

4. Optionally add a short note near the states table or the review walkthrough
   explaining the principle: user-authored information (the plan + Q&A in
   `TODO.md`, and reviewer feedback in `REVIEW.md` / source edits / `TODO:`
   markers) always lands as a real commit before gtd transforms or discards it.

Use the EXACT commit subjects emitted by the prompts: `docs(review): record raw
feedback for <base>` and `docs(plan): record TODO.md`. Verify these against the
merged prompt files before writing.

## Relevant files

- `/Users/pmelab/Code/gtd/gtd/README.md` (edit — sections named above)
- `/Users/pmelab/Code/gtd/gtd/src/prompts/review-process.md` (read — match
  emitted commit subject + wording)
- `/Users/pmelab/Code/gtd/gtd/src/prompts/decompose.md` (read — match emitted
  commit subject + wording)

## Constraints / edge cases

- Documentation only — do not change prompts, TypeScript, or tests.
- Commit subjects in the README must EXACTLY match what the prompts emit; read
  the merged prompt files first.
- Keep the existing README tone and structure; do not restructure sections,
  only extend/clarify the named ones.
- Note the decompose recording is guarded (only when `TODO.md` is not already in
  `HEAD`) so readers understand it is a no-op in the normal flow.

## Acceptance criteria

- [ ] The `## What it does` states table (review-process and decompose rows)
      reflects the raw-feedback commit and the `docs(plan): record TODO.md`
      commit, using the exact emitted subjects.
- [ ] The `## Workflow` walkthrough (decompose and review-feedback steps) notes
      the retain-as-commit behavior.
- [ ] `## Build orchestration → ### 1. Decompose` states `TODO.md` is recorded
      as `docs(plan): record TODO.md` (when not already in `HEAD`) before
      deletion.
- [ ] README commit subjects match the merged prompt files verbatim.
- [ ] No non-README files were modified.
