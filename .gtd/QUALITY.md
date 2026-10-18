# Quality findings

## correctness: `--output-logs=full` does not restore full logs (docs/development.md, scripts/test-states.ts)

`docs/development.md` says `npm test -- --output-logs=full` restores full logs.
With the two release flags in the registry, `npm test` always runs 3 states, so
`runStates` takes the multi-state path. There a passing state's stdout is thrown
away (`if (code === 0) { log(... pass); continue }`), and so is the log of a
failure that matches an earlier one. The flag only reaches turbo; the runner
still hides everything it hid before. The test "logs one pass line per state,
never stdout" pins that behaviour, so it backs the gap instead of catching it.
Fix: when the user passes `--output-logs`, print every state's stdout and skip
the collapse. Or change the doc so it only claims the flag widens what a printed
failure shows.

## correctness: buffered stdout is lost on interrupt and arrives after stderr (scripts/test-states.ts `spawnTurbo`)

stdout used to be inherited and now goes into a `spawnSync` buffer that is
printed only after turbo exits. Two consequences, single-state runs included:

- If the run is interrupted (Ctrl-C, or a gate/driver kill on timeout), the
  runner dies with turbo, so none of the current state's captured log is
  printed. Before this change that log had already streamed.
- turbo's own stderr (`ERROR run failed: ...`, warnings) is still inherited and
  appears live, so it now comes before the state's task log instead of after it.
  In a captured FEEDBACK.md the error banner sits above the log it refers to.

Consider: stream stdout through (async spawn, tee into a buffer) and use the
buffer only to compute the signature and decide whether to print a duplicate. At
minimum, add a comment at `spawnTurbo` noting the interrupt loss.

## correctness: spawn error drops partial stdout (scripts/test-states.ts `spawnTurbo`)

Nit: `stdout: result.error ? "" : ...` discards `result.stdout` even when turbo
did run and was killed partway through (ENOBUFS past the 256 MiB cap, or a
signal). That partial log is exactly what explains the FAIL. Return
`result.stdout ?? ""` unconditionally. The test that spawns turbo against a bad
PATH still sees `""`, because nothing was written.

## correctness: dedupe relies on turbo's `<task>: ` prefix with no live check (mock/live drift)

`failureSignature` keeps only lines that start with `<task>: `. That matches
turbo 2.10.9's stream UI in this single-package repo; I checked it by hand
against a scratch turbo project. Every runner test, though, feeds hand-written
strings to a stubbed `RunTasks`, and the only shim turbo test prints unprefixed
output. If a turbo upgrade or a `ui` change alters the prefix (for example to
`//#test:unit: ` or a package-scoped form), every signature becomes `""`. The
runner then prints every failure in full again, which silently undoes follow-up
(b) of #372 while every test stays green. Add one test that runs the real turbo
on a tiny failing task (as `spawnTurbo against a shim turbo` already spawns a
process) and asserts that `failureSignature` of that output is non-empty and
equal across two runs.

## correctness: collapse rarely fires when more than one test fails (FYI)

FYI: `tests/vitest.reporter.ts` writes failures in `onTestCaseResult` completion
order, and that order varies across parallel files. Two flag states with the
same 2+ failures therefore usually get different signatures and both print in
full. This errs toward "distinct", as the comment intends, so nothing is hidden
wrongly. But the 1187-line case from #372 only shrinks when exactly one test is
red. Sorting the FAIL blocks inside a task's lines (or having the reporter sort
by `fullName`) would make the collapse work for that case too.

## ponytail-review: per-line array copy in `failureSignature` (scripts/test-states.ts)

Nice to have. `byTask.set(task, [...(byTask.get(task) ?? []), norm])` copies the
task's whole line list on every line, so the work grows with the square of a
task's log length. The 1187-line log from #372 costs nothing, but a red
`test:e2e:*` run with tens of thousands of lines (the buffer allows 256 MiB)
spends seconds here per failing state, after turbo already finished. Fix, one
line and shorter: get-or-create the array once and `push(norm)` into it. Assumed
load: one developer or one CI job running `npm test`; nothing else in the change
crosses it. Verdict from this lens: ship once the earlier correctness chunks are
settled; nothing here blocks.

## test-audit: "logs one pass line per state, never stdout" pins the `--output-logs=full` gap (tests/tooling/test-states.test.ts)

This test asserts that a passing state's stdout is never printed in the
multi-state path. `docs/development.md` promises that
`npm test -- --output-logs=full` restores full logs, and that is exactly the
case where pass logs should print. So the test pins the bug from the first
correctness chunk instead of guarding the documented contract. `runStates` never
sees the forwarded args, so no test can tell a full-logs run apart. When the fix
lands, give `runStates` the flag (or a "show all" switch) and add the missing
case: with full logs, pass stdout prints and a repeated failure is not
collapsed. Keep this test for the default path only.

## test-audit: repo-config test asserts the same data twice (tests/tooling/package-exports.test.ts)

Nit.
`for (const name of declared) expect(config.workflowNamed(name)?.def.initial).toBeDefined()`
runs right after `workflowNames` was found equal to `declared`. Both read the
same loaded map, and every built workflow has an `initial`, so the loop cannot
fail unless `workflowNames` and `workflowNamed` disagree, and nothing in the
change touches either. Drop the loop, or replace it with an assertion that would
catch a credible regression (e.g. `workflowNamed(name)?.name === name`). The
regex derivation is fine for #372 (a). It is coupled to the
`export const x = f(` shape, and the comment says so.
