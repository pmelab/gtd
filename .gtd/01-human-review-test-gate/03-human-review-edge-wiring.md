# Task: Edge wiring — run tests on `human-review`, branch green/red, honor cap

Wire the test gate into the Effect edge for the **human-review** leaf only. The
edge runs `npm run test`, then chooses the prompt:

- leaf `human-review` + exit 0 (green) → existing human-review prompt (REVIEW.md
  generation), unchanged.
- leaf `human-review` + exit ≠ 0 (red) → `fix-tests` prompt with captured output
  — UNLESS the escalation cap is reached, in which case emit `escalate`.

This task wires against the contracts defined by tasks 01 (TestRunner) and 02
(buildPrompt override). Those tasks run in parallel; implement against their
documented signatures.

## Files

- `src/State.ts` and/or `src/main.ts` — add the test-gate branch in the edge.
  Decide which is cleanest: `detect()` returns the `ResolveResult`; the
  test-run + prompt-selection branch may live in `main.ts` (it already owns
  `buildPrompt` + stdout write) or a new exported edge helper in `State.ts`.
  Keep `src/Machine.ts` pure — NO IO there.
- `src/main.ts` — provide `TestRunner.Live` into the program's layer stack
  alongside `GitService.Live` and `NodeContext.layer`.
- `src/prompts/human-review.md` — REMOVE the "## Test gate (run first)" block
  (the first ~11 lines: that heading plus its bullet list). The edge now runs
  tests; the agent must NOT be told to run them again. The "## Task: Generate
  REVIEW.md after successful verification" section STAYS. There is no separate
  human-review partial — only this file needs editing.

## Required behavior

1. After `detect()` yields the `ResolveResult`, if `result.value ===
   "human-review"`, run `TestRunner.run()` (contract from task 01).
2. Green (`exitCode === 0`) → `buildPrompt(result)` (no override) — unchanged
   REVIEW.md path.
3. Red (`exitCode !== 0`):
   - Read the trailing `fix(gtd):` count from the RESOLVED machine context:
     `result.context.verifyIterations` vs `result.context.maxVerifyIterations`
     (= `MAX_VERIFY_ITERATIONS` = 5).
   - If `verifyIterations >= maxVerifyIterations` → emit the **escalate** prompt
     instead of fix-tests. The simplest correct emission is
     `buildPrompt({ ...result, value: "escalate", autoAdvance: false })` (or an
     equivalent that renders the escalate section). Verify the rendered output
     contains the escalate section ("Escalate to the human").
   - Else → `buildPrompt(result, { kind: "fix-tests", testOutput: <captured
     output> })`.
4. For any other leaf (not `human-review`), do NOT run tests — behavior is
   exactly as today. (The `execute` path is added in package 02.)

## Acceptance criteria

- [ ] `human-review` green: gtd emits the REVIEW.md-generation prompt; tests ARE
      run (the gate executed). No `fix-tests` content.
- [ ] `human-review` red, below cap: gtd emits the `fix-tests` prompt with the
      captured failure output embedded; no REVIEW.md instructions.
- [ ] `human-review` red, at cap (verifyIterations >= 5): gtd emits the
      `escalate` prompt and does NOT emit fix-tests.
- [ ] Non-`human-review` leaves (e.g. `decompose`, `code-changes`, `verified`)
      do NOT trigger a test run and are unchanged.
- [ ] `main.ts` provides `TestRunner.Live`; `npm run typecheck` passes; the
      program still exits 0 on success.
- [ ] Unit coverage for the edge selection logic (green→normal, red<cap→
      fix-tests, red>=cap→escalate), e.g. by extracting a pure selection helper
      `selectPrompt(result, testResult)` that is unit-testable without spawning
      a real subprocess.

## Constraints / edge cases

- Machine guard ORDER is NOT changed. `human-review` already sits below
  `capReached` in the machine, so the cap check here is belt-and-suspenders for
  human-review but is REQUIRED for the execute path in package 02 — implement
  the cap check generically so package 02 reuses it.
- Do NOT add a machine state for fix-tests.
- The `format` subcommand branch in `main.ts` must keep working (it must NOT run
  the test gate).
