# Task: Update README.md for deterministic test execution

Reflect the behavior shipped in packages 01-02 in `README.md` (per the global
rule: every significant change is reflected in the README). This task touches
ONLY `README.md`, so it runs in parallel with the SKILL.md task.

## Files

- `README.md`

## Required edits

1. **States table** (around lines 57-64): update the `execute` and
   `human-review` rows to reflect deterministic test execution:
   - `execute` → "Run `npm run test`; if green, execute the next (lowest-
     numbered) package (parallel subagents); if red, fix-tests."
   - `human-review` → "Run `npm run test`; if green, generate `REVIEW.md`; if
     red, fix-tests."
   Add a row for the new **fix-tests** prompt (note it is a prompt, not a
   machine leaf state — emitted by the edge when `npm run test` fails on the
   human-review/execute paths; make one `fix(gtd):` commit then re-run).

2. **Test execution section**: document that gtd itself now runs the hardcoded
   `npm run test` in the Effect edge (not the agent), capturing stdout+stderr+
   exit code, and branches the prompt on the result. State the command is
   hardcoded for now (no env/config override). Note `src/Machine.ts` stays pure;
   the test run lives in the edge.

3. **Test-fix iterations note** (around lines 73-77, 163-166): clarify the
   trailing `fix(gtd):` cap (5 → escalate) is now enforced in the EDGE before
   emitting fix-tests, so it works uniformly for both human-review and execute
   (the latter sits above `capReached` in the machine guard order).

4. **Mermaid diagram** (around lines 121-128): reflect that execute and
   human-review run tests and can branch to a fix-tests prompt. Keep it accurate
   — fix-tests is an edge prompt-selection, not a machine state.

5. **Execute walkthrough / "What it does"** (around lines 148-154, 205-218):
   update to one-package-per-cycle: each `/gtd` run executes ONE package
   (workers + commit + delete dir + re-run); the NEXT cycle's edge runs
   `npm run test` to verify the package just committed. Remove the description of
   an in-prompt testing subagent running tests.

## Acceptance criteria

- [ ] README states table reflects test-gated `execute` and `human-review` and
      includes the `fix-tests` prompt.
- [ ] README documents the hardcoded `npm run test` edge execution and that the
      cap is enforced in the edge.
- [ ] README execute walkthrough describes one-package-per-cycle and no longer
      describes an in-prompt testing subagent.
- [ ] The Mermaid diagram is consistent with the new behavior.
- [ ] No stale references to the agent determining/running the test command in
      the execute or human-review descriptions.

## Constraints / edge cases

- Be precise: `fix-tests` is a PROMPT selected in the edge, NOT a `LeafState` —
  do not list it as one of the machine's resolved leaf states.
- Do not contradict the unchanged machine guard order.
