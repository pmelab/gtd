# 01 — One `summaryFor(run, sliceName?)`; version warning survives the unknown-slice refusal

## Requirements

Merged concerns 1–5 (see `.gtd/ARCHITECTURE.md`, `## Merged Concerns`):

1. **Fold `hasSummary` + `summarySlice` into one `summaryFor(run, sliceName?)`**
   — config loads and workflow resolves once per call; template check precedes
   any replay; plain `gtd summary` never replays, text byte for byte; empty
   trace is "nothing to render" only on the plain path, with a slice name the
   replay refuses
   `gtd summary: refused — HEAD neither closes nor sits inside a process`. The
   edge never narrates: `versionWarning` returns in the result, the CLI prints
   it.
2. **Bug: unknown `--slice` name on a process recorded by another gtd version
   drops the version warning.** Stderr order: version warning first, then
   `gtd summary: refused — no slice named "<name>"; …`; exit 1, stdout empty.
3. **Drop the dead `narrowToSlice` outside-process guard** and its
   `lies outside the process` refusal.
4. **One cost-total helper `costTotals`** beside `costByModel`, used by
   `summaryFor` and `restAt`; per-slice costs still sum to the plain total.
5. **Fix the `text.ts` comment and the `runSummaryCommand` JSDoc.**

Interface (pinned, `src/edge/Edge.ts`, exported via `src/edge/index.ts`):

```ts
export interface SummaryResult {
  readonly prompt: string | undefined
  readonly versionWarning?: string
  readonly refusal?: string
}
export const summaryFor: (
  run: ProcessRun,
  sliceName?: string,
) => Effect.Effect<SummaryResult, Error, RestRequirements>
```

## Tasks

### Task 1: `costTotals` helper, used by `restAt` and `summaryFor`

- [ ] `costTotals(entries: readonly CostEntry[]): Rest["cost"]` returns
      `{ total, byModel }`, wraps `costByModel`; not exported
- [ ] `restAt` `cost` and `summaryFor` `processCost`/`processCostByModel` read
      from it; no other `reduce((sum, entry) => sum + entry.cost, 0)` left in
      `src/edge/Edge.ts`
- [ ] Unit test: `restAt` on a process landed with `--cost=1` (opus) and
      `--cost=10` (haiku) → `cost.total` 11, `byModel` haiku 10 then opus 1

Paths: `src/edge/Edge.ts`, `src/edge/Edge.test.ts`

### Task 2: `replayedSlices` takes the loaded config

- [ ] `replayedSlices(config, run, how)` takes the caller's `ConfigOperations`;
      `processSlices` passes its own load — no second `ConfigService.load`
- [ ] `gtd slices` output unchanged (existing tests green)

Paths: `src/edge/Edge.ts`

### Task 3: `summaryFor(run, sliceName?)` returning `SummaryResult`

- [ ] Loads config + `workflowOf` once; no `summary` template →
      `{ prompt: undefined }` before any replay
- [ ] No `sliceName`: never replays; empty trace → `{ prompt: undefined }`
- [ ] With `sliceName`: no empty-trace short-circuit; replays once via
      `replayedSlices(config, …)`; replay refusals (empty trace, config edited,
      diverged) still fail
- [ ] Unknown name → `{ prompt: undefined, refusal, versionWarning? }`, refusal
      text
      `gtd summary: refused — no slice named "<name>"; the slices, in stack order: …`
- [ ] Known name → `narrowToSlice` → `costTotals` →
      `summary(context with slice)`; `slice` renders as
      `{ name, base, tip, index, count }`
- [ ] `narrowToSlice(run, slice?)` returns
      `Pick<ProcessRun, "trace" | "costEntries">` unconditionally;
      `lies outside the process` refusal and guard comment deleted
- [ ] `hasSummary` and `summarySlice` deleted from `src/edge/Edge.ts` and
      `src/edge/index.ts`
