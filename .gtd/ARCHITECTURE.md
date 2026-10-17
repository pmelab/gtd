# Architecture

## Open Questions

### On an empty trace, does `gtd summary --slice` keep today's "HEAD neither closes nor sits inside a process" refusal?

Concern 1 says `summaryFor` returns "nothing to render" on an empty trace before
any replay; the preamble says no user-visible change outside concern 2. On a
fresh idle repo with a `summary` template these disagree: the empty-trace check
first prints the generic refusal, letting the slice replay refuse first prints
today's line, which `summary-slice.feature` ("--slice on a fresh idle repo is
refused") pins.

- [x] Keep today's text: with a slice name, skip the empty-trace short-circuit
      and let the shared replay refuse
  - stderr unchanged; the pinned scenario stays as is
  - order becomes template check → replay (which refuses an empty trace) — no
    extra cost, the replay fails before any work
  - `summaryFor` reads "no trace → nothing to render" only on the plain path
- [ ] Follow concern 1 literally: empty trace → nothing to render on both paths
  - `--slice` on an idle repo prints the generic "either this workflow declares
    no "summary:" template, or there is no finished/in-flight process…" line
  - rewrite the pinned scenario's expected stderr; a second user-visible change
    besides concern 2
  - one uniform guard, simpler `summaryFor`
- [ ] _your answer_

## Interfaces

```ts
// src/edge/Edge.ts, exported through src/edge/index.ts
export interface SummaryResult {
  /** undefined: the workflow declares no `summary` template, or there is nothing to summarize. */
  readonly prompt: string | undefined
  /** Set when the slice replay finds a closing commit recorded by another gtd version. */
  readonly versionWarning?: string
  /**
   * `gtd summary: refused — no slice named "<name>"; the slices, in stack order: …`.
   * Returned, not failed, so `versionWarning` from the same replay still reaches the caller.
   */
  readonly refusal?: string
}

/**
 * Loads config and resolves the run's workflow once. No `summary` template →
 * `{ prompt: undefined }` before any replay. No `sliceName` → never replays.
 * With `sliceName`: replays once (shared with `gtd slices`), narrows trace and
 * cost to that slice; replay refusals (config edited, diverged) still fail.
 */
export const summaryFor: (
  run: ProcessRun,
  sliceName?: string,
) => Effect.Effect<SummaryResult, Error, RestRequirements>

// Removed from src/edge/index.ts and src/edge/Edge.ts: hasSummary, summarySlice
```

Internal, not exported, no tests of their own:

- `replayedSlices(config, run, how)` takes the already-loaded `ConfigOperations`
  instead of loading it again; `processSlices` passes its own load
- `narrowToSlice(run, slice?: SummarySlice): Pick<ProcessRun, "trace" | "costEntries">`
  — no `undefined` return, no `lies outside the process` refusal, its guard
  comment deleted
- `costTotals(entries: readonly CostEntry[]): Rest["cost"]` beside `costByModel`
  — `{ total, byModel }`; used by `summaryFor`
  (`processCost`/`processCostByModel`) and `restAt` (`cost`)

## Call Stacks

- `gtd summary` → `runSummaryCommand` (`src/cli/Program.ts`) → `summaryRun` →
  `summaryFor(run)` → `ConfigService.load` + `workflowOf` once → no template:
  `{ prompt: undefined }` → `costTotals` → workflow `summary(context)` → CLI
  writes prompt or fails with the generic refusal; text byte for byte
- `gtd summary --slice <name>` → `runSummaryCommand` → `summaryRun` →
  `summaryFor(run, name)` → `ConfigService.load` + `workflowOf` once → no
  template: `{ prompt: undefined }`, no replay → `replayedSlices(config, …)` →
  name lookup: unknown → `{ prompt: undefined, refusal, versionWarning? }` →
  known → `narrowToSlice` → `costTotals` → `summary(context with slice)`
- CLI after `summaryFor` → `Narrator.warn(versionWarning)` first → `refusal`:
  fail with it (exit 1, stdout empty) → `prompt` undefined: generic refusal →
  else write prompt
- `gtd slices` → `processSlices` → `ConfigService.load` →
  `replayedSlices(config, …)`
- `restAt` → `costTotals(run.costEntries)` → `Rest.cost`

## E2E Scenarios

- e2e: tests/integration/features/summary-slice.feature — a closed process whose
  closing commit records another gtd version, `summary --slice nope`: exit 1,
  stdout empty, stderr carries "recorded by gtd 0.0.1" BEFORE the
  `gtd summary: refused — no slice named "nope"` line; reuses the
  `Gtd-Version: 0.0.1` closing-commit Givens from `slices-command.feature`
  (covers concern 2)
- e2e: tests/integration/features/summary-slice.feature — every existing
  scenario passes unchanged, incl. `--cost=1/10/100/1000` per-slice costs
  summing to the plain total and plain `gtd summary` text (covers concerns 1,
  4, 6)

