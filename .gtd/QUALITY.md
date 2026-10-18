## correctness: a failed task with no attributed lines still compares equal

`failuresOf` falls back to a task's own lines when it has no `FAIL` names. Its
doc comment says this means "an empty list never makes two failures look equal".
That holds only when turbo prefixes every line with `<task>: `.

When no line gets attributed to a failed task, the task maps to `[]`, and
`sameTests([], [])` returns true. So a later state is logged as
`same failures as defaults` and its output is never printed. There are two ways
to get there:

- Forwarded turbo options, which `npm test -- <args>` passes through by design.
  With `--log-prefix=none` no line carries a prefix. With `--output-logs=none`
  or `errors-only` the task lines are reduced or gone. In either case, every
  later failing state is reported as the same as the first failing one, even
  when its failing tests differ completely.
- A failed task that is not in `state.tasks`. An example is `build`, which every
  vitest task depends on (`dependsOn: ["build"]`). It shows up in `Failed:`, but
  `taskOf` cannot attribute any of its lines. Today this is harmless only
  because `build` does not vary by flag. If such a task is ever "novel", the
  print path filters on `state.tasks`, so it prints nothing for it.

No test covers an empty entry: every fixture prefixes its lines.

Fix: treat an empty list as never equal. In `sameTests`, require `b.length > 0`,
or skip a task whose entry is empty. When a novel task has no lines of its own,
print the full output. Add a `runStates condensing` case where two states differ
but neither has prefixed lines (for example, only a `Failed:` line). It must not
log `same failures`.

## correctness: comparing only FAIL names hides a flag-only suite or unhandled error

When a vitest task has at least one `FAIL` name, `failuresOf` keeps only the
names and drops all its other lines. The repo reporter
(`tests/vitest.reporter.ts`) prints nothing for a test file that fails to
import, and nothing for an unhandled error. I checked this in a scratch vitest
run with that reporter: a file importing a missing module, plus a test that
throws from a `setTimeout`, printed only the one ordinary `FAIL one` block, and
the run exited 1.

So suppose a later state shares the failing test `a > one` with `defaults` and
also has a flag-only collection error in `test:unit`. That state is condensed to
`same failures as defaults`. The flag-specific failure is hidden, which
contradicts "a flag-specific failure still shows in full". The root cause is in
the reporter, but it is the condensing that turns a missing line into a false
claim of sameness. Before this change, the full output at least showed vitest's
exit.

The fullName also leaves out the file. Two tests in different files with the
same `describe > it` path count as the same failure.

Consider either of these:

- Have the reporter print suite-level errors (`testModule.errors()`) and
  unhandled errors (the `onTestRunEnd` arguments) as `FAIL <file>` lines, with
  the file path in each name.
- Compare the vitest summary count (`N test(s) failed`) together with the names.

## correctness: stdout and stderr chunks are spliced into one buffer mid-line

`spawnTurbo` appends chunks from both pipes to one `output` string in arrival
order. Turbo writes its `<task>:  WARNING command finished with error` and
`ERROR command … exited` lines to stderr. It does so at the moment a task fails,
while other tasks are still streaming to stdout. Large output gets split at
pipe-buffer boundaries. When a stderr chunk lands between two stdout chunks that
split a line, it is spliced into that line. That corrupts a `FAIL` name or
attributes the line to the wrong task.

In most cases this makes two states differ, so the runner prints more than it
needs to, but the outcome is nondeterministic. The multibyte test guards
character boundaries but not line boundaries.

Fix: keep a separate buffer per stream and append only whole lines to `output`.
Flush any remainder on `close`.

## Nit: correctness — a later state with a subset of the earlier failures is called "same"

`condenseFailure` checks only that each task failing in this state matches some
earlier state. It does not check that the sets of failing tasks are equal. The
requirement says "same failing tasks and same failing test names".

The subset case is unavoidable. Later states run only `VITEST_TASKS`, so the
`defaults` failures in `typecheck` or `lint` can never recur there. The log line
still says `same failures as` when the earlier state failed more. Consider the
wording `failures already seen in <state>`.

## ponytail-review: the line-list fallback can never match in a later state

`failuresOf` keeps a failed task's own lines when it prints no `FAIL` name, and
`sameTests` compares those lists. Later states run only `VITEST_TASKS`. Those
tasks declare `env: ["GTD_FLAG_*"]` in `turbo.json`, so their hash differs per
state. Turbo prints that hash as a prefixed task line:

    test:workflows: cache miss, executing b6d1ca9560161376

(seen in a real `turbo run` here). So a vitest task with no `FAIL` names never
equals its entry in an earlier state. The line fallback only ever means "always
different". The test
`prints a failure with no test names when it differs from the earlier one`
passes only because its fixture has no hash line. Real output would print
`beta on`'s lines, not log `same failures as defaults`. That test pins behaviour
the runner cannot show.

Fix: drop the line fallback. Map a task to its sorted `FAIL` names, and treat a
task with none as always novel. This deletes `entry.lines` and its branch. It
also closes the first correctness chunk's empty-list case in the same edit.
Change that test to expect the TS2 lines printed for `alpha on`, and the TS1
lines printed for `beta on` too.

