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

## Deferred review notes (15386cd)

- note-1 — - [ ] ./docs/driver.md#396-399 [^docs-closed] — Risk: still says a
  merged or (could): Fix the doc as the item says: offer `GTD_SHIP_MODE=commits`
  only for a merged or closed lower slice's pull request, and say a merged or
  closed top pull request needs a renamed branch. Also mention that a
  commits-mode re-ship of a stacked branch retargets its pull request to the
  default branch and leaves the lower slice pull requests open.
