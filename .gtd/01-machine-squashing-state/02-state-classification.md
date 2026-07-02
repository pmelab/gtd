# State: classify `squashing` as prompt-bearing (NOT edge-only)

The `squashing` state is prompt-bearing: the driver stops on it and prints its
prompt (the agent then authors the message + runs the squash). It must NOT be in
`EDGE_ONLY_STATES`. This task updates `src/State.ts`'s doc comments as needed and
fixes `src/State.test.ts`, whose assertions hard-count the states and will break
the moment `"squashing"` enters the `GtdState` union (Package 01 task 01).

## Files

- `src/State.ts` (edit — likely doc-comment only; do NOT add `squashing` to the
  `EDGE_ONLY_STATES` set)
- `src/State.test.ts` (edit — update the enumerations and counts)

Do NOT touch `src/Machine.ts` (owned by task 01) or `src/Prompt.ts` (owned by
Package 02). Note: `Prompt.ts` has its *own* private `EDGE_ONLY_STATES` copy;
that mirror is updated in Package 02, not here.

## What to change in `src/State.ts`

- Leave `EDGE_ONLY_STATES` as the same six states — `squashing` is NOT edge-only.
- If a doc comment says "six edge-only states" vs the rest, keep it accurate; the
  edge-only count stays six, so the comment likely needs no change beyond
  ensuring it does not claim a total state count that is now stale.

## What to change in `src/State.test.ts`

This file pins the state classification and WILL fail to compile / run once the
union gains `"squashing"`. Update:

- `ALL_STATES` — add `"squashing"` (now 17 entries).
- `EXPECTED_EDGE_ONLY` — unchanged (still the six edge-only states).
- The `promptBearing` length assertion — currently `toHaveLength(10)`; it becomes
  `11` (17 total − 6 edge-only). Update the count and the accompanying comment
  ("the ten remaining states are all prompt-bearing" → eleven).
- Confirm `isEdgeOnly("squashing")` is `false` is exercised by the existing
  "false for every prompt-bearing state" loop (it will be, since `squashing` is
  in `promptBearing`).

## Acceptance criteria

- [ ] `EDGE_ONLY_STATES` in `src/State.ts` still contains exactly the six
      edge-only states (no `squashing`).
- [ ] `ALL_STATES` in `src/State.test.ts` includes `"squashing"` (17 total).
- [ ] The prompt-bearing length assertion is updated to 11 with matching comment.
- [ ] `npx vitest run src/State.test.ts` passes.
