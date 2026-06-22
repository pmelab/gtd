# Slice B — `decompose` records `TODO.md` before deleting it

## Description

Edit the static prompt markdown `src/prompts/decompose.md` so that, before
`TODO.md` is deleted, it is committed as a dedicated commit **when it is not
already recorded in `HEAD`** (untracked, or differs from `HEAD`). This preserves
the user's plan and its full Q&A history (`## Open Questions` /
`## Answered Questions`) for the direct-to-`decompose` path, where a fresh
`TODO.md` would otherwise disappear entirely.

This is a **static prompt markdown edit only** — `src/prompts/decompose.md` is
emitted verbatim by `src/Prompt.ts`. Do NOT change any TypeScript / state
machine logic. The plan establishes that no state-machine change is required:
commits are classified only by the `isFixGtd` regex
(`src/Events.ts:163` — `/^fix\(gtd\):/`), so the new `docs(plan): ...` commit
folds as an ordinary commit. As part of this task, sanity-check that assumption
(grep `src/Events.ts` and `src/Machine.ts` for any special-casing of `docs(`
commit subjects); if something special-cases it, STOP and flag it rather than
editing TS.

## What to change in `src/prompts/decompose.md`

The current "After the subagent completes" section (lines ~57-63) instructs:
1. Delete `TODO.md`
2. Commit `.gtd/` with `plan(gtd): decompose TODO.md into N work packages`

Insert a step BEFORE the deletion that records `TODO.md` first, **guarded** so
it is a no-op in the normal flow:

- If `TODO.md` is NOT already recorded in `HEAD` — i.e. it is untracked, or its
  content differs from the `HEAD` version (check e.g. via
  `git status --porcelain TODO.md` / `git diff --quiet HEAD -- TODO.md`) —
  commit it verbatim as:

  ```
  docs(plan): record TODO.md
  ```

- Then proceed to delete `TODO.md` and commit `.gtd/` exactly as today.
- Make explicit in the prompt WHY the guard exists: in the normal flow
  `new-todo` / `modified-todo` already commit `TODO.md`, so the guard is a no-op
  there; it only fires on the direct-to-`decompose` path (a fresh, never-committed
  `TODO.md` routed straight to decompose) — this is the case that preserves the
  user's plan + Q&A history.

Keep the existing decomposition rules and the final
`plan(gtd): decompose TODO.md into N work packages` commit unchanged.

## Cucumber scenarios (required by AGENTS.md)

Add scenarios to a feature file under `tests/integration/features/` asserting
the emitted `decompose` prompt stdout carries the new instruction. The existing
decompose scenarios live in `branches.feature` ("triggers decompose"); add the
new scenario(s) alongside them there to keep decompose coverage in one place (or
create a focused `decompose.feature` if cleaner — match existing conventions).

Follow the existing patterns:
- Reuse the composable `Given` steps in `common.steps.ts`:
  - `a test project`
  - `a commit {string} that adds {string} with:` — to seed a committed,
    finalized `TODO.md` (a `TODO.md`-only commit on a clean tree routes to
    `decompose`, per the existing
    "Clean tree after a TODO.md-only commit triggers decompose" scenario).
- Assert via `stdout contains {string}`.
- Do NOT invent new `Given` steps unless needed; keep any new one generic and
  content-revealing.

At minimum, add a scenario that:
- Seeds a finalized `TODO.md` so the run routes to `decompose`
  (`stdout contains "## Task: Decompose"`).
- Asserts the emitted prompt mentions recording `TODO.md` before deleting it —
  assert on the literal new commit subject `docs(plan): record TODO.md` (the
  load-bearing new instruction).

## Relevant files

- `/Users/pmelab/Code/gtd/gtd/src/prompts/decompose.md` (edit — the prompt)
- `/Users/pmelab/Code/gtd/gtd/src/Prompt.ts` (read only — confirms verbatim
  emission)
- `/Users/pmelab/Code/gtd/gtd/src/Events.ts` (read only — `isFixGtd` at line 163)
- `/Users/pmelab/Code/gtd/gtd/src/Machine.ts` (read only — verify nothing
  special-cases `docs(` subjects)
- `/Users/pmelab/Code/gtd/gtd/tests/integration/features/branches.feature`
  (add scenario(s) near existing decompose scenarios)
- `/Users/pmelab/Code/gtd/gtd/tests/integration/support/steps/common.steps.ts`
  (reuse existing steps)

## Constraints / edge cases

- The commit must be GUARDED: only commit `TODO.md` when it is not already in
  `HEAD` (untracked OR differs from `HEAD`). In the normal flow it is already
  committed, so the guard must be a no-op (no empty/duplicate commit).
- Record `TODO.md` VERBATIM, preserving its `## Open Questions` /
  `## Answered Questions` sections (this is the Q&A-retention concern from the
  TODO.md answered questions).
- Order: record `TODO.md` (if needed) → delete `TODO.md` → commit `.gtd/`. Do
  not fold the `TODO.md` recording into the `.gtd/` commit; it must be its own
  `docs(plan): record TODO.md` commit so the plan survives in history distinct
  from the deletion.
- Static markdown edit only — no TypeScript logic change. If TS appears
  necessary, STOP and flag it.

## Acceptance criteria

- [ ] `src/prompts/decompose.md` instructs, BEFORE deleting `TODO.md`, to commit
      it as `docs(plan): record TODO.md` only when it is not already recorded in
      `HEAD` (untracked or differs from `HEAD`).
- [ ] The prompt explains the guard is a no-op in the normal
      `new-todo`/`modified-todo` flow and only fires on the
      direct-to-`decompose` path.
- [ ] The existing delete-then-commit-`.gtd/` steps and the
      `plan(gtd): decompose TODO.md into N work packages` commit are unchanged.
- [ ] No TypeScript / state-machine files were modified; the
      `isFixGtd`-only-classification assumption was verified (or flagged if a
      special-case is found).
- [ ] New cucumber scenario(s) assert the emitted decompose prompt mentions
      recording `TODO.md` before deletion (asserts
      `stdout contains "docs(plan): record TODO.md"`), reusing existing
      composable `Given` steps.
- [ ] The cucumber test suite passes.
