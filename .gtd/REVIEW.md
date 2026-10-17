# Review: c451fb5

<!-- base: 560c29f8cfff0cf17b06ff5e1bd52b0c6bb5cdd3 -->

Quality-pass refactor of `gtd summary --slice`: one edge call replaces three,
and the version warning now survives every refusal. No risk found.

## Scenarios

- [ ] ./tests/integration/features/summary-slice.feature#442-486 — **unknown
      slice name on a process closed by another gtd version (0.0.1): exit 1,
      empty stdout, and the version warning reaches stderr before the "no slice
      named" refusal.** Before this, the refusal threw before the warning
      printed.

## One summary entry point

`summaryFor(run, sliceName?)` now does the whole job: checks for a `summary`
template first, replays only for a named slice, and returns
`{ prompt, versionWarning?, unknownSlice? }`. `hasSummary` and `summarySlice`
are gone from the edge's public surface. Unknown slice is data, not a failure,
so the CLI prints the warning first, then refuses.

- [ ] ./src/edge/Edge.ts#1477-1490 — `narrowToSlice` drops its "slice outside
      the process" guard and the `undefined` return. Safe now: `locateSlice` is
      the only producer of a slice and builds it from the same `run`, so the
      mismatched pair the guard caught cannot occur.
- [ ] ./src/edge/Edge.ts#1491-1534 — new `SummaryResult`, `humanCommitsOf`,
      `summaryInput` (template input, slice-narrowed range/human commits/cost;
      `entryCommit` and `marks` stay whole-process), and `locateSlice` (replays,
      returns slice or `unknownSlice` message, carrying the warning either way).
- [ ] ./src/edge/Edge.ts#1537-1581 — `summaryFor` orchestration. Order kept: no
      template → `prompt: undefined` before any replay; plain call on empty
      trace → `prompt: undefined`; named slice on empty trace → replay refuses
      "HEAD neither closes nor sits inside a process". Plain call never replays,
      so config drift does not block it.
- [ ] ./src/cli/Program.ts#329-349 — CLI collapses to: call `summaryFor`, warn,
      fail on `unknownSlice`, fail on missing prompt, write.
- [ ] ./src/edge/index.ts#12-18 — `hasSummary`, `summarySlice` unexported.

## Version warning on replay refusals

- [ ] ./src/edge/Edge.ts#1713-1734 — `replayFinishedProcess` reads the recorded
      version before the drift check and appends the warning to both refusals
      (config differs, replay did not end). **Behaviour change beyond summary:
      `gtd slices` and `gtd history show` refusals now also carry the warning
      line** — untested for those two commands, only via `summaryFor`.
- [ ] ./docs/cli.md#430-434 — lists `gtd summary --slice` among the commands
      that print the version WARNING.

## Small cleanups

- [ ] ./src/edge/Edge.ts#909-913 — `costTotals` extracted; shared by `restAt`
      and `summaryInput`.
- [ ] ./src/edge/Edge.ts#1071-1071 — `restAt` uses `costTotals`.
- [ ] ./src/edge/Edge.ts#1100-1113 — `replayedSlices` takes the loaded `config`
      instead of loading it again; callers already hold it.
- [ ] ./src/edge/Edge.ts#1154-1154 — `processSlices` passes its `config`.
- [ ] ./src/edge/Edge.ts#1170-1170 — `summarySlice` deleted (logic moved to
      `locateSlice`).
- [ ] ./src/workflows/shared/text.ts#1039-1039 — comment now names the exact
      line `claude/hooks/ship.ts` regex-reads.

## Tests

- [ ] ./src/edge/Edge.test.ts#765-830 — suite renamed to `summaryFor`; `render`
      takes a slice name; `sliceOf` helper removed.
- [ ] ./src/edge/Edge.test.ts#839-904 — existing narrowing/cost/marks cases
      ported to slice names; the "exact slice passes through" assertion dropped
      with the slice parameter.
- [ ] ./src/edge/Edge.test.ts#885-892 — empty trace: named slice refuses with
      the full "HEAD neither closes nor sits inside a process" text; plain call
      returns `{ prompt: undefined }`.
- [ ] ./src/edge/Edge.test.ts#921-974 — new: divergence refusal under 0.0.1
      carries the warning; edited config without `summary` returns no prompt,
      not a failure; plain call ignores config drift.
- [ ] ./src/edge/Edge.test.ts#981-1004 — version warning kept with a prompt;
      unknown slice returns `unknownSlice` listing "build, verify" plus the
      warning.
- [ ] ./src/edge/Edge.test.ts#1009-1033 — new `restAt` case pins cost total (11)
      and per-model breakdown, highest first — covers the `costTotals`
      extraction.
