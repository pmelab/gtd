# Architecture: PR #393 review fixes

All four fixes land in `scripts/test-states.ts`, `scripts/test-states.main.ts`
and `tests/tooling/test-states.test.ts` — **one package**. Every fix ships with
a test case that fails before the fix.

- **One exported helper, `flagValue`, reads a user turbo flag's value** from the
  forwarded args, in both `--flag=x` and `--flag x` spelling. `undefined` means
  absent. It answers "did the user pass it?" (`!== undefined`) and "is it
  `full`/`task`?" (`=== …`) for both `--output-logs` and `--log-prefix`.
- **`turboArgv` appends `--output-logs=errors-only` and `--log-prefix=task`**,
  each only when `flagValue` finds no user value for it (turbo 2.10.9 refuses
  either flag twice).
- **`runStates` takes `{ full, collapse }` instead of a bare `full` boolean.**
  `full` prints passing states' logs and disables collapsing; `collapse: false`
  disables only collapsing — passing states still print only their label.
- **The entry point derives both from `flagValue`:** `full` is
  `--output-logs === "full"`; `collapse` is
  `(--log-prefix ?? "task") === "task"`. Its duplicated `--output-logs`
  predicate goes.
- **`failureSignature` replaces only `\b[0-9a-f]{16}\b`** (case-insensitive) —
  turbo's task hash. 12-char and 40-char git shas stay in the signature.
- **The real-turbo test resolves turbo via
  `fileURLToPath(new URL("../../node_modules/.bin/turbo", import.meta.url))`**,
  builds argv with `turboArgv(["boom"], [])`, and runs with
  `GITHUB_ACTIONS: "true"` in its env.
- Docs: `docs/development.md` adds the `--log-prefix` rule beside the
  `--output-logs` paragraph and narrows "never collapses" to `full`. PR #393's
  description (`gh pr edit 393 --body …`) corrects its "Decisions" bullet.

## Interfaces

```ts
// scripts/test-states.ts

/** The user's value for a turbo flag: `--flag=x` or `--flag x`; "" when the flag ends args; undefined when absent. */
export function flagValue(
  args: readonly string[],
  flag: `--${string}`,
): string | undefined

export interface RunOptions {
  /** Print passing states' logs and never collapse. */
  readonly full?: boolean
  /** Collapse a repeated failure to one line. Default true; ignored when `full`. */
  readonly collapse?: boolean
}

// was: runStates(states, run, log, full = false)
export function runStates(
  states: readonly TestState[],
  run: RunTasks,
  log: (line: string) => void,
  options?: RunOptions,
): number

// unchanged signature; now also appends --log-prefix=task unless the user passed --log-prefix
export const turboArgv: (
  tasks: readonly string[],
  args: readonly string[],
) => string[]

// unchanged signature; hex rule narrowed to whole-word 16-char runs
export function failureSignature(
  stdout: string,
  tasks: readonly string[],
): string
```

```ts
// scripts/test-states.main.ts
const args = process.argv.slice(2)
process.exitCode = runStates(
  planStates(FLAGS, process.env),
  (t, e) => spawnTurbo(t, e, args),
  console.log,
  {
    full: flagValue(args, "--output-logs") === "full",
    collapse: (flagValue(args, "--log-prefix") ?? "task") === "task",
  },
)
```

## Call Stacks

- `npm test` → `scripts/test-states.main.ts` → `flagValue(args, …)` ×2 →
  `runStates(…, { full, collapse })`
- `runStates` → `RunTasks` (`spawnTurbo`) → `turboArgv` → `flagValue` →
  `turbo run …`
- `runStates` → `reportFailure` → `failureSignature` (only when
  `collapse && !full`)

## E2E Scenarios

No e2e change. The runner is repo tooling, not gtd behaviour; its only harness
is vitest under `tests/tooling/`.

## Unit Tests

### flagValue

- unit: tests/tooling/test-states.test.ts — `--output-logs=full` → `"full"`
  (covers 2)
- unit: tests/tooling/test-states.test.ts — `--output-logs`, `full` as separate
  args → `"full"` (covers 2)
- unit: tests/tooling/test-states.test.ts — `--output-logs=new-only` →
  `"new-only"`, not full (covers 2)
