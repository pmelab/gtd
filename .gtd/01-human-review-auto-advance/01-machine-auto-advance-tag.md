# Give the `human-review` leaf the `auto-advance` tag

Make `human-review` auto-advance instead of being a terminal STOP, so its
deferred edge commit (`commit-pending`) lands `REVIEW.md` **clean** in the same
session before the human can edit it — mirroring the `new-todo` / `modified-todo`
precedent. NO new machine logic: just add the tag.

This task owns BOTH the machine state declaration AND its unit-test assertion,
because adding the tag flips `autoAdvance` for the human-review resolution and
would otherwise break `Machine.test.ts`. They MUST change together so
`npm run test` (vitest) stays green for this task.

## Files (exclusive to this task)

- `src/Machine.ts`
- `src/Machine.test.ts`

## What to do — `src/Machine.ts`

- Line 484, the `human-review` leaf in the machine `states` map. Today:

  ```ts
  "human-review": { type: "final" },
  ```

  Change to (match the sibling producers on lines 481–482):

  ```ts
  "human-review": { tags: ["auto-advance"], type: "final" },
  ```

- Do NOT touch any guard, `resolveChain`, `commitActionForIntent`, or edge
  action. The plan verifies termination relies on existing guards only.

## What to do — `src/Machine.test.ts`

- The assertion at lines 233–243:
  `it("clean + reviewBasePresent + non-empty refDiff → human-review, autoAdvance false", …)`.
  Flip it to expect auto-advance now that the leaf carries the tag:
  - Rename the `it(...)` title from `autoAdvance false` to `autoAdvance true`.
  - Change `expect(autoAdvance).toBe(false)` to `expect(autoAdvance).toBe(true)`.
  - Keep `expect(value).toBe("human-review")` and the `resolveEvent({ ... })`
    inputs unchanged.

## Constraints

- Do NOT touch `src/prompts/human-review.md`, the feature files, the bundle, or
  README — those are sibling tasks / a later package.
- The prompt change and feature/README changes do NOT affect vitest (e2e is the
  separate `npm run test:e2e`), so this task is fully self-contained for green
  vitest.

## Acceptance criteria

- [ ] `src/Machine.ts` line 484 reads `"human-review": { tags: ["auto-advance"], type: "final" },`.
- [ ] No other leaf or guard in `src/Machine.ts` is changed.
- [ ] `src/Machine.test.ts` human-review assertion expects `autoAdvance` `true`
      and still expects `value` `"human-review"`.
- [ ] `npm run test` (vitest) is GREEN with only these two files changed.
