# Add `reviewCheckboxOnly` to ResolvePayload + Done-routing guard

Wire the new pure-decision input through the state machine in `src/Machine.ts`.
Per AGENTS.md this is a per-resolve guard input → a field on `ResolvePayload`,
NOT a Context tag.

## Context

- `src/Machine.ts:~113` — `ResolvePayload` (field near `reviewDirty`)
- `src/Machine.ts:~258` — `defaultPayload`
- `src/Machine.ts:~444-460` — the `p.reviewPresent` block where review routing
  happens (`reviewCommitted` → done, `reviewDirty` → accept-review, else →
  await-review)

The flag is a direct edge fact like `reviewDirty` — NO machine fold, NO
recomputation. It defaults `false`, so adding it leaves all existing behavior
unchanged (the new guard branch is inert until the edge sets it true in a later
package).

## Implementation

1. Add `reviewCheckboxOnly: boolean` to `ResolvePayload`, placed near
   `reviewDirty`, with a doc comment explaining: pending REVIEW.md change is a
   pure checkbox-state flip (`- [ ]` ↔ `- [x]`) and nothing else is dirty.
2. Add `reviewCheckboxOnly: false` to `defaultPayload`.
3. In the `p.reviewPresent` block, add a NEW branch BEFORE the `p.reviewDirty` →
   accept-review branch:

   ```
   if (p.reviewCommitted) → done                       // unchanged
   if (p.reviewDirty && p.reviewCheckboxOnly) → done    // NEW
   if (p.reviewDirty) → accept-review                   // unchanged
   else → await-review                                  // unchanged
   ```

   The new branch emits the SAME result shape as `reviewCommitted`:
   `state: "done"`, `edgeAction: { kind: "done" }`, `autoAdvance: true`.

## Acceptance criteria

- [ ] `ResolvePayload` has `reviewCheckboxOnly: boolean` with a doc comment
- [ ] `defaultPayload` sets `reviewCheckboxOnly: false`
- [ ] New guard branch: `reviewPresent && reviewDirty && reviewCheckboxOnly`
      routes to `state: "done"` with `edgeAction { kind: "done" }`,
      `autoAdvance: true`
- [ ] Existing branches unchanged: `reviewCommitted` → done, `reviewDirty`
      (non-checkbox) → accept-review, else → await-review
- [ ] Typecheck passes; full test suite is green
