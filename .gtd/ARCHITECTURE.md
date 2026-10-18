# Architecture: PR 393 review round 2 — boilerplate-only failures never collapse

**Signature unchanged; only what `failureSignature` keeps changes.** Turbo's own
per-task lines drop out, so a failure with no diagnostic gives `""` and
`reportFailure` (untouched) prints it in full with a plain `FAIL` label.

**Echo lines are told apart by position, not pattern.** Verified against real
turbo 2.10.9 stdout: every task block opens
`<task>: cache miss, executing <hash>`, `<task>: `, `<task>: > <script>`,
`<task>: > <command>`, `<task>: `. A task-printed `> quoted` line arrives after
that head and stays.

Filter, per task, inside the existing loop after the prefix match:

- **Cache line** — body matches
  `^cache (miss, executing|bypass, force executing|hit, replaying logs) [0-9a-f]+$`:
  drop it and open that task's echo window, allowing 2 `> ` lines.
- **Blank line** — body empty or whitespace only: drop, anywhere in the block;
  it leaves the echo window as it is.
- **Echo line** — body starts with `> `, the window is open with echoes left:
  drop it and use up one echo.
- **Exit line** — body matches `^\s*ERROR\s+command \(.*\) .* exited \(\d+\)$`:
  drop. Real turbo writes it to stderr, which the runner does not capture; it is
  dropped anyway so a turbo that moves it to stdout cannot revive the bug.
- **Anything else** is a diagnostic: keep it (normalised as today) and close the
  window.

**Risk: a task line with no preceding cache line never opens the window, so a
hand-written `lint: > x` with no head stays counted** — the existing
hand-written tests keep their signatures.

## Interfaces

```ts
// scripts/test-states.ts — signature unchanged, contract narrowed:
// returns "" when every task-prefixed line is turbo boilerplate
// (cache line, the up-to-2 `> ` echo lines that follow it, blank lines,
// `ERROR  command (…) … exited (n)`); a line the task printed always counts.
export function failureSignature(
  stdout: string,
  tasks: readonly string[],
): string
```

## Call Stacks

- `npm test` → `scripts/test-states.ts` main → `runStates` → `spawnTurbo` (turbo
  stdout)
- `runStates` → `reportFailure` → `failureSignature` → `""` → print full log +
  `FAIL`, never `same failure as`

## E2E Scenarios

No e2e change. The runner is dev tooling outside gtd's CLI; its suite is
`tests/tooling/test-states.test.ts`, including a real-turbo test.

## Unit Tests

### failureSignature

- unit: tests/tooling/test-states.test.ts — `failureSignature` returns `""` for
  a hand-written boilerplate-only block (cache miss line, blank, `> boom`,
  `> exit 1`, blank, `ERROR  command (…) … exited (1)`), for each of the three
  cache-line wordings (covers 1. Drop turbo boilerplate from the signature)
- unit: tests/tooling/test-states.test.ts — boilerplate head plus a task-printed
  `> quoted` line after the two echo lines keeps a non-empty signature
  containing `> quoted` (covers 1. Drop turbo boilerplate from the signature)
- unit: tests/tooling/test-states.test.ts — two boilerplate-only stdouts with
  differing hashes and the same command each return `""` (covers 2. Test a
  boilerplate-only failure in two states)
- unit: tests/tooling/test-states.test.ts — boilerplate plus one real diagnostic
  line gives a non-empty signature, equal across two states whose hashes differ
  (covers 2. Test a boilerplate-only failure in two states)
- unit: tests/tooling/test-states.test.ts — real turbo, script `exit 1` with no
  echo, gives `""`, beside the existing `boom-line` test (covers 2. Test a
  boilerplate-only failure in two states)
- unit: tests/tooling/test-states.test.ts — real turbo, script
  `echo "> quoted"; exit 1` gives a signature containing `> quoted` (covers 1.
  Drop turbo boilerplate from the signature)

### runStates

- unit: tests/tooling/test-states.test.ts — two failing states whose stdout is
  boilerplate only (differing hashes, same command) each print their full log
  and end on a plain `test-states: <label> — FAIL` line; output holds no
  `same failure as` (covers 2. Test a boilerplate-only failure in two states)

### Chores

- chore: docs/development.md — collapsing paragraph gains one sentence: a
  failing state that prints nothing beyond turbo's own lines is always shown in
  full, never collapsed (covers 3. Document that a diagnostic-free failure never
  collapses)

## Merged Concerns

### 1 + 2 → one package: filter and its tests share `scripts/test-states.ts` and `tests/tooling/test-states.test.ts`

- **1. Drop turbo boilerplate from the signature — TECHNICAL**
  - **Drop every task-prefixed line turbo writes itself, not the task:** the
    `cache miss, executing <hash>` / `cache bypass, force executing <hash>` /
    `cache hit, replaying logs <hash>` line, the `> <script>` and `> <command>`
    echo lines, task-prefixed lines that are blank after the prefix, and the
    `ERROR  command (…) … exited (<n>)` line.
  - **Never drop a line the task itself printed** — a real diagnostic that
    starts with `> ` (a code frame, a quoted line) must still count. How the
    echo lines are told apart (position at the head of a task's block vs. a
    pattern) is the build's call; the test in concern 2 pins it.
  - **A failure whose task lines are all boilerplate yields `""`**, which
    `reportFailure` already treats as "never collapse, print the full log".
- **2. Test a boilerplate-only failure in two states — TECHNICAL**
  - **Unit test: two states whose stdout holds only boilerplate (differing
    hashes, same command) each print their full log and a plain `FAIL` label —
    no `same failure as` line**, and `failureSignature` returns `""` for each.
  - **Unit test: boilerplate plus one real diagnostic line still gives a
    non-empty signature equal across two states** — so the filter cannot pass by
    dropping everything.
  - **Real-turbo test: a silent failing script (`exit 1`, no echo) gives `""`**,
    beside the existing `boom-line` test, so the filter is pinned to turbo's
    real output, not a hand-written imitation of it.

## Answered Questions

### Do only the two named line kinds count as boilerplate, or also turbo's blank and `ERROR … exited (n)` lines?

All of them: the directive's stated goal is "no diagnostic output yields an
empty signature", and real turbo's blank and `ERROR … exited (1)` lines would
keep that signature non-empty, so dropping only the two named kinds misses the
goal.

### Should a diagnostic-free failure still print its log?

Yes: it prints in full as today; only collapsing is suppressed, so the human
still sees which task failed.

### Should the three deferred review notes (836985b, daed27f, eda53bb) be folded in?

No: the human deleted them in the entry commit, which drops them from this
process.

### Are echo lines told apart by position or by pattern?

Position: up to 2 `> ` lines right after a task's cache line are echoes. npm
always prints exactly the script name and the command there, and a pattern alone
cannot tell `> exit 1` from a task's own `> ` code frame.

### Are blank task lines dropped only in the head, or anywhere?

Anywhere: a blank line carries no diagnostic, and dropping it everywhere keeps
the rule one branch shorter with no lost signal.

### Is concern 3's doc sentence its own package?

Yes: it touches only `docs/development.md`, outside the merged package's files,
and consumes nothing from it but the behaviour.
