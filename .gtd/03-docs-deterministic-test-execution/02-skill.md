# Task: Update SKILL.md for deterministic test execution

Reflect the behavior shipped in packages 01-02 in `SKILL.md`. This task touches
ONLY `SKILL.md`, so it runs in parallel with the README task.

## Files

- `SKILL.md`

## Required edits

1. **Execute walkthrough** (around lines 84-87): remove "Spawn a testing
   subagent to run tests and fix failures" from the execute step. Replace with
   one-package-per-cycle: each run executes ONE package (parallel workers +
   commit with COMMIT_MSG.md + delete the package dir + re-run); the next cycle
   verifies the committed package by running `npm run test` in the edge.

2. **Test-fix iteration cap note** (around lines 106-109): clarify that gtd now
   runs the hardcoded `npm run test` in the edge for the `human-review` and
   `execute` states, and the trailing `fix(gtd):` cap (fixed at 5 → escalate) is
   enforced in the edge before emitting the fix-tests prompt. The cap remains
   non-configurable.

3. **States list** (around lines 111-138): update `execute` and `human-review`
   entries to mention the `npm run test` gate (green → normal prompt, red →
   fix-tests). Document the `fix-tests` PROMPT explicitly as an edge-selected
   prompt (emitted when tests fail on those paths), making clear it is NOT one of
   the machine's resolved leaf states.

## Acceptance criteria

- [ ] SKILL.md execute walkthrough is one-package-per-cycle with no in-prompt
      testing subagent.
- [ ] SKILL.md documents the edge-run hardcoded `npm run test` for human-review
      and execute, and the edge-enforced `fix(gtd):` cap.
- [ ] SKILL.md describes the `fix-tests` prompt and distinguishes it from the
      machine leaf states.

## Constraints / edge cases

- `fix-tests` is a PROMPT selected in the edge, NOT a machine `LeafState` — keep
  the distinction explicit so the states list stays accurate.
- Keep SKILL.md consistent with README (both edited this package); do not
  introduce conflicting descriptions of the cap or the one-package cycle.
