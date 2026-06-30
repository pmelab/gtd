# TestRunner: handle a nonexistent testCommand cleanly (Group D, part 2)

Fix #22 — a missing `testCommand` binary crashes unformatted after committing
`gtd: building`. This task owns `src/TestRunner.ts` and the test-run consumption
in `src/Events.ts`; it is **file-disjoint** from task `01-...` in this package
(which owns `Machine.ts` / `Git.ts`), so the two run in parallel.

## Files (this task owns these — do NOT touch Machine.ts / Git.ts)

- `src/TestRunner.ts` (`run`, the `Effect.orDie` at ~line 59)
- `src/Events.ts` (the run consumption at ~lines 340-343 — `gatherEvents` /
  testing edge) — only the part that consumes the `TestResult`, NOT
  `parsePorcelainPaths` / `stripCode` (those are owned by package `03`)
- `tests/integration/features/testing.feature` (extend)
- `tests/integration/support/steps/*.ts` (reuse; add generic steps if needed)
- `README.md` (document the clean missing-binary error → stderr / exit 1)

## Bug to fix (#22)

- Location: `src/TestRunner.ts:59` ends the `run` Effect with `Effect.orDie`, so
  a spawn failure (e.g. `ENOENT` — the configured command's binary does not
  exist) becomes an Effect **defect**: a raw stack on stdout, surfacing AFTER a
  misleading `gtd: building` state commit.
- The run is consumed at `src/Events.ts:340-343`.
- Replace `Effect.orDie` with a typed-error catch:
  - A **spawn failure** (the binary is missing / not executable — `SystemError`
    / `ENOENT`) must produce a clean, actionable, typed `Error` (e.g.
    `gtd: test command not found: <command>`) that flows through `main.ts`'s
    `catchAll` to **stderr** with exit 1 — not a defect, and not presented as a
    test result.
  - A **non-zero test exit** is NOT an error — it stays data
    (`{ exitCode, output }`), exactly as today (`TestRunnerOperations.run` is
    documented to never fail the Effect for a non-zero exit). Keep that contract
    for the non-zero-exit case.
- So the two cases must be treated distinctly: failed spawn → typed Effect
  error; ran-but-failed → `TestResult` with a non-zero `exitCode`.
- Because `run` can now fail, its type changes from `Effect.Effect<TestResult>`
  to `Effect.Effect<TestResult, Error>` (or similar). Update
  `TestRunnerOperations.run`'s signature and the consumer in `Events.ts` so the
  typed error propagates to `main.ts` (do not swallow it; do not commit a
  misleading state before the failure surfaces).

## Constraints / edge cases

- The clean error must reach **stderr** with exit 1 (verify it propagates
  through `main.ts:95-100` `catchAll`), not stdout.
- Do not regress the normal red/green flows: a real test command that exits
  non-zero must still produce a `TestResult` (drives fixing/escalation), and a
  passing command must still produce `exitCode 0`. The existing
  `testing.feature`, `fixing.feature`, and the config `testCommand` scenarios
  rely on this.
- Capturing combined stdout+stderr of the spawned process must still work for
  the ran-but-failed case (the empty-failure sentinel logic downstream depends
  on `output`).
- Coordinate the "must not commit a misleading state first" requirement: ensure
  the spawn-failure error short-circuits before / instead of the `gtd: building`
  outcome is presented as a success — verify the resulting behavior in the
  scenario (the failure surfaces, not a build-then-crash).

## Cucumber scenarios (add to `testing.feature`)

Per AGENTS.md: composable generic `Given` steps, real config content in the
scenario text, one commit per setup step. Reuse
`Given a gtd config file at ".gtdrc" with:`,
`Given a commit {string} that adds {string} with:`,
`Given a file {string} with:`, `When I run gtd`, `Then it fails`,
`Then stderr contains {string}`, `Then stdout does not contain {string}`.

- Nonexistent test command: configure `.gtdrc` with a `testCommand` pointing at
  a binary that does not exist (e.g. `testCommand: this-binary-does-not-exist`),
  set up a state that triggers a test run (mirror the `config.feature` "custom
  testCommand reaches the runner" setup: `gtd: planning` package + a pending
  code file). Run gtd.
  - `Then it fails` (exit 1).
  - `stderr contains` a clean message naming the missing command (e.g.
    `test command not found` / the command name).
  - `stdout does not contain` a raw stack token (assert no defect dump on
    stdout, e.g. stdout does not contain `at ` or `Error:` — pick a token unique
    to the raw defect).
- Regression: a test command that exists but exits non-zero still drives the
  normal fixing path (a non-zero exit is data, not an error) — keep / confirm
  via an existing scenario; add one if none directly covers it.

## Acceptance criteria

- [ ] A missing test-command binary produces a clean, typed error → stderr +
      exit 1 (no raw defect/stack on stdout)
- [ ] The failure is NOT preceded by a misleading committed `gtd: building`
      success outcome
- [ ] A non-zero test exit is still treated as data (`TestResult`), driving the
      normal fixing/escalation flow
- [ ] A passing test command still yields `exitCode 0`
- [ ] `TestRunnerOperations.run` signature + the `Events.ts` consumer updated
      for the new typed error
- [ ] New cucumber scenario(s) in `testing.feature` for the missing-binary case
- [ ] Existing testing / fixing / config testCommand scenarios still pass
- [ ] README updated (clean missing-binary error semantics)
- [ ] Full test suite is green
