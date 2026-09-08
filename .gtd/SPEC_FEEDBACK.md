# Spec feedback: 03-client-opens-on-the-step

Server side (`SteeringFormat.apply`, `writeValue`, the `setValue` procedure) and
the Plan/Question answer write-through are done. Three spec areas are not.

## 1. Hunk and chunk ticks are still local-only in the real app

`src/web/screens/Review.tsx` — the `Review` container (bottom of the file)
declares `writeNote` and `done` mutations but **no `setValue` mutation**, and
renders `<ReviewView ... />` **without `onSetValue`**. `useReviewState`'s
`toggleChunk`/`setHunkChecked` therefore call `onSetValue?.(...)` on `undefined`
every time: a hunk tick writes nothing to disk and does not survive a reload.

The whole "Write hunk and chunk ticks through to disk" task fails on this one
missing wire — the plumbing beneath it (props, optimistic revert, one call per
chunk anchor) is already correct.

Also, the invalidation the spec asks for is absent: `Review` has no
`utils.readSteeringFile.invalidate({ filePath, mode: "review" })` on a
`setValue` settle (`Plan.tsx:442` shows the shape to copy).

## 2. Stale comment contradicting the shipped code

`src/web/screens/Review.tsx`, `useReviewState`'s doc comment: "Ticks are STILL
local/optimistic UI state only … there is no format-agnostic 'toggle' member on
`SteeringFormat` the way `annotate` is one — adding that … is a real design
decision". `SteeringFormat.apply` is exactly that member and now exists. The
spec's "the 'not wired to writeNote, a later package' comments are gone" bullet
is unmet in substance.

## 3. The "handed back" panel does not exist

Task "Show the human that the turn was handed back" is entirely unimplemented.
`Plan.tsx#Plan.onDoneNote` and `Review.tsx#Review.onDoneNote` both `.catch()`
and return; neither screen renders any terminal panel after `done` resolves, and
no such panel exists anywhere in `src/web` (grep for "handed back" hits only
tests). All three bullets are open.

## 4. Missing tests for the write-throughs

- No story anywhere mocks or asserts `setValue`
  (`grep -rn setValue src/web/**/*.stories.tsx` → nothing). The spec bullet
  "surviving stories' mock link answers `step` and `setValue`" is unmet, and
  both write-throughs — the answer one that IS wired, and the tick one that is
  not — are untested at the browser tier. `Plan.stories.tsx`'s real-container
  stories (`RealContainerWriteThroughsAParagraphNoteViaWriteNote`) are the
  pattern to mirror for `setValue`.
- No scenario asserts "an answer given in the UI is in the steering file on
  disk" — `tests/integration/features/ui.feature` and `ui-lifecycle.feature`
  cover only the `done`/`writeNote` note path (`ui-lifecycle.feature:97`).
  Acceptance names this scenario explicitly.
- Nothing asserts "an answer survives a page reload" or "a hunk tick survives a
  reload".
