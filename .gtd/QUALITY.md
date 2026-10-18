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
