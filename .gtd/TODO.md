## Deferred review notes (836985b)

- note-3 — flaky.[^stdout] (could): Restore `expect(captured().stdout).toBe("")`
  in the garbled-flag CLI test; dropping it weakens the test with no reason.

## Deferred review notes (daed27f)

- note-2 — output.[^weak] (could): Please strengthen this scenario: finish a
  process that kept a tip, then assert `gtd history list` shows only the
  finished process and never the kept ref.

## Deferred review notes (b1f315c)

- note-1 — `it.vars.flagRegistry`, `""` when unset. [^empty] (could): Wrong: an
  empty registry is not harmless.
  `git grep -n alpha -- ':(top)' ':(top,exclude,literal)'` in a repo with a
  tracked file holding `alpha` prints nothing (exit 1), while the same command
  without the exclude prints `a:1:alpha` — the empty literal exclude excludes
  everything (git 2.54). Fall back to `src/flags/index.ts` (the default
  `flagShipped` uses) when `flagRegistry` is unset or empty, as the plan said,
  and add a unit test with no `flagRegistry` var that runs the hint and still
  finds a tracked match.
