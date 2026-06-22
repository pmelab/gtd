# Add the `close-review` leaf, guard, and RESOLVE transition (ordered first)

Wire the new terminal `close-review` leaf into the pure machine. The transition
MUST precede `reviewModified → review-process`, because a forward-tick-only edit
also sets `reviewModified` true — close-review must win the priority race.

## Files

- `src/Machine.ts`
  - `LeafState` union (`:67-78`) — add `"close-review"`.
  - `guards` (`:94-106`) — add a `reviewApprovedNoChanges` guard.
  - RESOLVE transition array (`:135-190`) — insert the `close-review` branch as
    the FIRST entry, before the `reviewModified → review-process` branch
    (currently `:136-140`).
  - `states` map (`:193-204`) — register
    `"close-review": { tags: ["auto-advance"], type: "final" }`.
- `src/Machine.test.ts` — add unit cases (harness `basePayload` / `resolveEvent`
  at `:6-25`; `basePayload` must already include `reviewApprovedNoChanges: false`
  — add it there so existing cases keep compiling).

## Implementation notes

- Guard: `reviewApprovedNoChanges: (_, params: ResolvePayload) => params.reviewApprovedNoChanges`
  (mirror `reviewModified` at `:95`).
- Transition entry (insert as the first element of the RESOLVE array):
  ```ts
  {
    guard: { type: "reviewApprovedNoChanges", params: ({ event }) => event.payload },
    target: "close-review",
    actions: "applyPayload",
  },
  ```
- State registration: `"close-review": { tags: ["auto-advance"], type: "final" }`
  so the loop auto-re-runs after the close commit lands (parity with
  `review-process` at `:193`).
- Depends on the `ResolvePayload.reviewApprovedNoChanges` field. Task 02 owns
  that field, but tasks in a package run in parallel — add the field to
  `basePayload` here defensively if it is not yet present so this task's tests
  compile in isolation; the two edits to the same interface must be identical.
  (If a merge conflict on `ResolvePayload` arises, the field declaration is the
  single source of truth from task 02.)

## Unit test cases (Machine.test.ts)

- [ ] `reviewApprovedNoChanges: true` → resolves to `"close-review"` with
      `autoAdvance === true`.
- [ ] Ordering regression: `reviewApprovedNoChanges: true` AND
      `reviewModified: true` → still `"close-review"` (close wins over
      review-process).
- [ ] `reviewApprovedNoChanges: false` AND `reviewModified: true` → still
      `"review-process"` (unchanged behavior).
- [ ] Add `reviewApprovedNoChanges: false` to `basePayload` so all existing
      cases keep passing.

## Acceptance criteria

- [ ] `LeafState` includes `"close-review"`.
- [ ] `close-review` guard + transition added, ordered BEFORE `review-process`.
- [ ] `close-review` registered as a final state tagged `auto-advance`.
- [ ] All new and existing `Machine.test.ts` cases pass.
