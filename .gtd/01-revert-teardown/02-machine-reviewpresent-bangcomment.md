# Machine.ts: add `reviewPresent` gate, drop `BangComment`/`bangComments`

Two coupled changes to the pure machine, both landing in `src/Machine.ts` (+ its
unit tests). They MUST be the same task because both edit `Machine.ts` — keeping
them in one task avoids a same-file collision with any sibling task.

This task owns BOTH `src/Machine.ts` and `src/Machine.test.ts`.

## Files (exclusive to this task)

- `src/Machine.ts`
- `src/Machine.test.ts`

## What to do — `src/Machine.ts`

### Q2 — `reviewPresent` gates `codeDirty`

- Add a new boolean field to `ResolvePayload` (alongside the other review
  booleans, ~41-63):

  ```ts
  /** A REVIEW.md is present (committed and/or dirty) — the review path owns routing. */
  readonly reviewPresent: boolean
  ```

- Change the `codeDirty` guard (~line 129) from
  `(_, params: ResolvePayload) => params.codeDirty`
  to
  `(_, params: ResolvePayload) => params.codeDirty && !params.reviewPresent`.

- DO NOT reorder the RESOLVE guard array. Order stays:
  errorsPresent → reviewApprovedClose → codeDirty → reviewModified →
  reviewUnmodified → … . Effect: with a REVIEW.md present, `codeDirty` is inert
  and the review branches below take over (or hold at `await-review`); with no
  REVIEW.md, `reviewPresent` is false and `codeDirty` behaves exactly as before.

### Q1 — delete `BangComment` / `bangComments`

- Remove the `BangComment` interface (~16-21).
- Remove the `bangComments?` field from `ResolvePayload` (~71).
- Remove the `bangComments?` field from `GtdContext` (~87).
- Remove the `bangComments` spread line in `applyPayload` (~169):
  `...(p.bangComments !== undefined ? { bangComments: p.bangComments } : {}),`.
- KEEP `bangPresent` (~61) and the `reviewApprovedClose` guard
  `params.reviewApprovedNoChanges && !params.bangPresent` (~125-126) unchanged.

## What to do — `src/Machine.test.ts`

- Add `reviewPresent: false` to the `basePayload` default (next to
  `bangPresent: false`, ~line 18).
- Keep the existing `bangPresent` routing test (~167-171).
- Add the two Q2 traced scenarios:
  1. **note + dirty source → `review-process`** (NOT `code-changes`):
     ```ts
     resolveEvent({
       reviewPresent: true,
       reviewModified: true,
       reviewApprovedNoChanges: false,
       codeDirty: true,
     })
     ```
     expect `value` toBe `"review-process"`.
  2. **committed-unmodified review + dirty source → `await-review`**:
     ```ts
     resolveEvent({
       reviewPresent: true,
       reviewUnmodified: true,
       codeDirty: true,
     })
     ```
     expect `value` toBe `"await-review"`.
- Add a guard-regression test confirming the non-review path still works:
  `resolveEvent({ codeDirty: true, reviewPresent: false })` → `"code-changes"`.
  (The existing `codeDirty → code-changes` test at ~73 will keep passing because
  `basePayload` defaults `reviewPresent` to false; an explicit
  `reviewPresent: false` test makes the gate intent clear.)

## Constraints

- No `bangComments` or `BangComment` reference may remain in either file.
- Guard array ORDER unchanged.
- `npm run test` must pass.

## Acceptance criteria

- [ ] `ResolvePayload.reviewPresent: boolean` exists; `codeDirty` guard reads
      `params.codeDirty && !params.reviewPresent`.
- [ ] `BangComment` interface, `ResolvePayload.bangComments`,
      `GtdContext.bangComments`, and the `applyPayload` `bangComments` spread are
      all deleted.
- [ ] `bangPresent` and the `reviewApprovedClose` guard are unchanged.
- [ ] `basePayload` includes `reviewPresent: false`.
- [ ] New tests: note+dirty → `review-process`; unmodified-review+dirty →
      `await-review`; the `bangPresent` divert test still passes.
- [ ] No `bangComments`/`BangComment` reference remains in `src/Machine.ts` or
      `src/Machine.test.ts`.
