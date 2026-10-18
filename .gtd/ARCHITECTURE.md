## Interfaces

Concern 1 — the expected startable set comes from `gtd.config.ts` itself:

```ts
// tests/tooling/package-exports.test.ts, "this repository's config"
// Expected = every `export const <name> = <call>(` in gtd.config.ts, sorted.
// `config` (an object literal) and the re-exported helpers never match.
// A workflow exported another way (arrow function, `export { x } from`) is
// missed and reds the test with a diff naming it — loud, never silent.
const declared = [
  ...readFileSync(join(root, "gtd.config.ts"), "utf8").matchAll(
    /^export const (\w+) = \w+\(/gm,
  ),
]
  .map((m) => m[1]!)
  .sort()
expect(config.workflowNames).toEqual(declared)
expect(config.defaultWorkflow.name).toBe("feature")
for (const name of declared)
  expect(config.workflowNamed(name)?.def.initial).toBeDefined()
```

Concern 2 — `scripts/test-states.ts`, changed exports:

```ts
/** One turbo run: its exit status and its captured stdout. stderr stays inherited. */
export interface TurboRun {
  readonly code: number | null
  readonly stdout: string
}

// was: (tasks, env) => number | null
export type RunTasks = (tasks: readonly string[], env: Env) => TurboRun

/**
 * Comparable fingerprint of a failing run. Keeps only lines prefixed
 * `<task>: ` for a task in `tasks` (turbo's banner and Tasks:/Cached:/Time:
 * summary drop out — their counts differ between the 11-task defaults run and
 * a 5-task flag run). Groups lines per task, tasks sorted, original order
 * within a task (parallel tasks interleave nondeterministically). Strips ANSI
 * escapes, durations (`\d+(\.\d+)?\s?(ms|s|m|h)\b`), clock times
 * (`\d{1,2}:\d{2}:\d{2}`), ISO timestamps, and hex runs of 12+ chars (turbo
 * cache hashes, git shas). "" when no task-prefixed line exists.
 */
export function failureSignature(
  stdout: string,
  tasks: readonly string[],
): string

/**
 * Signature unchanged. Per state, in order:
 * - pass → `test-states: <label> — pass`, its stdout never printed
 * - FAIL, non-empty signature equal to an earlier failing state's →
 *   `test-states: <label> — FAIL (same failure as <earlier label>)` only
 * - FAIL otherwise → its stdout in full, then `test-states: <label> — FAIL`
 * An empty signature never matches: two unexplained failures both print.
 * Exit: 1 when any state fails (null code = FAIL), else 0.
 * One state only: print its stdout, return its code verbatim (null → 1).
 */
export function runStates(
  states: readonly TestState[],
  run: RunTasks,
  log: (line: string) => void,
): number

/**
 * Appends `--output-logs=errors-only` unless `args` already holds
 * `--output-logs` or `--output-logs=<v>` — turbo 2.10.9 refuses the option
 * twice ("cannot be used multiple times"), so `npm test -- --output-logs=full`
 * must replace the default, not add to it.
 */
export const turboArgv: (
  tasks: readonly string[],
  args: readonly string[],
) => string[]

/**
 * spawnSync with stdio ["inherit", "pipe", "inherit"] and maxBuffer 256 MiB —
 * the 1 MiB default kills turbo on a long failure log (ENOBUFS, status null),
 * which would read as FAIL. Spawn error → { code: null, stdout: "" } plus the
 * existing `test-states: cannot run turbo:` line on stderr.
 */
export const spawnTurbo: (
  tasks: readonly string[],
  env: Env,
  args?: readonly string[],
) => TurboRun
```

`scripts/test-states.main.ts` is unchanged: it already passes `spawnTurbo` and
`console.log`.

## Call Stacks

Concern 1:

- `npm run test:unit` → vitest → `tests/tooling/package-exports.test.ts`
- test → `ConfigService.load` (existing layers) → `gtd.config.ts` via jiti
- test → `readFileSync(gtd.config.ts)` → declared names → compare with
  `workflowNames`, then `workflowNamed(name)` per name

Concern 2:

- `npm test` → `jiti scripts/test-states.main.ts`
- main → `planStates(FLAGS, process.env)` (unchanged)
- main → `runStates(states, spawnTurbo, console.log)`
- `runStates` → `spawnTurbo` → `turboArgv` →
  `turbo run <tasks> --output-logs=errors-only …` (stdout piped, stderr
  inherited)
- `runStates` → `failureSignature(stdout, state.tasks)` → compare with earlier
  failing states → `log`

## E2E Scenarios

No e2e change. The `npm test` runner and the repo-config test are this
repository's own tooling, not gtd behaviour; `tests/tooling/` unit tests,
including a real spawn against a shim `turbo`, cover them.

## Unit Tests

### Repo-config startable set

- unit: tests/tooling/package-exports.test.ts — `workflowNames` equals the
  sorted `export const <name> = <call>(` names read from `gtd.config.ts`, so
  adding or removing a workflow export needs no test edit (covers 1)
- unit: tests/tooling/package-exports.test.ts — config loads, default workflow
  is `feature`, every declared name resolves via `workflowNamed` with a defined
  initial step (covers 1)

### TurboRun / RunTasks

- unit: tests/tooling/test-states.test.ts — existing `runStates` stubs return
  `{ code, stdout }`; every existing ordering, env and null-is-FAIL assertion
  still holds (covers 2)

### failureSignature

- unit: tests/tooling/test-states.test.ts — two outputs differing only in
  durations, clock times, ISO timestamps, 16-hex cache hashes and ANSI escapes
  give equal signatures (covers 2)
- unit: tests/tooling/test-states.test.ts — outputs differing in assertion text
  give different signatures (covers 2)
- unit: tests/tooling/test-states.test.ts — same `test:unit:` failure under a
  `Tasks: 10 successful, 11 total` summary and a `Tasks: 4 successful, 5 total`
  summary gives equal signatures (covers 2)
- unit: tests/tooling/test-states.test.ts — two failing tasks' lines interleaved
  in different orders give equal signatures (covers 2)
- unit: tests/tooling/test-states.test.ts — output with no `<task>: ` line gives
  "" (covers 2)

### runStates

- unit: tests/tooling/test-states.test.ts — a passing state logs only
  `test-states: <label> — pass`, never its stdout (covers 2)
- unit: tests/tooling/test-states.test.ts — the first failing state logs its
  stdout in full (test name, assertion, stack lines present), then
  `test-states: defaults — FAIL` (covers 2)
- unit: tests/tooling/test-states.test.ts — a later state failing with the same
  signature logs exactly
  `test-states: alpha on — FAIL (same failure as defaults)` and none of its
  stdout (covers 2)
- unit: tests/tooling/test-states.test.ts — a later state with a distinct
  failure logs its stdout in full; a third state matching the second names the
  second, not `defaults` (covers 2)
- unit: tests/tooling/test-states.test.ts — two failing states with empty
  signatures both print their stdout (covers 2)
- unit: tests/tooling/test-states.test.ts — exit 1 when any state fails
  (collapsed ones included), 0 when all pass (covers 2)
- unit: tests/tooling/test-states.test.ts — a single state logs its stdout and
  returns its code verbatim, null → 1 (covers 2)

### turboArgv

- unit: tests/tooling/test-states.test.ts — no `--output-logs` in args →
  `["run", "a", "b", "--force", "--output-logs=errors-only"]` (covers 2)
- unit: tests/tooling/test-states.test.ts — `--output-logs=full`, or
  `--output-logs full`, in args → no default appended, user value kept
  (covers 2)

### spawnTurbo

- unit: tests/tooling/test-states.test.ts — shim `turbo` receives forwarded args
  after the task names plus the default `--output-logs=errors-only`; result
  carries its exit code and stdout (covers 2)
- unit: tests/tooling/test-states.test.ts — shim printing 2 MiB to stdout and
  exiting 0 yields `code: 0` and the full 2 MiB captured (covers 2)
- unit: tests/tooling/test-states.test.ts — unspawnable turbo yields
  `{ code: null, stdout: "" }` and reports `cannot run turbo` (covers 2)

### Chores

- chore: docs/development.md — `npm test` paragraph: only failing tasks' logs
  print; a flag state failing like an earlier one prints one
  `same failure as <state>` line; `npm test -- --output-logs=full` restores full
  logs (covers 3)
- chore: README.md, docs/configuration.md, gtd user docs — unchanged; the check
  step's verbatim FEEDBACK contract is untouched (covers 3)

## Merged Concerns

### 2 + 3 — runner output and its docs

Concern 3 only documents concern 2's behaviour; shipped apart, the docs package
has no value of its own and the runner package leaves `docs/development.md`
stale. One package.

Concern 2, verbatim:

> ### 2. `npm test` prints only what failed (PRODUCT)
>
> A red suite today prints the full turbo output of every flag state; gtd's
> check step copies it verbatim into `.gtd/FEEDBACK.md`, and the #355 run
> produced 1187 lines, mostly the same failure repeated per state (issue #372
> follow-up b).
>
> - **Scope: this repo's `npm test` runner only** (`scripts/test-states.ts`).
>   gtd's check step and its "verbatim" `.gtd/FEEDBACK.md` contract stay
>   unchanged
> - **Passing tasks' logs are hidden always** — terminal and redirected output
>   alike; a run shows each state's `pass`/`FAIL` line plus failing tasks' logs
> - **A flag state failing the same way as an earlier state prints one line**
>   naming that earlier state (e.g. "same failure as `defaults`") instead of the
>   log again
> - "Same" means the same failing tasks with the same failure text after
>   stripping durations, timestamps and cache hashes — never byte-identical
> - **The first occurrence of each distinct failure prints in full** (test name,
>   assertion, stack); condensing never drops it
> - Exit code unchanged: any failing state still exits 1
> - **Risk: other repos with noisy suites keep the oversized-FEEDBACK problem**
>   — accepted by the scope choice
> - **Risk: an oversized report still blinds the retry judge elsewhere** —
>   evidence over `judgeBudgetBytes` (32768) is truncated, and truncated
>   evidence is never ruled "identical"; this fix only shrinks this repo's
>   report under that bar
> - Unit tests in `tests/tooling/test-states.test.ts` pin the condensed shape;
>   `npm test` green

Concern 3, verbatim:

> ### 3. Docs follow the change
>
> - `docs/development.md`'s `npm test` paragraph states that only failing tasks'
>   logs print and repeated failures across flag states collapse to one line
> - No change to `README.md`, `docs/configuration.md`, or any gtd user-facing
>   doc — the check step's contract is untouched

## Answered Questions

### Do the three deferred review notes (836985b, daed27f, eda53bb) get built?

No. The human deleted all three from `.gtd/TODO.md` in the entry commit,
replacing them with the #372 directive — that removal is the decision.

### Does a later flag state's failure count as "the same" only when byte-identical?

No — the same failing tasks with the same failure text after stripping
durations, timestamps and cache hashes counts as the same; byte-identical never
matches across runs because vitest/turbo timings differ every run.

### Where does the feedback condensing live?

This repo's `npm test` runner only. gtd's check step keeps copying test output
into `.gtd/FEEDBACK.md` verbatim; no size cap, no user-facing contract change.

### Does `npm test` hide passing tasks' logs always, or only when its output is captured?

Always — one behaviour in a terminal and under gtd's redirected check alike.

### Can a developer still see full logs locally?

Yes: `npm test -- --output-logs=full`. The runner appends its
`--output-logs=errors-only` default only when the args hold no `--output-logs`,
because turbo 2.10.9 rejects the option given twice.

### How does the config test derive the expected workflow list?

From `gtd.config.ts`'s source: every `export const <name> = <call>(`. Importing
the config in vitest is out — no alias resolves `@pmelab/gtd/workflows` to
source, and the export-name filter would duplicate the loader's private
reserved-name set. A workflow exported in another shape reds the test with a
diff naming it, the safe direction.

### How are passing logs hidden — turbo flag or runner filtering?

Turbo's own `--output-logs=errors-only`, set by the runner. Not in `turbo.json`:
that would also change direct `npx turbo run` use, outside the settled scope.

### Does the runner compare whole-state output or per-task output?

Whole-state signature built from failing tasks' prefixed lines only, per the
settled definition "same failing tasks with the same failure text". Defaults
failing `lint` plus `test:unit` and a flag state failing `test:unit` alone are
different and both print.

### Which way may normalisation err?

Toward "distinct". A random temp path in a failure keeps two states apart and
prints both — safe. **Risk: an assertion differing only in a duration-shaped
number (`expected 200ms, got 100ms`) collapses as "same"** — accepted, rare; the
earlier state's full log still prints.

### Does buffering stdout cost live progress?

Yes, a state prints nothing until it ends. **Risk: a multi-minute state is
silent in a terminal** — accepted: under `errors-only` turbo shows only its
banner before a task ends anyway, and stderr stays live.

### Does a single-state run (no release flags) change?

Barely: it still logs no pass/FAIL line and returns its code verbatim; it now
prints its captured stdout (already errors-only) instead of inheriting it.
