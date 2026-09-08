# Spec feedback: 03 — the client opens on the step

The previous round's defect is fixed: `Question.tsx`'s free-text focus is
local-only (`selectLocally`) and `commitFreeText` bails on empty text, with
`Plan.stories.tsx`'s
`RealContainerFocusingAndBlurringFreeTextWithNoTypingSendsNoWrite` asserting
zero `setValue` calls. Everything else in the package checks out: `apply` is
mandatory with radio/hunk/chunk semantics and `anchor-not-found` refusals,
`writeValue` reuses `verifyForWrite` and adds no refusal reason, `setValue`
takes no `worktreePath` and throws the same `WriteNoteRefusal`,
`Fleet.tsx`/`Fleet.stories.tsx`/the "← Fleet" button are gone, both
`HandedBackPanel`s are terminal, the chunk check-all is exactly one `setValue`
call, the on-disk scenario and both reload-survival stories exist, and
`npm test` (all 10 turbo tasks, `test:web` included) is green.

One defect.

## A story name still asserts the deleted fleet navigation

`src/web/App.stories.tsx:58`

`export const TappingAReviewModeRowNavigatesToReview` names a row tap in a fleet
list — the exact affordance this package deletes. Nothing taps: the `play()`
body only waits for `review-screen` to appear, and its own doc comment says the
story exists to prove `mode: "review"` picks `Review`. The name is the last
surviving reference to the fleet screen in `src/`, and it reads as "navigation
exists" to anyone scanning the storybook run — against T3's own "no fleet route
reachable" acceptance bullet.

Rename only, to what the story actually does (e.g.
`ReviewModeOpensDirectlyOnTheReviewScreen`). No behavior change, no other file.
