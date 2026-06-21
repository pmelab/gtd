# Task: Update the cucumber feature suite for the new behavior

Bring the integration tests in line with the ref-less, single-state machine so
`npm run test:e2e` is green after the cutover.

## What to build

1. **`tests/integration/features/review.feature`**: remove ALL ref-arg scenarios
   (`gtd <valid-ref>`, invalid ref, ref+REVIEW.md conflict, ref+dirty-tree,
   ref==HEAD empty-diff). Keep the review-process scenarios and the REVIEW.md
   corruption / exists-but-unmodified error scenarios (none use a ref arg).

2. **`tests/integration/features/branches.feature`**: rewrite "New TODO: markers
   compose with commit task" — markers are now ordinary code, so a diff
   containing `// TODO:` yields **only** the commit-the-changes task
   (`code-changes`), no `todo-markers` section. Keep all other scenarios green as
   a parity proof of the machine vs the old `detect()`.

3. **`tests/integration/features/auto-advance.feature`**: drop the "Review-create
   prompt … with ref HEAD~1" scenario.

4. **New `tests/integration/features/verify-loop.feature`**:
   - mixed code+`TODO.md` dirty → only code committed, `TODO.md` left dirty
   - a chain of `fix(gtd):` commits below the cap → gated state (no `escalate`)
   - at the cap (5) → `escalate`, assert output STOPs and contains NO "Re-run gtd
     immediately"
   - on green → progresses to planning
   - Use composable per-commit `Given` steps (one step → one commit), per
     AGENTS.md. Reuse existing steps (`a commit ... that adds ...`); add a
     `fix(gtd):`-commit Given only if none fits.

## Acceptance criteria

- [ ] No feature references a ref argument anymore
- [ ] branches.feature markers scenario asserts commit-only output
- [ ] `verify-loop.feature` covers code-committed/TODO-left, below-cap gate,
      at-cap escalate (no auto-advance), and green→planning
- [ ] `npm run build` then `npm run test:e2e` pass

## Files

- `tests/integration/features/review.feature`,
  `branches.feature`, `auto-advance.feature`
- `tests/integration/features/verify-loop.feature` (new)
- `tests/integration/support/steps/*.ts` (extend composably; the
  `I run gtd with ref` step + its scenarios go away)

## Constraints

- e2e drives the BUILT `scripts/gtd.js` — run `npm run build` before `test:e2e`.
- Keep Given steps small/reusable and surface real file content in scenario text
  (AGENTS.md testing rules).
