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

## test-audit: the flag-off default path and live streaming have no test that fails when they break

With `condense_failures` off (the default), every state must still stream live.
That rests on two lines: `!condense || i === 0` in `runStates` and
`if (live) sink.write(chunk)` in `spawnTurbo`. No test fails if either goes:

- The `stub` helper drops its third argument (`(tasks, env) => …`). So none of
  the non-condensing `runStates` tests sees `live`. Change the expression to
  `i === 0` and every later state's output gets captured and dropped without a
  word, on the path everyone runs by default. The whole suite stays green. Only
  "runs every state and returns 1 when any failed" asserts `live`, and only with
  condense on.
- The one shim test passes `live = false` and checks capture only. Delete the
  sink write and the first state, plus every state when the flag is off, goes
  silent with no test failing. Stderr capture is never checked either, though
  the repo's vitest reporter writes every `FAIL` line to stderr.

Fix: have `stub` record `live` and assert `[true, true]` for a run without
condense. Give the shim a stderr line too, run it with `live = true`, and assert
that the bytes reach the sinks as well as `output`.

## test-audit: the fixtures model vitest's default reporter, not the one this repo uses

`vitest.config.ts` sets `reporters: ["./tests/vitest.reporter.ts"]`. That
reporter writes `\nFAIL ${test.fullName}\n` to stderr: just the describe path
and test name, with no file, no double space and no `[ 3ms ]`. The `failuresOf`
and condensing fixtures (`" FAIL  a.test.ts > one [ 3ms ]"`) copy the default
reporter's layout, which `npm test` never prints. The duration-stripping branch
passes only against output that never happens, and nothing exercises the real
line shape. I checked that turbo 2.10.9's `task: ` log prefix matches the
fixture. The reporter line is what drifts.

Two effects the fixtures hide:

- `fullName` has no file in it, so two failing tests with the same describe and
  test name in different files collapse into one entry under `new Set(names)`. A
  state that fails both then compares equal to a state that fails only one.
- The reporter writes nothing for a file that fails to load (that is not a test
  case), so those vitest failures always land in the `[]` case covered above.

Fix: build the vitest lines in the fixture from the reporter's own format, or
better, take them from one run of the real reporter. Drop the `[ … ]` case
unless some real reporter emits it.

## test-audit: matches spread over several earlier states are never exercised

Every condensing fixture is matched only against `defaults`. The `covering`
accumulation and the per-task removal from `novel` across several `seen` entries
never run with more than one useful entry. Two broken versions stay green: one
that compares only against `seen[0]`, and one that stops at the first earlier
state with any hit. Missing case: `defaults` fails task A, `alpha on` fails task
B, and `beta on` fails A and B. That should log
`same failures as defaults, alpha on` and print nothing.

## test-audit (Nit): test name does not match what it checks

"prints a pass line only for a later passing state" says nothing about what it
actually proves: a passing middle state is not added to `seen`, and the third
state is still matched against `defaults`. The pass line prints no matter what.
Rename it, e.g. "a passing state in between does not break matching against
defaults".

## test-audit (Nit): the longest-first sort in `taskOf` guards nothing and has no test

The comment says `test:e2e:inmem` must beat a `test:e2e` prefix. But matching
uses `${t}: `, and task names contain no `": "`, so no task's prefix can also be
a prefix of another task's. Sort order cannot change the result, so no test
could pin it, and `TASKS` has no `test:e2e` anyway. Delete the sort and the
comment instead of adding a test.

## conventions: `condense_failures` is not a feature flag by the glossary's definition

AGENTS.md: "`CONTEXT.md` ... the domain language this repo uses ... Read it
before naming anything". CONTEXT.md defines **Feature flag** as "a flag gtd
knows ... Distinct from a process or environment setting", and **Release flag**
as a feature flag with `kind: "release"`, whose life is rollout then cleanup
"keeping its flag-on path". `condense_failures` is neither. gtd itself never
reads it. Only the test runner `scripts/test-states.main.ts` reads it, as a
setting for how `npm test` prints output. Registering it in `FLAGS` with
`kind: "release"` therefore:

- names a runner setting with a term that means something else in this repo
- puts it into the flag registry, which `rollout`/`cleanup` and the `GTD_FLAG_*`
  docs in `docs/configuration.md` treat as gtd product flags
- runs into AGENTS.md's own "each release flag adds a full vitest pass to every
  gate". The cost side is in the ponytail finding above.

SDLC.md also says to mark each flag branch with a literal `GTD_FLAG_<NAME>`
comment so cleanup can find it. The read in `test-states.main.ts`
(`resolveFlags(process.env).condense_failures`) has no such marker.

Fix: make it a plain runner option, for example a `--condense` argument that
`test-states.main.ts` consumes, or a non-`GTD_FLAG_` env var. Drop the `FLAGS`
entry and reword the `docs/development.md` paragraph to match.

## conventions: the widened `RunTasks` port has no contract test

AGENTS.md: "reach every external resource (git, a shell, ... a spawned program)
through a port with a live and an in-memory implementation, and hold the two
together with a contract test that runs the same cases against both."

