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

## ponytail-review: the new release flag buys a full extra vitest pass that tests nothing

`condense_failures` is declared `kind: "release"` in `src/flags/index.ts`.
`planStates` turns every release flag into its own state, so `npm test` now runs
a fourth state, `condense_failures on`, over all of `VITEST_TASKS`. Every vitest
task in `turbo.json` lists `GTD_FLAG_*` in its `env`, so that state has its own
cache key and runs in full on every gate and in CI.

But nothing under `src/`, `claude/` or `tests/` reads the flag. The only reader
is `scripts/test-states.main.ts`, the runner itself, which takes it from the
ambient env, not from the state's env. So the `condense_failures on` state runs
the same product code as `defaults` and can only repeat its result. Concrete
case: a clean tree with three states took three vitest passes; now it takes
four, about a third more wall time per gate, for zero extra coverage. AGENTS.md
already says "each release flag adds a full vitest pass to every gate".

Fix: do not model a runner option as a product release flag. Read a plain env
var (or a CLI option to the runner) in `test-states.main.ts`, drop the `FLAGS`
entry and the `condense_failures flag` test that only asserts the state exists.
If it must stay a flag, give it a kind that `planStates` skips.

## ponytail-review (Nit): `RunTasks` widened to a four-way union only for old fakes

`RunTasks` now returns `number | null | RunResult | Promise<…>`, and `asResult`
exists only to fold the bare-status forms back into `RunResult`. The one real
implementation, `spawnTurbo`, always returns `Promise<RunResult>`. The bare
forms survive only so older test fakes can keep returning `0`/`1`. Fix: make
`RunTasks` return `Promise<RunResult>` (or `RunResult | Promise<RunResult>`),
have the fakes return `{ status, output: "" }`, and delete `asResult` and its
doc comment. About -8 lines, and one less shape to reason about.
