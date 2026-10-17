# Requirements

Review fixes for PR 389 (`gtd summary --slice`, commit `560c29f8`), from the
sketch in `.gtd/TODO.md`. No user-visible behaviour changes except the warning
order in concern 2. Every concern is TECHNICAL.

## 1. Fold `hasSummary` + `summarySlice` into one `summaryFor(run, sliceName?)` (TECHNICAL)

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

## 2. Print the version warning before the unknown-slice refusal (TECHNICAL)

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

## 3. Drop the unreachable `narrowToSlice` outside-process guard (TECHNICAL)

`narrowToSlice` (`src/edge/Edge.ts`) returns `undefined` for a slice outside the
run, and `summaryFor` refuses with `slice "<name>" lies outside the process`.
**After concern 1 the slice comes from the same replay as the run, so the branch
is dead.**

- `narrowToSlice` returns the narrowed `{ trace, costEntries }` unconditionally;
  delete the `lies outside the process` refusal and the doc comment describing
  the guard
- No test reaches that branch today; none to delete

## 4. One cost-total helper shared with the rest's cost (TECHNICAL)

`costEntries.reduce((sum, entry) => sum + entry.cost, 0)` appears twice in
`src/edge/Edge.ts`: in `summaryFor` (`processCost`) and in the rest's
`cost.total` (`restAt`, ~line 1067). **The sketch says "historyTrail", but
`historyTrail` sums no cost — the twin is `restAt`'s `cost`.**

- Extract one helper beside `costByModel` returning `{ total, byModel }` for a
  list of cost entries; use it in both places
- Per-slice costs must still add up to the plain total (existing scenario pins
  this with `--cost=1/10/100/1000`)

## 5. Fix the `text.ts` comment and the `runSummaryCommand` JSDoc (TECHNICAL)

- **`src/workflows/shared/text.ts` `summaryPrompt`: the comment "Plain text
  stays byte for byte: claude/hooks/ship.ts regex-reads it" overstates the
  coupling.** `claude/hooks/ship.ts` (`summaryRange`) reads only the
  `git log <base>..<tip>` line. Reword: plain text stays byte for byte; ship.ts
  regex-reads its `git log base..tip` line
- **`runSummaryCommand` JSDoc lists only two refusals** (no `summary` template,
  no commits). Add the `--slice` refusals: unknown slice name (every valid slice
  listed), config edited since a closed process, diverged replay. Keep it short

## 6. Split the `gtd lands … with …` step's args on whitespace (TECHNICAL)

`tests/integration/support/steps/history.steps.ts`: the new Given
`gtd lands {string} with {string}` calls `args.split(" ")`. **Two spaces or a
tab yield an empty-string argv entry passed to `gtd land`.**

- Split on `/\s+/` after trimming; existing scenarios (`--cost=1` etc.) keep
  passing unchanged

## Answered Questions

### Should the two parked deferred review notes (note-3 `[^stdout]`, note-2 `[^weak]`) be folded into this process?

No: the human's sketch deleted both `## Deferred review notes` sections when
writing the PR 389 fix list, and a removal is input — they are out of scope
here.

### Does any concern change user-visible output?

Only concern 2 (warning now printed on the unknown-slice refusal); every other
concern is a refactor or test/comment fix with output unchanged.
