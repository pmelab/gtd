# Events.ts: `bangPresent` from `hasBangAdded`, set `reviewPresent`, drop `bangComments`

Migrate the edge to the boolean `hasBangAdded`, populate the new `reviewPresent`
payload field, and remove all `bangComments` plumbing. This is the only caller of
the methods changed in the Git task and consumes the new `ResolvePayload` field
from the Machine task — all three land in the SAME package/commit so they compile
together.

This task owns `src/Events.ts` exclusively. (Events.ts has no dedicated unit test
file; it is exercised by the cucumber e2e suite, which is covered by the prompt +
feature tasks in this package.)

## Files (exclusive to this task)

- `src/Events.ts`

## What to do — `src/Events.ts`

1. **Drop the `BangComment` import** (~line 3): change
   `import { type BangComment, type GitOperations, GitService } from "./Git.js"`
   to `import { type GitOperations, GitService } from "./Git.js"`.

2. **Replace the `bangComments` plumbing** in `gatherEvents`:
   - Remove the `let bangComments: ReadonlyArray<BangComment> = []` declaration
     (~252).
   - Replace (~265-266)
     ```ts
     bangComments = Option.isSome(reviewCommit) ? yield* git.grepBangAdded(reviewCommit.value) : []
     bangPresent = bangComments.length > 0
     ```
     with
     ```ts
     bangPresent = Option.isSome(reviewCommit) ? yield* git.hasBangAdded(reviewCommit.value) : false
     ```
   - Keep the `let bangPresent = false` declaration (~253) and the
     `const reviewCommit = yield* git.lastReviewCommit()` line (~264).

3. **Set `reviewPresent`** in the `ResolvePayload` literal (~326-351). The
   `reviewExists` value computed at ~254 is in scope at the payload literal. Add
   `reviewPresent: reviewExists,` to the payload (e.g. next to `bangPresent`).

4. **Remove the `bangComments` spread** in the payload literal (~350):
   delete `...(bangComments.length > 0 ? { bangComments } : {}),`.

## Constraints — do NOT change

- `codeEntries` / `codeDirty` (~212-215).
- `commitMessages` (~195), `computeReviewBase` / `lastReviewCommit` /
  `lastCloseCommit` (~107-171, ~264) — Q4 base bookkeeping is unaffected.
- The REVIEW.md base-ref parsing, `reviewModified` / `reviewUnmodified` /
  `reviewApprovedNoChanges` computation.
- No new git operations (Q3): do not add `revert`/`show`/`rm` here.

## Acceptance criteria

- [ ] No `BangComment` import or reference remains in `src/Events.ts`.
- [ ] `bangPresent` is set via `git.hasBangAdded(reviewCommit.value)`
      (boolean), with the `Option.isSome(reviewCommit)` guard preserved.
- [ ] No `bangComments` variable or payload spread remains.
- [ ] The payload literal includes `reviewPresent: reviewExists`.
- [ ] `codeDirty`, base bookkeeping, and review-approval computation are
      unchanged.
- [ ] `npm run test` passes.
