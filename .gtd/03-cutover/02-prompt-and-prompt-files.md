# Task: Rewrite `Prompt.ts`, its unit test, and all prompt markdown

Make prompt rendering single-state and aligned to the new leaf ids. Prompt files
and `Prompt.ts` imports are coupled, so they ship together.

## What to build

1. **`src/Prompt.ts`**:
   - `SECTIONS` keyed by the leaf-id union from `src/Machine.ts` (one entry per
     leaf). Emit exactly ONE section for the resolved `value` (no array loop).
   - Drive the auto-advance partial from the passed `autoAdvance` flag, NOT
     `AUTO_ADVANCE_BRANCHES` (delete that set).
   - Drop imports of `todo-markers.md`, `verify.md`, `review-create.md`; add
     `escalate.md`.
   - `buildContext` reads from the new machine context (`refDiff`, `diff`,
     `packages`, `lastCommitSubject`, `workingTreeClean`).

2. **Prompt markdown** in `src/prompts/`:
   - **Create `escalate.md`**: report that N consecutive `fix(gtd):` attempts
     failed to get tests green, surface the latest failure output, ask the human
     to fix the root cause and commit with any non-`fix(gtd):` prefix (resets the
     counter) or amend/squash the chain, then **STOP** (no re-run).
   - **Delete** `todo-markers.md`, `verify.md`, `review-create.md`.
   - **Add a test-gate preamble** to `new-todo.md`, `modified-todo.md`,
     `human-review.md`, `verified.md`: run the suite first; on failure make ONE
     fix, commit **all** fix changes into a single `fix(gtd): <desc>` commit
     (leave only `TODO.md`/clean tree), then re-run gtd; on green proceed inline
     with the rest of the state's task.
   - **Edit `review-process.md`** to absorb `TODO:`-marker extraction (markers in
     reviewed code → notes pulled into `TODO.md` during review processing).
   - Confirm `code-changes.md` still says "commit only non-`TODO.md` code, leave
     `TODO.md` dirty".

3. **`src/Prompt.test.ts`**: switch from `branches[]` input to single-state input
   `{ value, context, autoAdvance }`; drop `verify`/`todo-markers` cases; add an
   `escalate` case; keep header/diff/format-instruction assertions.

## Acceptance criteria

- [ ] `Prompt.ts` emits one section by leaf id; auto-advance from the flag
- [ ] `escalate.md` exists; `todo-markers.md`/`verify.md`/`review-create.md` gone
- [ ] Test-gate preamble present in the four gated prompts; `review-process.md`
      covers marker extraction
- [ ] `Prompt.test.ts` uses the new single-state shape and passes
- [ ] `npm test` + `npm run typecheck` pass

## Files

- `src/Prompt.ts`, `src/Prompt.test.ts`
- `src/prompts/*.md` (create/delete/edit as above), `src/prompts/partials/auto-advance.md`
- Reference: current `src/Prompt.ts` (lines 1–101), `src/prompts/human-review.md`
  (already writes the `<!-- base: -->` marker — keep that)

## Constraints

- `SECTIONS` keys MUST exactly match the leaf-id union and the existing `.md`
  files after create/delete, or the build breaks.
- `human-review.md` remains the sole REVIEW.md generator (keeps base marker +
  `review(gtd): create review for <hash>` commit).