This change grows the turbo port. `RunTasks` now returns captured `output` and
takes a `live` switch, and `failuresOf` parses that output. The live side is
`spawnTurbo`. The in-memory side is a set of one-off fakes (`stub`, `feed`,
`turboOut`) that never run the same cases as `spawnTurbo`. The single shim test
checks argv plus one `echo`. The correctness and test-audit findings above found
exactly the drift a contract test would catch: the `Failed:` line lists one task
without `--continue`, and the repo reporter's `FAIL` line has a different shape.

Fix: write one case table, covering a failing run's `Failed:` line, `FAIL` lines
on stderr, and live versus captured output. Run it against a shim (or real)
turbo through `spawnTurbo` and against the in-memory fake, and assert that
`failuresOf` gives the same result for both.

## conventions (Nit): comments that only restate the code

AGENTS.md: "Keep a comment ... only where it explains an important decision or
genuinely unclear code ... Everything else (restatement of the code, history, a
'what' with no 'why') gets deleted". These in `scripts/test-states.ts` say what
the code does and give no reason:

- `/** Stream the state's output to the terminal as it runs; otherwise it is only captured. */`
  on the `live` parameter
- `/** Receives the captured output a later failing state adds beyond what was already shown. */`
  on `Condense.print`
- `/** Print only what an earlier failing state has not already shown. */` on
  `condenseFailure`
- `/** Failed task -> sorted failing test names, read from turbo's ... */` on
  `failuresOf`. Its return type and body already say this.
- `// Longest first: ...` on `taskOf`. It guards nothing (see test-audit).

Keep
`// Always captured: a live state's failures are what later states are compared against.`,
because it gives a reason. Keep `/** A bare status carries no output ... */`
only while `asResult` exists.

## spec-challenge: shipping a runner change "behind a release flag" breaks the flag invariants the spec never addressed

REQUIREMENTS.md concern 1 says `npm test` stops repeating a failure, and that it
is done when one test red in all three states gives one state's output. It does
not say how a change to the test runner fits SDLC.md's "Work merges to `main`
behind a release flag". The build settled that by adding `condense_failures` to
`FLAGS` with `kind: "release"`. That choice conflicts with invariants other code
and docs rely on:

- **The cleanup guard misses this flag's read.** SDLC.md says to branch on the
  pinned `flag_<name>` setting and to mark the branch with a literal
  `GTD_FLAG_<NAME>`, because "the cleanup refusal sees only the literal". The
  `cleanup` flow only scans `src/**/*.ts(x)` for that literal. The flag's one
  reader is `scripts/test-states.main.ts`
  (`resolveFlags(process.env).condense_failures`), which is outside `src/` and
  has no marker. So `gtd cleanup --var flag=condense_failures` passes its guard
  and lands. Then `typecheck` goes red, because tsconfig includes `scripts` and
  `Flags<typeof FLAGS>` rejects a name that was removed. The stale
  `GTD_FLAG_CONDENSE_FAILURES` paragraph in `docs/development.md` also survives.
- **The read is not at a composition point, and nothing pins it at process
  start.** SDLC.md says a flag is read "only at the composition point" and
  "pinned at process start". The runner reads the ambient env directly. It does
  not use the per-state env that `planStates` builds. That is why the
  `condense_failures on` state differs from `defaults` only in a variable that
  nobody reads.
- **`planStates` gives every release flag its own state.** AGENTS.md: "each
  release flag adds a full vitest pass to every gate". The spec's done-when
  names exactly three states (defaults, `naive_pass` on, `risk_tier` on), so it
  assumed no new flag state. Now there are four. (The cost is in the ponytail
  finding.)
- **With the flag off by default, the done-when is not met by what the gates
  run.** `start-gate`, `review-gate` and the health check run plain `npm test`
  without `GTD_FLAG_CONDENSE_FAILURES`. So the repeated output that #372(b)
  complained about still appears until a `rollout`. The closing comment the spec
  plans for #372 ("(b) is done") would then be wrong.

Fix: amend the spec to say that a tooling-only change in `scripts/` is not
product work and needs no release flag (it ships no gtd behaviour to users).
Then make condensing either the runner's unconditional behaviour or a plain
runner option (a `--condense` arg or a non-`GTD_FLAG_` env var) that `npm test`
turns on. Drop the `FLAGS` entry. If a flag must stay, the spec has to say how
cleanup reaches `scripts/` and how the gates run with it on.

## spec-challenge: the spec's "same failures" test cannot be computed from what `npm test` emits

The spec defines a match as "same failing tasks and same failing test names".
Two existing facts make that unanswerable as written:

- `turboArgv` (pinned by `turboArgv puts forwarded args after the task names` to
  `["run", ...tasks, ...args]`) passes no `--continue`. Turbo stops at the first
  failed task, so the "failing tasks" set holds only one task.
- The repo's own reporter (`tests/vitest.reporter.ts`, set in
  `vitest.config.ts`) prints `FAIL <fullName>` with no file. Non-vitest tasks
  print no test names at all.

So the spec's equality is under-specified for most failures, which come out as
empty name lists or truncated task sets. The build resolved that silently, as
"equal". See the correctness findings above for what that does.

Fix: amend the spec to say that condensing runs turbo with `--continue`, which
changes the argv invariant and its test on purpose. It should also define the
match for a task with no test names (never equal, or equal only on matching
normalised output) instead of leaving it to the implementation.
