# Task: Edge test-gate + branching for the `execute` leaf

Extend the Effect edge so the `execute` leaf runs `npm run test` first (exactly
like the human-review gate added in package 01), then branches. This reuses the
TestRunner service and the `fix-tests`/cap selection helper that package 01
already created and wired — DO NOT re-create them; extend the existing edge
selection to cover `execute` too.

## Files

- `src/State.ts` and/or `src/main.ts` — extend the edge test-gate branch so it
  triggers for `result.value === "execute"` in addition to `"human-review"`.
- Unit tests next to the edge selection helper (e.g. `src/State.test.ts` or
  wherever package 01 put `selectPrompt`).

## Required behavior

1. When `resolve()` lands on `execute`, the edge runs `TestRunner.run()` BEFORE
   emitting a prompt (every cycle, including the first — no first-vs-later
   special casing per the plan's answered question).
2. Green (exit 0) → emit the normal `execute` prompt (the one-package-per-cycle
   prompt restructured in task 02 of this package). On a clean tree this has
   verified the previously-committed package's cumulative state; the first cycle
   verifies the decompose/baseline commit.
3. Red (exit ≠ 0):
   - If trailing `fix(gtd):` count (`result.context.verifyIterations`) >=
     `maxVerifyIterations` (5) → emit `escalate`.
   - Else → emit the `fix-tests` prompt with the captured output (a prior
     package broke the tests).
4. The cap check is REQUIRED here: the machine checks `hasPackages` (execute)
   BEFORE `capReached`, so without this edge check a failing-test package would
   loop forever. Machine guard order is NOT changed — the cap is enforced in the
   edge. Reuse the exact same cap-check helper from package 01.

## Acceptance criteria

- [ ] `execute` leaf green: tests are run, then the execute prompt is emitted.
- [ ] `execute` leaf red below cap: `fix-tests` prompt with captured output;
      no execute-prompt content.
- [ ] `execute` leaf red at/over cap (verifyIterations >= 5): `escalate` prompt
      is emitted (NOT fix-tests, NOT execute) — proving the edge cap overrides
      the machine's hasPackages-before-capReached ordering.
- [ ] Existing human-review gate behavior from package 01 is unchanged.
- [ ] Unit coverage for the `execute`-leaf selection (green→execute,
      red<cap→fix-tests, red>=cap→escalate).
- [ ] `npm run typecheck` passes.

## Constraints / edge cases

- Do NOT modify `src/Machine.ts` (no new state, no guard reordering).
- Keep the test-gate trigger a simple set membership, e.g. leaf is one of
  {`human-review`, `execute`}, so future leaves are easy to add.
- The `format` subcommand and non-gated leaves must still never run the gate.
