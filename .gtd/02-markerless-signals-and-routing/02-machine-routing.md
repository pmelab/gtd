# Route on the new signals + add the `review-incomplete` leaf (`src/Machine.ts`)

Swap the `ResolvePayload` fields, add the new `review-incomplete` terminal leaf
and its guard, and re-order the review branch of the `RESOLVE` transition array.

## Context

`src/Machine.ts` is the pure xstate fold. Today the review branch is:
`errorsPresent → reviewApprovedClose (reviewApprovedNoChanges && !bangPresent) →
codeDirty → reviewModified → reviewUnmodified → …`.

## What to do

1. **`ResolvePayload` field swap** (interface ~line 30–66):
   - Remove `readonly reviewApprovedNoChanges: boolean` and `readonly
     bangPresent: boolean` (with their doc comments).
   - Add `readonly reviewHasUncheckedBoxes: boolean` — working-tree REVIEW.md has
     at least one `^- \[ \] ` line.
   - Add `readonly reviewHasRealFeedback: boolean` — a working-tree delta beyond
     forward checkbox ticks (non-tick REVIEW.md edits, dirty source, untracked).

2. **Add the `review-incomplete` leaf**:
   - Add `"review-incomplete"` to the `LeafState` union.
   - Add the state entry `"review-incomplete": { type: "final" }` — a TERMINAL,
     NON-`auto-advance` leaf, like `await-review` (do NOT give it the
     `auto-advance` tag).

3. **Guards** (in the `guards` block):
   - Rename `reviewApprovedClose` → `closeReview` and change its body to:
     `params.reviewModified && !params.reviewHasUncheckedBoxes &&
     !params.reviewHasRealFeedback`. Drop the `&& !params.bangPresent` clause and
     the old `reviewApprovedNoChanges` reference. Update its doc comment to
     "all boxes checked + no real feedback".
   - Add a new guard `reviewIncomplete`:
     `params.reviewModified && params.reviewHasUncheckedBoxes`.
   - Keep `reviewModified`, `reviewUnmodified`, and the `codeDirty`
     (`params.codeDirty && !params.reviewPresent`) guards unchanged.

4. **Re-order the `RESOLVE` transition array** review branch. The required final
   order for the review-related guards (within the existing overall array, after
   `errorsPresent` and the `codeDirty` placement unchanged):
   - `reviewUnmodified` → `await-review` (untouched gate). MUST be checked
     **before** `reviewIncomplete`.
   - `reviewIncomplete` (`reviewModified && reviewHasUncheckedBoxes`) →
     `review-incomplete`. Unchecked-boxes gate wins **before** the feedback
     check — even if real feedback is also present.
   - `closeReview` (`reviewModified && allChecked && !reviewHasRealFeedback`) →
     `close-review`.
   - `reviewModified` (now reachable only when allChecked + real feedback) →
     `review-process`.

   Keep the relative placement of `errorsPresent` (first) and the `codeDirty`
   transition exactly as today (the `reviewPresent` suppression is unchanged).
   Ensure `reviewUnmodified` precedes `reviewIncomplete`, and `reviewIncomplete`
   precedes `closeReview` precedes `reviewModified`.

## Tests (same task — `src/Machine.test.ts`)

- Update the shared `basePayload` fixture: drop `reviewApprovedNoChanges: false`
  and `bangPresent: false`; add `reviewHasUncheckedBoxes: false` and
  `reviewHasRealFeedback: false`.
- DELETE the `"approved review with a !! comment diverts to review-process,
  not close"` case.
- Replace the old `reviewApprovedNoChanges` cases with the four pinned review
  outcomes:
  - [ ] `reviewUnmodified: true` → `await-review`.
  - [ ] `reviewModified: true, reviewHasUncheckedBoxes: true` →
        `review-incomplete` (autoAdvance false).
  - [ ] `reviewModified: true, reviewHasUncheckedBoxes: false,
        reviewHasRealFeedback: false` → `close-review` (autoAdvance true).
  - [ ] `reviewModified: true, reviewHasUncheckedBoxes: false,
        reviewHasRealFeedback: true` → `review-process` (autoAdvance true).
- Add an ordering regression:
  - [ ] `reviewModified: true, reviewHasUncheckedBoxes: true,
        reviewHasRealFeedback: true` → `review-incomplete` (unchecked-boxes wins
        over real feedback).
- Update any other case in the file that referenced `reviewApprovedNoChanges`/
  `bangPresent` (e.g. the `reviewPresent + reviewModified + codeDirty →
  review-process` case sets `reviewApprovedNoChanges: false` — replace with the
  new fields so it still routes to `review-process`, i.e.
  `reviewHasUncheckedBoxes: false, reviewHasRealFeedback: true`).

## Acceptance criteria

- [ ] `ResolvePayload` has `reviewHasUncheckedBoxes` + `reviewHasRealFeedback`,
      no `reviewApprovedNoChanges`/`bangPresent`.
- [ ] `review-incomplete` leaf added (terminal, non-auto-advance) to `LeafState`
      and the states map.
- [ ] `closeReview` + `reviewIncomplete` guards as specified; review-branch order
      is `reviewUnmodified → reviewIncomplete → closeReview → reviewModified`.
- [ ] `src/Machine.test.ts` updated: fixture swap, `!!` case deleted, four
      outcomes + unchecked-wins ordering regression pinned.
- [ ] `npm run test` green.

## Files

- `src/Machine.ts`
- `src/Machine.test.ts`

## Constraints / edge cases

- This task touches ONLY `src/Machine.ts` and `src/Machine.test.ts`
  (file-disjoint from the Events task and the Prompt task in this package).
- Adding `"review-incomplete"` to `LeafState` makes `SECTIONS: Record<LeafState,
  string>` in `Prompt.ts` require the key — that key is added by task 03 of THIS
  package (`src/Prompt.ts`), so the package compiles green only once all three
  tasks land. Expected and correct.
- Do NOT change exit-code behavior here; `review-incomplete` is exit 0 (a human
  gate), enforced by it NOT being in any test-gate / error path in `main.ts`.
