## Deferred review notes (836985b)

- note-3 — flaky.[^stdout] (could): Restore `expect(captured().stdout).toBe("")`
  in the garbled-flag CLI test; dropping it weakens the test with no reason.

## Deferred review notes (daed27f)

- note-2 — output.[^weak] (could): Please strengthen this scenario: finish a
  process that kept a tip, then assert `gtd history list` shows only the
  finished process and never the kept ref.

## Deferred review notes (eda53bb)

- note-1 — warning comes before any refusal.[^jsdoc] (could): The
  `runSummaryCommand` doc comment still lists only the two plain refusals. Add
  the `--slice` ones, short: unknown slice name (valid slices listed), config
  edited since a closed process, diverged replay.
