# Review: 5d1eb16

<!-- base: 341ec92d0a5f2627a1eb1d2bba6872466770ce70 -->

No `Risk:` notes. Range verified: `tests/tooling/test-states.test.ts` and
`tests/tooling/package-exports.test.ts` pass. Real turbo 2.10.9 merges a task's
stderr into its own stdout, so the vitest reporter's stderr FAIL blocks do reach
the captured signature. No `.feature` file changed, so this review has no
`## Scenarios` chunk.

## `npm test` prints only failures and collapses repeats

The runner now buffers each flag state's turbo stdout, runs turbo with
`--output-logs=errors-only`, and prints a failing state's log only when its
normalised signature is new. A repeat prints one
`FAIL (same failure as <state>)` line. A user's own `--output-logs` replaces the
default and turns collapsing off. Exit codes are unchanged.

- [ ] ./scripts/test-states.ts#29-34 — `RunTasks` now returns `{ code, stdout }`
      instead of a bare code.
- [ ] ./scripts/test-states.ts#61-86 — `failureSignature`: strips ANSI codes and
      trailing CR, keeps only lines prefixed `<task>: ` for the state's own
      tasks, swaps timestamps, clock times, 12+ char hex and durations for
      placeholders, groups lines per task, and sorts the tasks. **Lines from
      dependency tasks (`build:`) are left out of the signature**, so a distinct
      `build` failure is ignored when other tasks fail the same way. Build is
      not flag-dependent, so this does not bite today. **The trailing-CR strip
      is untested.** A mutation that disables it stays green.
- [ ] ./scripts/test-states.ts#88-111 — `printOut`/`reportFailure`: the first
      failure with a given signature prints its log, then `FAIL`. A later match
      prints one line naming the earlier state. An empty signature, or full
      mode, never collapses.
- [ ] ./scripts/test-states.ts#113-133 — `runStates`: a single state now prints
      its buffered stdout and returns its code. In multi-state mode, a pass
      prints only its `pass` line unless `full` is set. A null code still counts
      as FAIL.
- [ ] ./scripts/test-states.ts#139-143 — `turboArgv` appends
      `--output-logs=errors-only` unless the user passed `--output-logs` in
      either form (turbo rejects the flag twice). Nit: the same `--output-logs`
      check is copied in `test-states.main.ts`. If one copy changes and the
      other does not, full mode and the argv default disagree.
- [ ] ./scripts/test-states.ts#151-163 — `spawnTurbo` pipes stdout and keeps
      stdin and stderr inherited, with a 256 MiB `maxBuffer` (the 1 MiB default
      would ENOBUFS-kill a long log). **A terminal `npm test` now shows no task
      output until each state finishes, and Ctrl-C loses that state's log.** The
      design accepted this ("hidden always").
- [ ] ./scripts/test-states.main.ts#10-10 — passes `full` when the user's args
      carry `--output-logs`. Any value counts, `none` included, which only turns
      collapsing off. Harmless.
- [ ] ./tests/vitest.reporter.ts#18-20 — FAIL blocks are sorted by `fullName`,
      so two states with the same 2+ failures produce the same signature
      regardless of the order parallel files finish in. No test pins the sort.
- [ ] ./docs/development.md#25-28 — states that only failing logs print, that
      repeats collapse to `same failure as <state>`, and that
      `npm test -- --output-logs=full` restores every log.

## Tests for the runner

- [ ] ./tests/tooling/test-states.test.ts#33-43 — `stub` accepts a bare code or
      a full `TurboRun`.
- [ ] ./tests/tooling/test-states.test.ts#117-122 — the spawn-failure case now
      expects `{ code: null, stdout: "" }`.
- [ ] ./tests/tooling/test-states.test.ts#131-164 — the shim turbo tests pin the
      appended `--output-logs=errors-only`, stdout and exit-code capture, and 2
      MiB of stdout without a kill.
- [ ] ./tests/tooling/test-states.test.ts#166-189 — `turboArgv` keeps a user's
      `--output-logs=full` or `--output-logs full` and adds no default.
- [ ] ./tests/tooling/test-states.test.ts#191-222 — runs the real local turbo
      binary in a temp project and checks that the signature holds the failing
      line and stays the same across two runs. **Needs a working
      `node_modules/.bin/turbo` and real process spawns inside the unit tier.**
- [ ] ./tests/tooling/test-states.test.ts#224-264 — `failureSignature` unit
      cases: noise is ignored, assertion text counts, turbo summary lines are
      ignored, interleaved tasks give the same result, line order within a task
      matters, and a log with no task lines gives an empty signature.
- [ ] ./tests/tooling/test-states.test.ts#266-362 — `runStates` cases:
      single-state stdout and null mapped to 1, passes stay silent, full mode
      prints everything and never collapses, the first failure prints before its
      FAIL line, a repeat collapses and names the earlier state, a third state
      matches the second distinct failure, and empty signatures never collapse.

## Repo-config test derives its workflow list

The test no longer hardcodes five workflow names. It reads every
`export const <name> = <fn>(` from `gtd.config.ts` and asserts that the loaded
config's `workflowNames` equals that set and that each name resolves.

- [ ] ./tests/tooling/package-exports.test.ts#85-95 — a regex scan of
      `gtd.config.ts` gives the expected workflow list.
      `export const config = {` does not match, which is correct. **A workflow
      exported any other way (re-export, `export function`) is missing from
      `declared` and reds the test.** The comment says this is intended.

## Lint warnings can no longer hide in a passing log

`errors-only` hides a passing `lint` task's output, so a warn-level rule would
never be seen. The one warn rule is now an error.

- [ ] ./.oxlintrc.json#17-17 — `react-hooks/exhaustive-deps` goes from `warn` to
      `error`. The tree is clean today, so nothing new goes red.