## Unit Tests

### summaryFor

- unit: src/edge/Edge.test.ts — `summaryFor(run, "build")`/`"verify"` render
  `slice` as `{ name, base, tip, index, count }` with boundary..built 1/2 and
  built..closing 2/2 (ported "resolves each slice…") (covers concern 1)
- unit: src/edge/Edge.test.ts — `summaryFor(run)` renders no `slice` key;
  `summaryFor(run, "verify")` renders the exact slice (covers concern 1)
- unit: src/edge/Edge.test.ts — slice narrows range and human commits, base
  exclusive, tip inclusive, gap commit folds into the later slice (ported)
  (covers concerns 1, 3)
- unit: src/edge/Edge.test.ts — per-slice `processCost` 11 + 1100 = 1111 and
  per-model sums equal the whole (ported) (covers concerns 1, 4)
- unit: src/edge/Edge.test.ts — `entryCommit` and `marks` stay whole-process
  under a slice (ported) (covers concern 1)
- unit: src/edge/Edge.test.ts — config drift at a closing HEAD fails
  `gtd summary: refused — config differs at` + "revert or stash"; a closed
  process not ending under today's config fails with the short-hash line
  (ported) (covers concern 1)
- unit: src/edge/Edge.test.ts — workflow without `summary` export under drifted
  config: `summaryFor(run, "build")` returns `{ prompt: undefined }`, no failure
  — proves the template check precedes the replay (covers concern 1)
- unit: src/edge/Edge.test.ts — plain `summaryFor(run)` under drifted config
  still returns a prompt — proves plain never replays (covers concern 1)
- unit: src/edge/Edge.test.ts — closing commit by gtd 0.0.1:
  `summaryFor(run, "build")` returns prompt plus `versionWarning` containing
  "0.0.1" (ported) (covers concern 1)
- unit: src/edge/Edge.test.ts — closing commit by gtd 0.0.1,
  `summaryFor(run, "nope")`: no failure, `prompt` undefined, `refusal` names
  `"nope"` and `build, verify`, `versionWarning` contains "0.0.1" (covers
  concern 2)
- unit: src/edge/Edge.test.ts — empty trace with `--slice`: per the open
  question, either fails "HEAD neither closes nor sits inside a process" or
  returns `{ prompt: undefined }` (ported "refuses an empty trace") (covers
  concern 1)
- unit: src/edge/Edge.test.ts — `restAt` on a process landed with `--cost=1`
  (opus) and `--cost=10` (haiku): `cost.total` 11, `byModel` haiku 10 then opus
  1 (covers concern 4)
- unit: src/cli/Program.test.ts — existing "a version warning goes to stderr,
  stdout still carries the prompt" passes unchanged (covers concern 1)

### Chores

- chore: src/edge/Edge.ts, src/edge/index.ts — delete `hasSummary`,
  `summarySlice`, the `lies outside the process` branch and `narrowToSlice`'s
  guard comment (covers concerns 1, 3)
- chore: docs/cli.md — "Narration and remediation": the WARNING is printed by
  `gtd slices`, `gtd summary --slice` and `gtd history show` (covers concern 2)
- chore: src/workflows/shared/text.ts — comment reads: plain text stays byte for
  byte; claude/hooks/ship.ts regex-reads its `git log base..tip` line (covers
  concern 5)
- chore: src/cli/Program.ts — `runSummaryCommand` JSDoc adds the `--slice`
  refusals: unknown slice name (every valid slice listed), config edited since a
  closed process, diverged replay; short (covers concern 5)
- chore: tests/integration/support/steps/history.steps.ts —
  `gtd lands {string} with {string}` splits `args.trim().split(/\s+/)`; existing
  scenarios unchanged (covers concern 6)

## Merged Concerns

Concerns 1–5 merge into one package: every footprint centers on
`src/edge/Edge.ts` `summaryFor` and `src/cli/Program.ts` `runSummaryCommand`;
concern 2's fix is the shape of concern 1's result, concern 3's branch and
concern 4's cost line sit inside `summaryFor`, concern 5 rewrites the JSDoc of
the function concern 1 rewrites. Concern 6 stays its own package
(`history.steps.ts` only).

### 1. Fold `hasSummary` + `summarySlice` into one `summaryFor(run, sliceName?)` (TECHNICAL)

Today `runSummaryCommand` (`src/cli/Program.ts`) calls `hasSummary`, then
`summarySlice`, then `summaryFor`. **The config loads and the workflow resolves
(`workflowOf`) twice per `--slice` call.**

- **`summaryFor` takes the slice NAME, not a resolved `SummarySlice`**: it
  resolves the workflow once, returns "nothing to render" when the workflow has
  no `summary` template or the run has no trace, and only then replays for the
  slice
