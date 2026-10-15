## Deferred review notes (836985b)

- note-3 — flaky.[^stdout] (could): Restore `expect(captured().stdout).toBe("")`
  in the garbled-flag CLI test; dropping it weakens the test with no reason.
