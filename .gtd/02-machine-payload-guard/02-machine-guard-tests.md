# Unit tests for the `reviewCheckboxOnly` guard

Add/adjust tests in `src/Machine.test.ts` for the new Done-routing guard.

## Context

`src/Machine.test.ts:~42` has a local test `defaultPayload`. Adding the new
field to `ResolvePayload` (sibling task) requires this test payload to include
it, or typecheck/tests break. This file is separate from `src/Machine.ts`, so it
runs in parallel with the implementation task.

## Implementation

1. Add `reviewCheckboxOnly: false` to the test `defaultPayload` (~line 42).
2. New test case: `reviewPresent + reviewDirty + reviewCheckboxOnly: true`
   asserts `state: "done"` and `edgeAction { kind: "done" }`.
3. Keep / verify the existing `reviewDirty` (non-checkbox,
   `reviewCheckboxOnly: false`) → `accept-review` case still passes.
4. Verify `reviewCommitted` → done case is unaffected.

## Acceptance criteria

- [ ] Test `defaultPayload` includes `reviewCheckboxOnly: false`
- [ ] New case: `reviewDirty + reviewCheckboxOnly` → `done` +
      `edgeAction { kind: "done" }`
- [ ] Existing `reviewDirty` (non-checkbox) → `accept-review` case still passes
- [ ] Full test suite is green
