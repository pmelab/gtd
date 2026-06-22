# Review: 1da2058

<!-- base: 1da20584803ea8737e7c58f9feaf5f7424564d56 -->

## TestRunner Effect service

New `TestRunner` service wrapping the hardcoded `npm run test`. Follows the
`GitService` pattern (`Context.Tag` + `static Live = Layer.effect(...)` over
`CommandExecutor`). Captures combined stdout+stderr and the exit code; a
non-zero exit is returned as `TestResult` data, never raised as an Effect error,
so the edge can branch on `exitCode` in both green and red cases.

- [ ] ./src/TestRunner.ts#1
- [ ] ./src/TestRunner.test.ts#1

## fix-tests prompt + buildPrompt override

New `fix-tests.md` prompt (mirrors the old human-review test-gate wording: one
`fix(gtd):` fix, then re-run). `buildPrompt` gains an optional `PromptOverride`
second argument so the edge can force the `fix-tests` prompt and embed captured
output in a backtick-aware fence. `fix-tests` is deliberately NOT added to the
`LeafState` union or `SECTIONS` — it is reachable only via the override, never
by the machine fold.

- [ ] ./src/prompts/fix-tests.md#1
- [ ] ./src/Prompt.ts#72
- [ ] ./src/Prompt.test.ts#1

## Edge test gate + prompt selection

The pure `selectPrompt(result, testResult)` helper (in `State.ts`) maps a
resolved leaf + test result to a prompt selection: green → normal prompt; red
below cap → `fix-tests` with output; red at/over cap → `escalate`. The cap is
read generically from `result.context.verifyIterations` / `maxVerifyIterations`.
`main.ts` runs `TestRunner.run()` only when the resolved leaf is in
`TEST_GATED_LEAVES` ({`human-review`, `execute`}), provides `TestRunner.Live`,
and leaves the `format` subcommand and all other leaves ungated.
`src/Machine.ts` is untouched — no new state, no guard reorder.

- [ ] ./src/State.ts#6
- [ ] ./src/State.test.ts#1
- [ ] ./src/main.ts#17

## Remove agent test-gate from human-review

The "## Test gate (run first)" block is removed from `human-review.md`; the edge
now runs the suite deterministically, so the agent must not be told to run it
again. The REVIEW.md-generation task is unchanged.

- [ ] ./src/prompts/human-review.md#1

## execute.md — one package per cycle

`execute.md` rewritten so each run executes exactly one (lowest-numbered)
package, commits with its `COMMIT_MSG.md`, deletes the dir, and re-runs. The
in-prompt "testing subagent" step is gone — verification happens at the start of
the next cycle via the edge gate. Worker-failure (crash/timeout) handling is
kept.

- [ ] ./src/prompts/execute.md#1

## e2e coverage + fixture updates

New `test-gate.feature` (human-review green/red/cap) and `execute-gate.feature`
(execute green/red/cap), driving the gate via a committed `package.json` whose
`test` script exits 0/≠0 on demand. Existing human-review/execute scenarios in
`branches.feature` and `auto-advance.feature` gained a committed `package.json`
(and the execute assertion updated to the new "one work package" wording) so
they still pass through the gate. Cap scenarios place the 5 `fix(gtd):` commits
in the counted range (separate default branch) so the cap actually trips.

- [ ] ./tests/integration/features/test-gate.feature#1
- [ ] ./tests/integration/features/execute-gate.feature#1
- [ ] ./tests/integration/features/branches.feature#122
- [ ] ./tests/integration/features/auto-advance.feature#61

## Docs

README.md and SKILL.md updated: states tables (test-gated `execute` /
`human-review` + the edge-selected `fix-tests` prompt), the edge-enforced
`fix(gtd):` cap note, the one-package-per-cycle execute walkthrough, and the
mermaid diagram.

- [ ] ./README.md#55
- [ ] ./SKILL.md#84

## Generated bundle

`scripts/gtd.js` is the checked-in tsup build artifact, regenerated from the
edited sources. Not reviewed line-by-line.

- [ ] ./scripts/gtd.js#1
