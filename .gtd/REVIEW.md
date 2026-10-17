# Review: f077542

<!-- base: 560c29f8cfff0cf17b06ff5e1bd52b0c6bb5cdd3 -->

**No defect found; nothing marked `Risk:`.** Main change: `gtd summary --slice`
now resolves through one call (`summaryFor(run, sliceName)`), so the version
warning reaches stderr before an unknown-slice refusal, and a replay refusal
carries that warning in its own message.

## Scenarios

- [ ] ./tests/integration/features/summary-slice.feature#442-486 — **An unknown
      slice name on a process closed by another gtd version (0.0.1) prints the
      version warning first, then refuses with exit 1 and empty stdout.** Stderr
      order is pinned by one regex: warning text before `no slice named "nope"`.

## One entry point for the summary prompt

`summarySlice` and `hasSummary` are gone. `summaryFor` takes a slice name,
checks for a `summary` template first (no replay when there is none), replays
only for a named slice, and returns
`{ prompt, versionWarning?, unknownSlice? }`. **The edge still never narrates**:
the CLI prints the warning, then fails on `unknownSlice`.

- [ ] ./src/cli/Program.ts#323-350 — CLI drops its own branching: warn, then
      refuse on `unknownSlice`, then refuse on no prompt. Doc comment states the
      warning comes before any refusal.[^jsdoc]
- [ ] ./src/edge/Edge.ts#1477-1490 — `narrowToSlice` loses its "slice outside
      the process" guard and its `undefined` return. Safe only because the slice
      now comes from `locateSlice` in the same call. **A future caller passing a
      foreign slice gets a silently wrong window, not an error** — FYI, not
      reachable today.
- [ ] ./src/edge/Edge.ts#1492-1522 — `SummaryResult` type plus `humanCommitsOf`
      and `summaryInput` extracted from the old inline object literal; same
      fields, same values.
- [ ] ./src/edge/Edge.ts#1524-1551 — `locateSlice`: replays like `gtd slices`,
      returns an unknown name as data (`unknownSlice`, every slice in stack
      order) instead of failing, so the warning survives.
- [ ] ./src/edge/Edge.ts#1553-1581 — `summaryFor`: plain call on an empty trace
      still returns `prompt: undefined`; a named slice on an empty trace fails
      from the replay ("HEAD neither closes nor sits inside a process").
- [ ] ./src/edge/index.ts#12-18 — exports of `hasSummary` and `summarySlice`
      removed.

## Replay refusals carry the version warning

- [ ] ./src/edge/Edge.ts#1718-1735 — version is parsed before the config-drift
      and divergence checks; both refusals get the warning appended on a new
      line. **Scope is wider than summary: `gtd slices` and `gtd history show`
      refusals also gain the line.** Only the divergence path under `summaryFor`
      is unit-tested; config-drift-plus-warning and the slices/history refusals
      have no test pinning the appended warning.[^slicewarn]
- [ ] ./docs/cli.md#430-434 — WARNING paragraph now names `gtd summary --slice`
      among the commands that print it. Does not mention that refusals now carry
      it too.

## Config threaded into the slice replay

- [ ] ./src/edge/Edge.ts#1100-1113 — `replayedSlices` takes the already-loaded
      `config` instead of loading it again, so `summaryFor` loads config once.
- [ ] ./src/edge/Edge.ts#1154-1154 — `processSlices` passes its config through.

## Cost totals shared

- [ ] ./src/edge/Edge.ts#909-913 — `costTotals` extracted; used by `restAt` and
      the summary input.
- [ ] ./src/edge/Edge.ts#1071-1071 — `restAt` uses it.
- [ ] ./src/edge/Edge.test.ts#1009-1033 — new `restAt` test pins total and
      per-model breakdown (highest first) through the shared helper.

## Unit tests rewritten onto `summaryFor`

- [ ] ./src/edge/Edge.test.ts#815-824 — `render` helper now takes a slice name;
      `sliceOf` deleted.
- [ ] ./src/edge/Edge.test.ts#885-893 — empty trace: named slice refuses with
      the replay message, plain call returns `{ prompt: undefined }`.
- [ ] ./src/edge/Edge.test.ts#931-974 — new: divergence refusal under 0.0.1
      carries the warning; config without `summary` returns no prompt, not a
      failure; plain call never replays under an edited config.
- [ ] ./src/edge/Edge.test.ts#981-1004 — version warning returned alongside a
      prompt; unknown slice returns `unknownSlice` naming `build, verify` and
      keeps the warning.

## Small cleanups

- [ ] ./src/workflows/shared/text.ts#1039-1039 — comment narrowed to what
      `claude/hooks/ship.ts` actually regex-reads.
- [ ] ./tests/integration/support/steps/history.steps.ts#31-37 —
      `gtd lands … with …` trims and splits args on any whitespace run, so stray
      spaces no longer produce empty args.

[^jsdoc]:
    The `runSummaryCommand` doc comment still lists only the two plain refusals.
    Add the `--slice` ones, short: unknown slice name (valid slices listed),
    config edited since a closed process, diverged replay.

[^slicewarn]:
    Pin the wider scope: add one `@inmem` scenario where `gtd slices` refuses
    (config edited after a closing commit recorded by gtd 0.0.1) and stderr
    carries both the refusal and the version warning.