## ponytail-review: `condense` is optional, but only tests take the other path

`test-states.main.ts` always passes `{ print }`. The `condense?` parameter,
`!condense || i === 0`, `|| !condense`, and the test
`streams every state live when not condensing` exist only for callers that do
not exist. Make `print` a required parameter and delete the non-condensing
branch. The older `runStates` tests then pass a no-op `print`. About -5 lines,
one fewer mode to reason about.

## test-audit: the reporter-to-parser contract is pinned with a copied string

`failuresOf` depends on the format of `tests/vitest.reporter.ts`. The tests
never run that reporter. They use `REPORTER_FAIL`, a hand-copied
`\nFAIL ${name}\n`. If the reporter's format changes, every test stays green.

The copy also hides a real mismatch. The reporter writes each error message as
`  ${err.message}`, and the parser's regex `^\s*FAIL\s+` accepts leading
whitespace. So an assertion message that starts with `FAIL` is counted as a test
name. A multi-line message has the same problem with any of its lines.

Fix: build the expected text with the real reporter. Construct `SilentReporter`,
feed `onTestCaseResult` a failed test case stub (`fullName`, `result()`), call
`onTestRunEnd` with `process.stderr.write` captured, prefix each line with
`test:unit: `, and parse the result with `failuresOf`. Include an error message
that starts with `FAIL`. Then delete `REPORTER_FAIL`. Either anchor the regex to
an unindented `FAIL` or make the reporter's format unambiguous.

## test-audit: the "live port and in-memory" contract test duplicates other proof and misses the stream risk

`parses the same through spawnTurbo and the in-memory output` is not a contract
test between two port implementations. Its in-memory side calls `failuresOf` on
the same string that the shim prints, so that half restates the `failuresOf`
unit tests. Its live side writes one heredoc to stderr only. That proves only
that `spawnTurbo` captures stderr losslessly, which
`captures both streams, and streams them only when live` already proves. The
fakes that the `runStates` tests use (`stub`, `feed`) are never checked against
`spawnTurbo` at all.

The one transport risk that `spawnTurbo` really has goes untested. That risk is
stdout and stderr chunks interleaving mid-line, described in the correctness
chunk above. Its second case (`a failed plain-text task keeps its own lines`)
also pins the line fallback that the ponytail chunk proposes to drop.

Fix: replace the test with a shim that writes a partial stdout line, then a
whole stderr line, then the rest of the stdout line. For example, use
`printf 'test:unit: FA'; echo 'typecheck: x' >&2; sleep 0.1; printf 'IL a > one\n'`.
Assert that `failuresOf` still returns `a > one`. The test fails today, and it
becomes the regression test for the stream-splice fix. Then drop the duplicated
cases.

## test-audit: condensing fixtures describe states the planner never produces

The `runStates condensing` fixtures give every state the tasks
`["typecheck", "test:unit"]`. The flag-specific case,
`prints only the differing task's output for a flag-specific failure`, puts its
novel failure in `typecheck`. A real later state runs only `VITEST_TASKS`, so it
can never fail `typecheck`. `turboOut` also leaves out the per-state
`<task>: cache miss, executing <hash>` line that real turbo prints. The ponytail
chunk shows this omission is the only reason the line-fallback test passes.

So the suite proves condensing against output shapes that cannot happen, and it
skips the ones that do: a `defaults` failure in `typecheck`/`lint` that is
absent later (the subset case in the nit above), and hash lines that differ per
state.

Fix: build the fixture states with
`planStates([flag("alpha"), flag("beta")], {})`. Have `turboOut` emit a hash
line per task that differs per state. Move the flag-specific novel failure into
a second vitest task, for example `test:workflows`.

## conventions: live streaming reaches the terminal outside the port

AGENTS.md: "reach every external resource (git, a shell, a file outside the
repository, the network, a spawned program) through a port with a live and an
in-memory implementation, and hold the two together with a contract test that
runs the same cases against both."

`runStates` gets its output sink injected (`condense.print`), but `spawnTurbo`
writes a live state straight to `process.stdout`/`process.stderr` and decides
`--color` from `process.stdout.isTTY`. So the terminal is reached two ways: one
injected, one global. The tests pay for it. `passes --color=…` redefines
`process.stdout.isTTY` with `Object.defineProperty`, and
`captures both streams, and streams them only when live` spies on
`process.stdout.write` and `process.stderr.write` (global mutation inside a
parallel vitest worker). `returns null and reports…` swaps `console.error` by
hand for the same reason.

The "contract test"
(`parses the same through spawnTurbo and the in-memory output`) does not meet
the rule's bar either: it never runs the `stub`/`feed` fakes that `runStates`
tests use. See the test-audit chunk above.

Fix: pass the sinks and the TTY bit into `spawnTurbo` (for example
`{ out, err, tty }`, defaulting to `process.*` only in `test-states.main.ts`),
the same way `print` is passed to `runStates`. The tests then pass recording
sinks and drop the `defineProperty`/`spyOn` patching.
