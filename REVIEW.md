# Review: 1a09822

<!-- base: 1a09822e1d276ec6efa6462f03040ca347fa7695 -->

## Write sentinel for empty failure output

A red test gate with empty or whitespace-only captured output (e.g. a command
that exits non-zero but prints nothing) previously wrote an empty FEEDBACK.md.
That collides with the agentic-review convention where whitespace-only FEEDBACK
(`feedbackEmpty`, Events.ts#269) signals deliberate approval, so an empty red
gate would mis-route to close-package instead of Fixing. The guard now writes a
fixed sentinel string whenever `result.output` has no non-whitespace, keeping
empty FEEDBACK reserved exclusively for the approval signal. Correct fix at the
right edge — the write site, not the machine.

- [ ] ./src/Events.ts#34
- [ ] ./src/Events.ts#436

## Unit tests for sentinel write

Three unit tests cover the new branch: red under cap (FEEDBACK present,
non-empty, contains sentinel), red at cap (ERRORS present + sentinel, FEEDBACK
absent), and whitespace-only output (sentinel, not empty). Targets the exact
under-cap/at-cap split and the whitespace case that distinguishes this from the
existing content path.

- [ ] ./src/Events.test.ts#611
- [ ] ./src/Events.test.ts#625
- [ ] ./src/Events.test.ts#639

## Integration scenario for routing

End-to-end feature scenario asserts a no-output red gate commits `gtd: errors`
then `gtd: fixing` (routes to Fixing) rather than landing on Close package /
`gtd: package done`. This is the behavioral regression the sentinel prevents,
verified through the real driver loop rather than only at the write site.

- [ ] ./tests/integration/features/testing.feature#66

## Document the sentinel in README

README Testing-row and the red-path narrative now note that empty/whitespace
captured output yields a sentinel so FEEDBACK/ERRORS is never empty, and restate
that empty FEEDBACK stays reserved for agentic-review approval. Matches the
CLAUDE.md rule to reflect significant changes in the README.

- [ ] ./README.md#232
- [ ] ./README.md#264