- **Keep the cost ordering**: the template check stays ahead of the replay, so a
  workflow with no `summary:` never pays for a replay
- **Plain `gtd summary` still never replays**, and its text stays byte for byte
- **The version warning must leave the edge without the edge narrating**: the
  edge narrates and writes nothing (`replayedSlices` doc says so); return the
  warning in the result, the CLI prints it
- Remove `hasSummary` and `summarySlice` from `src/edge/index.ts`; port the
  `summarySlice` cases in `src/edge/Edge.test.ts` (lines ~766-950) to the new
  signature: same slice fields `{ name, base, tip, index, count }`, same
  refusals

### 2. Print the version warning before the unknown-slice refusal (TECHNICAL)

**Bug: an unknown `--slice` name on a process recorded by another gtd version
drops the version warning.** `summarySlice` fails on the unknown name after the
replay produced `versionWarning`, so the warning never reaches stderr.

- **Order on stderr: version warning first, then the
  `gtd summary: refused — no slice named "<name>"; …` line**; exit 1, stdout
  empty, as today
- **Add an `@inmem` scenario to
  `tests/integration/features/summary-slice.feature`**: a closed process
  recorded by another gtd version, `summary --slice nope` → stderr carries the
  warning, then the refusal; reuse the version-mismatch Given that the
  `gtd slices` warning scenarios already use
- `docs/cli.md` "Narration and remediation" names only `gtd slices` and
  `gtd history show` as printing the WARNING — **add `gtd summary --slice`**

### 3. Drop the unreachable `narrowToSlice` outside-process guard (TECHNICAL)

`narrowToSlice` (`src/edge/Edge.ts`) returns `undefined` for a slice outside the
run, and `summaryFor` refuses with `slice "<name>" lies outside the process`.
**After concern 1 the slice comes from the same replay as the run, so the branch
is dead.**

- `narrowToSlice` returns the narrowed `{ trace, costEntries }` unconditionally;
  delete the `lies outside the process` refusal and the doc comment describing
  the guard
- No test reaches that branch today; none to delete

### 4. One cost-total helper shared with the rest's cost (TECHNICAL)

`costEntries.reduce((sum, entry) => sum + entry.cost, 0)` appears twice in
`src/edge/Edge.ts`: in `summaryFor` (`processCost`) and in the rest's
`cost.total` (`restAt`, ~line 1067). **The sketch says "historyTrail", but
`historyTrail` sums no cost — the twin is `restAt`'s `cost`.**

- Extract one helper beside `costByModel` returning `{ total, byModel }` for a
  list of cost entries; use it in both places
- Per-slice costs must still add up to the plain total (existing scenario pins
  this with `--cost=1/10/100/1000`)

### 5. Fix the `text.ts` comment and the `runSummaryCommand` JSDoc (TECHNICAL)

- **`src/workflows/shared/text.ts` `summaryPrompt`: the comment "Plain text
  stays byte for byte: claude/hooks/ship.ts regex-reads it" overstates the
  coupling.** `claude/hooks/ship.ts` (`summaryRange`) reads only the
  `git log <base>..<tip>` line. Reword: plain text stays byte for byte; ship.ts
  regex-reads its `git log base..tip` line
- **`runSummaryCommand` JSDoc lists only two refusals** (no `summary` template,
  no commits). Add the `--slice` refusals: unknown slice name (every valid slice
  listed), config edited since a closed process, diverged replay. Keep it short

## Answered Questions

### Should the two parked deferred review notes (note-3 `[^stdout]`, note-2 `[^weak]`) be folded into this process?

No: the human's sketch deleted both `## Deferred review notes` sections when
writing the PR 389 fix list, and a removal is input — they are out of scope
here.

### Does any concern change user-visible output?

Only concern 2 (warning now printed on the unknown-slice refusal); every other
concern is a refactor or test/comment fix with output unchanged — pending the
empty-trace open question above.

### How does the unknown-slice refusal carry the version warning out of the edge?

As a returned `refusal` string beside `versionWarning` in `SummaryResult`, not
an `Error` subclass: the CLI prints the warning, then fails with the refusal —
no `instanceof` on the error channel, and one plain value to assert in the unit
test. Replay refusals stay failures; they never coexist with a warning.

### How does `summaryFor` avoid the second config load?

`replayedSlices` takes the `ConfigOperations` its caller already loaded;
`processSlices` gets the same saving. The replay's own `setupFor` still resolves
the workflow — that is the replay, not a duplicate.

### Does the cost helper replace `costByModel`?

No: `costTotals` wraps it, so `costByModel` stays the one per-model sort and
both call sites read `{ total, byModel }` from one place.

### Does the step split fix need its own test?

No: it is test support; every `gtd lands … with …` scenario exercises it, and
`trim().split(/\s+/)` keeps single-space args identical.
