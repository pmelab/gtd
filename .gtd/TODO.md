## Deferred review notes (836985b)

- note-3 — flaky.[^stdout] (could): Restore `expect(captured().stdout).toBe("")`
  in the garbled-flag CLI test; dropping it weakens the test with no reason.

## Deferred review notes (daed27f)

- note-2 — output.[^weak] (could): Please strengthen this scenario: finish a
  process that kept a tip, then assert `gtd history list` shows only the
  finished process and never the kept ref.