- unit: tests/tooling/test-states.test.ts — `--output-logs`, `new-only` as
  separate args → `"new-only"` (covers 2)
- unit: tests/tooling/test-states.test.ts — no flag → `undefined` (covers 2)
- unit: tests/tooling/test-states.test.ts — `--log-prefix=none` and
  `--log-prefix`, `none` → `"none"` (covers 1)

### turboArgv

- unit: tests/tooling/test-states.test.ts — no user flags → argv ends
  `--output-logs=errors-only`, `--log-prefix=task` (covers 1)
- unit: tests/tooling/test-states.test.ts — user `--log-prefix=none` replaces
  the default; `--log-prefix=task` appears nowhere (covers 1)
- unit: tests/tooling/test-states.test.ts — user `--log-prefix`, `none` as
  separate args replaces the default (covers 1)
- unit: tests/tooling/test-states.test.ts — user `--output-logs=new-only` and
  `--output-logs`, `new-only` replace the output default, keep
  `--log-prefix=task` (covers 2)
- unit: tests/tooling/test-states.test.ts — shim-turbo argv case receives
  `--log-prefix=task` after `--output-logs=errors-only` (covers 1)

### RunOptions / runStates

- unit: tests/tooling/test-states.test.ts — `{ collapse: false }`: two identical
  failures both print in full, no "same failure as" line, a passing state prints
  only its label (covers 1)
- unit: tests/tooling/test-states.test.ts — `{ full: true }`: pass stdout prints
  and repeated failure never collapses (existing case, migrated off the bare
  boolean) (covers 2)
- unit: tests/tooling/test-states.test.ts — default options: repeated failure
  collapses, pass prints only its label (existing cases unchanged) (covers 2)

### main entry point

- unit: tests/tooling/test-states.test.ts — options derived from args:
  `--log-prefix=task` → collapse on; `--log-prefix=none` → collapse off;
  `--output-logs=new-only` → full off, collapse on; `--output-logs full` → full
  on. Test the same `flagValue` expressions the entry point uses (covers 1, 2)

### failureSignature

- unit: tests/tooling/test-states.test.ts — outputs differing only in a 16-char
  hash share a signature (covers 3)
- unit: tests/tooling/test-states.test.ts — outputs differing only in a 40-char
  git sha differ (covers 3)
- unit: tests/tooling/test-states.test.ts — outputs differing only in a 12-char
  abbreviated sha differ (covers 3)
- unit: tests/tooling/test-states.test.ts — real turbo: run from turbo resolved
  off `import.meta.url`, argv from `turboArgv`, env `GITHUB_ACTIONS=true` →
  signature non-empty, contains `boom-line`, stable across two runs (covers
  1, 4)

### Chores

- chore: docs/development.md — state that `--log-prefix=task` is always passed,
  a user `--log-prefix` replaces it and turns collapsing off unless `task`; keep
  "`--output-logs=full` never collapses" without implying other values do
  (covers 1, 2)
- chore: PR #393 description — rewrite the "Decisions" bullet: a user
  `--output-logs` replaces the default; only `full` prints passes and turns
  collapsing off; add the `--log-prefix` rule (covers 1, 2)
- chore: scripts/test-states.main.ts — delete the duplicated `--output-logs`
  predicate (covers 2)

## Merged Concerns

All four concerns center on `scripts/test-states.ts` and
`tests/tooling/test-states.test.ts`; concerns 1 and 2 share one helper. Merged
into one package.

### 1. Always pass `--log-prefix=task` — TECHNICAL

Turbo's default `--log-prefix=auto` switches to GitHub Actions log groups in CI
and drops the `<task>: ` line prefix. **Result in CI: `failureSignature` keeps
no lines, every signature is empty, and repeated failures never collapse.** The
real-turbo test breaks there for the same reason.

- **`turboArgv` always emits `--log-prefix=task`**, in every environment.
- **A user `--log-prefix` replaces the default** (turbo 2.10.9 refuses the flag
  twice), in both the `--log-prefix=x` and `--log-prefix x` spelling — the same
  shared helper as concern 2 detects it.
