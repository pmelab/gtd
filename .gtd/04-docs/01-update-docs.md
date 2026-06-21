# Task: Update README, AGENTS.md, and SKILL.md for the machine

Document the refactored behavior. Prose only — no code/test impact.

## What to write

Across `README.md`, `AGENTS.md`, and `SKILL.md` (each where relevant):

- The gtd loop is now an **xstate event-sourced state machine** used as a pure
  fold over git history + the working tree (replace any "snapshot detection /
  `branches[]`" description).
- The `fix(gtd): <desc>` convention for test-fix iterations, and the iteration
  **cap fixed at 5** (machine-enforced constant, NOT AGENTS.md-configurable —
  correct any prior "retry limit … check AGENTS.md" wording that implies the
  machine reads it; the agent-level retry hint in execute prompts can stay).
- The new **`escalate`** halt state: what triggers it and how to resume (commit a
  non-`fix(gtd):` change to reset the counter).
- `TODO:` markers are now ordinary code; marker→`TODO.md` extraction happens only
  during review processing.
- The **CLI ref argument is removed**; review base is always auto-computed and
  `human-review` is the sole REVIEW.md generator (drop "review mode / `gtd <ref>`
  / review-create" docs).
- Update any workflow-step / state-list enumerations to the new leaf set
  (no `verify`, `todo-markers`, `review-create`; add `escalate`).

## Acceptance criteria

- [ ] README/AGENTS/SKILL describe the machine, `fix(gtd):` + fixed cap 5,
      `escalate`, markers-are-code, and ref removal
- [ ] No remaining references to `gtd <ref>` review mode, `review-create`,
      `verify`, `todo-markers`, or AGENTS.md-configurable retry cap
- [ ] State/step lists match the implemented leaf ids
- [ ] `npm run format:check` passes (or run `npm run format`)

## Files

- `README.md`, `AGENTS.md`, `SKILL.md`

## Constraints

- Keep it accurate to the shipped code from package 03 — verify claims against
  `src/Machine.ts` and the prompt files.
- Per user rule: every significant change must be reflected in the README.
