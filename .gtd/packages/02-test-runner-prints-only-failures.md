# 02 — `npm test` prints only what failed (+ docs)

## Requirements

### 2. `npm test` prints only what failed (PRODUCT)

A red suite today prints the full turbo output of every flag state; gtd's check
step copies it verbatim into `.gtd/FEEDBACK.md`, and the #355 run produced 1187
lines, mostly the same failure repeated per state (issue #372 follow-up b).

- **Scope: this repo's `npm test` runner only** (`scripts/test-states.ts`).
  gtd's check step and its "verbatim" `.gtd/FEEDBACK.md` contract stay unchanged
- **Passing tasks' logs are hidden always** — terminal and redirected output
  alike; a run shows each state's `pass`/`FAIL` line plus failing tasks' logs
- **A flag state failing the same way as an earlier state prints one line**
  naming that earlier state (e.g. "same failure as `defaults`") instead of the
  log again
- "Same" means the same failing tasks with the same failure text after stripping
  durations, timestamps and cache hashes — never byte-identical
- **The first occurrence of each distinct failure prints in full** (test name,
  assertion, stack); condensing never drops it
- Exit code unchanged: any failing state still exits 1
- **Risk: other repos with noisy suites keep the oversized-FEEDBACK problem** —
  accepted by the scope choice
- **Risk: an oversized report still blinds the retry judge elsewhere** —
  evidence over `judgeBudgetBytes` (32768) is truncated, and truncated evidence
  is never ruled "identical"; this fix only shrinks this repo's report under
  that bar
- Unit tests in `tests/tooling/test-states.test.ts` pin the condensed shape;
  `npm test` green

### 3. Docs follow the change

- `docs/development.md`'s `npm test` paragraph states that only failing tasks'
  logs print and repeated failures across flag states collapse to one line
- No change to `README.md`, `docs/configuration.md`, or any gtd user-facing doc
  — the check step's contract is untouched

Interfaces and call stack: `.gtd/ARCHITECTURE.md` › Interfaces › Concern 2.
`scripts/test-states.main.ts` stays unchanged.

## Tasks

### Task 1: `TurboRun` result type; `RunTasks` returns it

- [ ] `export interface TurboRun { readonly code: number | null; readonly stdout: string }`
      in `scripts/test-states.ts`
- [ ] `RunTasks` is `(tasks, env) => TurboRun` (was `number | null`)
- [ ] Existing `runStates` stubs return `{ code, stdout }`; every existing
      ordering, env and null-is-FAIL assertion still holds

Paths: `scripts/test-states.ts`, `tests/tooling/test-states.test.ts`

### Task 2: `failureSignature(stdout, tasks)`

- [ ] Keeps only lines prefixed `<task>: ` for a task in `tasks`; turbo banner
      and `Tasks:`/`Cached:`/`Time:` summary drop out
- [ ] Groups lines per task, tasks sorted, original order within a task
- [ ] Strips ANSI escapes, durations (`\d+(\.\d+)?\s?(ms|s|m|h)\b`), clock times
      (`\d{1,2}:\d{2}:\d{2}`), ISO timestamps, hex runs of 12+ chars
- [ ] Outputs differing only in durations, clock times, ISO timestamps, 16-hex
      cache hashes and ANSI escapes → equal signatures
- [ ] Outputs differing in assertion text → different signatures
- [ ] Same `test:unit:` failure under `Tasks: 10 successful, 11 total` and
      `Tasks: 4 successful, 5 total` → equal signatures
- [ ] Two failing tasks' lines interleaved in different orders → equal
- [ ] No `<task>: ` line → `""`
- [ ] Normalisation errs toward "distinct" (a random temp path keeps two states
      apart). **Risk: an assertion differing only in a duration-shaped number
      collapses as "same"** — accepted

Paths: `scripts/test-states.ts`, `tests/tooling/test-states.test.ts`

### Task 3: `runStates` condenses output

- [ ] Passing state logs only `test-states: <label> — pass`, never its stdout
- [ ] First failing state logs its stdout in full (test name, assertion, stack
      present), then `test-states: defaults — FAIL`
- [ ] Later state with the same non-empty signature logs exactly
      `test-states: alpha on — FAIL (same failure as defaults)`, none of its
      stdout
- [ ] Later distinct failure logs stdout in full; a third state matching the
      second names the second, not `defaults`
- [ ] Two failing states with empty signatures both print their stdout
- [ ] Exit 1 when any state fails (collapsed ones and null code included), 0
      when all pass
- [ ] Single state: logs its stdout, no pass/FAIL line, returns code verbatim,
      null → 1

Paths: `scripts/test-states.ts`, `tests/tooling/test-states.test.ts`

### Task 4: `turboArgv` default and `spawnTurbo` capture

- [ ] `turboArgv(["a","b"], ["--force"])` →
      `["run", "a", "b", "--force", "--output-logs=errors-only"]`
- [ ] `--output-logs=full` or `--output-logs full` in args → no default
      appended, user value kept (turbo 2.10.9 rejects the option twice)
- [ ] Default lives in the runner, never in `turbo.json`
- [ ] `spawnTurbo` uses stdio `["inherit", "pipe", "inherit"]`, maxBuffer 256
      MiB
- [ ] Shim `turbo` receives forwarded args after task names plus default
      `--output-logs=errors-only`; result carries its exit code and stdout
- [ ] Shim printing 2 MiB to stdout and exiting 0 → `code: 0`, full 2 MiB
      captured
- [ ] Unspawnable turbo → `{ code: null, stdout: "" }` and
      `test-states: cannot run turbo:` on stderr
- [ ] **Risk: a multi-minute state is silent in a terminal until it ends** —
      accepted; stderr stays live

Paths: `scripts/test-states.ts`, `tests/tooling/test-states.test.ts`

### Task 5: Docs

- [ ] `docs/development.md` `npm test` paragraph: only failing tasks' logs
      print; a flag state failing like an earlier one prints one
      `same failure as <state>` line; `npm test -- --output-logs=full` restores
      full logs
- [ ] Prose names no `src/*.ts` module or internal function
- [ ] `README.md`, `docs/configuration.md`, gtd user docs unchanged
- [ ] `npm test` green

Paths: `docs/development.md`

## Tests

- unit: `tests/tooling/test-states.test.ts`