- **Collapsing turns off unless the user value is `task`.** With
  `--log-prefix=none` every failing state prints its full log and no "same
  failure as" line appears. Passing states still print only their label — only
  `--output-logs full` changes that.
- `docs/development.md` states this next to the `--output-logs` rule.
- Tests: `turboArgv` and the shim-turbo argv case show `--log-prefix=task`; a
  user `--log-prefix=none` (and `none` as a separate arg) replaces it and turns
  collapsing off; a user `--log-prefix=task` keeps collapsing on; the real-turbo
  test runs with `GITHUB_ACTIONS=true` in its env and still gets a non-empty,
  stable signature.

### 2. Only `--output-logs full` turns on full mode — TECHNICAL

Today any user `--output-logs` value turns off collapsing and prints passing
states' logs. **Full mode applies only when the value is `full`** — both the
`--output-logs=full` and the `--output-logs full` spelling.

- Any other user value (`errors-only`, `new-only`, `hash-only`, `none`) still
  replaces the default in the argv, but collapsing stays on and passing states
  print only their label.
- **One shared, exported helper answers both questions** — "did the user pass
  `--output-logs`?" (for `turboArgv`) and "is it `full`?" (for the entry point's
  `full` argument). The duplicated predicate in `scripts/test-states.main.ts`
  goes.
- Tests: the helper over `=full`, `full` as a separate arg, `=new-only`,
  `new-only` as a separate arg, and no flag.
- `docs/development.md` keeps saying `--output-logs=full` never collapses; it
  must not imply other values do the same. PR #393's "Decisions" bullet ("A
  user-supplied `--output-logs` … turns collapsing off") gets the same
  correction.

### 3. Hex normalisation strips only 16-char turbo hashes — TECHNICAL

`failureSignature` replaces any run of 12+ hex chars with `<hex>`. **That also
erases git shas (40 chars, or 12+ abbreviated), so two failures differing only
in a commit sha collapse into one — a different failure hidden.** That breaks
the PR's own rule: normalisation leans toward "distinct".

- **Replace only whole-word runs of exactly 16 hex chars** (turbo's task hash).
- Tests: two outputs differing only in a 16-char hash share a signature; two
  differing only in a 40-char sha, and in a 12-char abbreviated sha, do not.

### 4. Real-turbo test resolves turbo from the repo root — TECHNICAL

The "failureSignature against real turbo" test builds the turbo path from
`process.cwd()`. **Run from any directory other than the repo root, it cannot
find turbo.**

- **Resolve `node_modules/.bin/turbo` from the test file's own location**
  (`import.meta.url`, two levels up), never from `cwd`.
- The test builds its argv with `turboArgv`, so it exercises the real flags the
  runner sends, `--log-prefix=task` included.

## Answered Questions

### Do the three deferred review notes in `.gtd/TODO.md` still apply?

No. The human deleted all three (note-1 `runSummaryCommand` doc comment, note-2
`gtd history list` scenario, note-3 garbled-flag stdout assertion) in the same
edit that added this sketch; they are dropped, not folded.

### Does the README need a change?

No. The runner's output behaviour is documented in `docs/development.md` only;
the README does not describe it.

### What happens when the user passes their own `--log-prefix`?

The user value replaces the default; collapsing turns off unless it is `task`,
mirroring `--output-logs`. `--log-prefix=none` prints every failing state's full
log with no "same failure as" lines.

### One helper per flag, or one generic value reader?

One generic `flagValue(args, flag)`. Both flags share the two spellings and the
same replace-the-default rule; a per-flag pair would duplicate the parser the
requirement asks to deduplicate.

### How does `runStates` learn "collapse off" separately from "full"?

An options object `{ full, collapse }` replaces the bare `full` boolean. Two
positional booleans read ambiguously at the call site; only the entry point and
tests call `runStates`, so the change stays internal.

### How is the entry point's option derivation tested without spawning it?

Unit tests assert the same `flagValue` expressions the entry point uses; the
entry point stays three lines with no logic of its own beyond them. Spawning it
would run the whole turbo graph.

### Does `--output-logs` with no following value count as passed?

Yes — `flagValue` returns `""`, the default is not appended, and turbo reports
the missing value itself. Not worth a guard.
