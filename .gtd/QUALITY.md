## correctness: each state reports only its first failing task, so the comparison covers less than it claims

`turboArgv` passes no `--continue`. So turbo stops at the first failed task and
kills the tasks still running. Its `Failed:` line then names just that one task.
I checked this against real turbo 2.10.9 in a scratch package where `typecheck`
and a vitest `test:unit` both fail. With `--continue` the line read
`Failed: //#test:unit, //#typecheck`. Without it, it read
`Failed: //#typecheck`, and `failuresOf` returned only `typecheck => []`.

This matters in two ways:

- Say a later state hits the same fast shared failure as `defaults` (for example
  `format:check` or `lint`), and it also has a flag-only failure in a slow
  vitest task. Turbo kills that vitest task. `condenseFailure` then logs
  `same failures as defaults`, which claims sameness for failures that never
  ran. Before this change the state printed `FAIL` and its full output, with no
  claim of sameness.
- Every `runStates condensing` test builds its fixture with `turboOut`, which
  writes one `Failed:` line listing every task given to it. The multi-task cases
  ("prints only the differing task's output", the `typecheck` plus `test:unit`
  mix) depend on a shape real `npm test` never produces. That is mock/live
  drift: no test feeds `failuresOf` real turbo output.

Fix: add `--continue` to the turbo argv when condensing, so every failing task
finishes and is listed. The alternative is to treat a state as "same" only when
its set of failed tasks equals the earlier state's. Pin the `Failed:` line
format with one test that runs a shim or a real turbo, not a hand-built string.

## correctness: failures with no test names always compare as equal

`sameTests` compares only the vitest `FAIL` names. Some tasks have no such
lines:

- `format:check`, `typecheck`, `lint`, `lint:sh`, `lint:boundaries` and
  `analyze`, whose errors are plain text
- a vitest run that fails through an "Unhandled Errors" block, a worker crash or
  a timeout outside a test

For all of these, `failuresOf` maps the task to `[]`. So two states whose errors
in the same task are different still compare equal (`[] === []`), and the later
state gets `same failures as <earlier>`. Its own errors are never printed.

This contradicts the doc line "prints … only its own differing failing tasks'
output". The case that hits it in practice is a flag-only unhandled rejection in
a vitest task whose earlier state also failed without `FAIL` lines. The test
"treats the same task with different failing tests as different" covers only
named failures.

Fix: never let an empty name list count as a match. Either treat `[]` as
"unknown, always differing", or compare a normalised copy of the task's own
lines in that case. Add a test with two different `typecheck:` error bodies and
assert that the second is printed.

## correctness (Nit): chunk-wise `toString()` can split multibyte characters

In `spawnTurbo`, `output += chunk.toString()` decodes each pipe chunk on its
own. Vitest's output is full of multibyte characters (`×`, `❯`, `⎯`). When a
chunk boundary falls inside one, both halves decode to U+FFFD. If that lands in
a `FAIL` line, the test name no longer matches the earlier state's (reported as
different when it is not). If it lands in printed output, the character is
garbled. Fix: call `child.stdout.setEncoding("utf8")` and the same on stderr, or
collect the Buffers and decode once on `close`. The live sink can keep writing
the raw chunk.

## correctness (Consider): the flag-off path changes too

With `condense_failures` off, `spawnTurbo` still pipes turbo's stdout and stderr
instead of inheriting them, and still collects the whole run into a string that
is never read. Turbo and its child tools now see a non-TTY. That changes their
colour detection and how stdout and stderr interleave, and holds the full log of
a long run in memory. So the release flag does not keep the old behaviour when
it is off. Consider keeping `stdio: "inherit"` and skipping the capture whenever
the caller will not use the output (no condense), and piping only under the
flag.
