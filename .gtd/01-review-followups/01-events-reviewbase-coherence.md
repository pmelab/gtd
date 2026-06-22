# Fix: keep `reviewBasePresent` and `refDiff` coherent in Events.ts

## Description

In `src/Events.ts`, `gatherEvents` currently sets
`reviewBasePresent = Option.isSome(reviewBase)` unconditionally, while `refDiff`
is only populated when the candidate diff is non-empty. This produces a
semantically inconsistent payload — `reviewBasePresent: true` together with
`refDiff: undefined` — whenever the review base resolves but its tree is
identical to HEAD (empty diff).

There is no state-transition bug today: the machine's `humanReview` guard is
`params.reviewBasePresent && (params.refDiff ?? "").trim().length > 0`, so the
empty-diff case already falls through to `verified`. This change makes the two
payload fields always agree, so the guard's two conjuncts can never disagree.

## What to build

Change the review-base block so `reviewBasePresent` starts as `false` and is set
to `true` only inside the non-empty-diff branch, alongside `computedBaseRef` and
`refDiff`.

Current code (around lines 208-219):

```ts
const reviewBase = yield* computeReviewBase(git)
const reviewBasePresent = Option.isSome(reviewBase)
let computedBaseRef: string | undefined
let refDiff: string | undefined
if (Option.isSome(reviewBase)) {
  const candidateDiff = yield* git.diffRef(reviewBase.value)
  if (candidateDiff.trim().length > 0) {
    computedBaseRef = reviewBase.value
    refDiff = candidateDiff
  }
}
```

Target shape:

```ts
const reviewBase = yield* computeReviewBase(git)
let reviewBasePresent = false
let computedBaseRef: string | undefined
let refDiff: string | undefined
if (Option.isSome(reviewBase)) {
  const candidateDiff = yield* git.diffRef(reviewBase.value)
  if (candidateDiff.trim().length > 0) {
    reviewBasePresent = true
    computedBaseRef = reviewBase.value
    refDiff = candidateDiff
  }
}
```

`reviewBasePresent` must change from `const` to `let`. The `payload` object that
references `reviewBasePresent` (around line 229) stays unchanged.

## Files

- `/Users/pmelab/Code/gtd/gtd/src/Events.ts` (the `gatherEvents` review-base block, ~lines 208-240)

## Constraints / edge cases

- Do NOT touch `computeReviewBase` — its `Option` return contract is unchanged.
- Do NOT change the machine guard in `src/Machine.ts`; the guard already handles
  both fields and stays as a defense-in-depth check.
- The non-empty-diff branch must set all three (`reviewBasePresent`,
  `computedBaseRef`, `refDiff`) together so they never diverge.

## Acceptance criteria

- [ ] `reviewBasePresent` is declared `let` and initialized to `false`.
- [ ] `reviewBasePresent` is set to `true` only inside the `candidateDiff.trim().length > 0` branch.
- [ ] When the review base resolves but the diff is empty/whitespace, the payload has `reviewBasePresent: false` and no `refDiff`.
- [ ] When the review base resolves with a non-empty diff, the payload has `reviewBasePresent: true`, `baseRef` set, and `refDiff` set.
- [ ] The machine guard in `src/Machine.ts` is unchanged.
- [ ] `npm run build` / typecheck passes and the existing test suite stays green.
