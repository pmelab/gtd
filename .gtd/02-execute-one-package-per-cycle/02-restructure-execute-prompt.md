# Task: Restructure `execute.md` to one package per cycle

Rewrite the `execute` prompt so each gtd invocation executes EXACTLY ONE work
package (the lowest-numbered one), not all packages sequentially in a single run.
Verification now happens at the START of the next cycle via the edge test-gate
(task 01), so the in-prompt "testing subagent" step is removed.

This task touches ONLY `src/prompts/execute.md` and its unit assertions, so it
runs in parallel with task 01 (the edge wiring).

## Files

- `src/prompts/execute.md` — rewrite.
- `src/Prompt.test.ts` — update/extend the `execute` prompt assertion to match
  the new one-package wording.

## New `execute.md` structure

Replace the current "Execute all work packages ... sequentially" framing with:

1. **Scope: exactly one package.** State that this run executes only the
   lowest-numbered package remaining in `.gtd/` (e.g. `01-...`). The Context
   block already lists the packages and their task files; instruct the agent to
   pick the first one.
2. **Step 1 — Spawn parallel task workers** for THAT ONE package's task files
   (keep the existing orchestration + TDD-discipline guidance, model preference
   lookup, and the worker-failure handling: report which tasks failed and ask
   Retry / Skip / Abort).
3. **REMOVE the old "Step 2: Spawn testing subagent"** entirely. Verification is
   done deterministically by the edge at the start of the next cycle (it runs
   `npm run test`); the prompt must NOT instruct the agent to determine/run the
   test command.
4. **Commit step** (was Step 3 happy path): after the workers complete, read the
   package's `COMMIT_MSG.md`, commit ALL changes with that message, then delete
   the package directory from `.gtd/`.
5. **Re-run gtd.** End by instructing the agent to re-run gtd (the auto-advance
   partial is still appended for `execute`, so this run continues to the next
   package; the next cycle's edge runs the tests that verify what was just
   committed). Remove the old "return to Step 1 for the next package" loop —
   one package per invocation now.

## Acceptance criteria

- [ ] `execute.md` instructs executing exactly ONE (lowest-numbered) package per
      run; the "execute all packages sequentially" loop is gone.
- [ ] The "testing subagent" / "determine the test command" step is removed.
- [ ] The happy path: spawn parallel workers → commit with COMMIT_MSG.md →
      delete package dir → re-run gtd.
- [ ] `src/Prompt.test.ts` `execute` assertions updated: still renders the
      execute section + auto-advance partial; new assertion confirms the
      testing-subagent wording is gone (e.g. does NOT contain "testing
      subagent" / "Determine the test command").
- [ ] `npm run typecheck` and `npm test` pass.

## Constraints / edge cases

- Keep the worker-FAILURE (crash/timeout, not test failure) handling — that is
  orchestration, distinct from test verification.
- Do NOT reintroduce any "run the test suite" instruction; that responsibility
  now lives entirely in the edge.
- The auto-advance behavior for `execute` is unchanged (still an auto-advance
  leaf in the machine).