- [ ] Port the `summarySlice` unit cases (~lines 766–950 of
      `src/edge/Edge.test.ts`) to `summaryFor(run, name)`, plus the new cases:
  - [ ] `"build"`/`"verify"` → boundary..built 1/2, built..closing 2/2
  - [ ] plain renders no `slice` key; `"verify"` renders the exact slice
  - [ ] range and human commits narrowed, base exclusive, tip inclusive, gap
        commit folds into the later slice
  - [ ] per-slice `processCost` 11 + 1100 = 1111; per-model sums equal the whole
  - [ ] `entryCommit` and `marks` stay whole-process under a slice
  - [ ] config drift at closing HEAD fails
        `gtd summary: refused — config differs at` + "revert or stash"; closed
        process not ending under today's config fails with the short-hash line
  - [ ] no `summary` export under drifted config: `summaryFor(run, "build")` →
        `{ prompt: undefined }`, no failure
  - [ ] plain `summaryFor(run)` under drifted config still returns a prompt
  - [ ] closing commit by gtd 0.0.1: `summaryFor(run, "build")` → prompt +
        `versionWarning` containing "0.0.1"
  - [ ] closing commit by gtd 0.0.1, `summaryFor(run, "nope")`: no failure,
        `prompt` undefined, `refusal` names `"nope"` and `build, verify`,
        `versionWarning` contains "0.0.1"
  - [ ] empty trace + `summary` template: `summaryFor(run, "build")` fails
        `gtd summary: refused — HEAD neither closes nor sits inside a process`;
        `summaryFor(run)` → `{ prompt: undefined }`

Paths: `src/edge/Edge.ts`, `src/edge/index.ts`, `src/edge/Edge.test.ts`

### Task 4: CLI wiring in `runSummaryCommand`

- [ ] One `summaryFor(run, name)` call; no `hasSummary`/`summarySlice`
- [ ] Order: `Narrator.warn(versionWarning)` first → `refusal` fails (exit 1,
      stdout empty) → `prompt` undefined fails with the generic refusal → else
      write prompt
- [ ] JSDoc adds the `--slice` refusals, short: unknown slice name (every valid
      slice listed), config edited since a closed process, diverged replay
- [ ] Existing unit test "a version warning goes to stderr, stdout still carries
      the prompt" passes unchanged

Paths: `src/cli/Program.ts`, `src/cli/Program.test.ts`

### Task 5: e2e scenario for the warning before the refusal

- [ ] New `@inmem` scenario in `summary-slice.feature`: closed process whose
      closing commit records `Gtd-Version: 0.0.1` (reuse the Givens from
      `slices-command.feature`), `summary --slice nope` → exit 1, stdout empty,
      stderr carries "recorded by gtd 0.0.1" BEFORE the
      `gtd summary: refused — no slice named "nope"` line
- [ ] Every existing scenario passes unchanged, incl. "--slice on a fresh idle
      repo is refused" (stderr as today), `--cost=1/10/100/1000` per-slice costs
      summing to the plain total, plain `gtd summary` text

Paths: `tests/integration/features/summary-slice.feature`,
`tests/integration/features/slices-command.feature` (read only, for the Givens)

### Task 6: Docs and comments

- [ ] `docs/cli.md` "Narration and remediation": WARNING printed by
      `gtd slices`, `gtd summary --slice` and `gtd history show`
- [ ] `src/workflows/shared/text.ts` `summaryPrompt` comment: plain text stays
      byte for byte; `claude/hooks/ship.ts` regex-reads its `git log base..tip`
      line
- [ ] README checked: no mention of `hasSummary`/`summarySlice` or the warning
      list to update

Paths: `docs/cli.md`, `src/workflows/shared/text.ts`, `README.md`

## Tests

- unit: `src/edge/Edge.test.ts`
- unit: `src/cli/Program.test.ts`
- e2e: `tests/integration/features/summary-slice.feature`
