# Spec feedback — 01 — End the turn from the plan screen itself

The implementation in `src/web/screens/Plan.tsx` matches the requirement: footer
row is a sibling after the scroll container, in normal flow, rendered only when
`onDone` is defined, click discards the promise, deck untouched. `npm test` is
green (151 storybook tests pass). The gaps are all in the criteria's own
assertions.

## 1. The unticked-open-question story never asserts `done` fires

Criterion: "a story taps `plan-done` on a plan carrying an unticked open
question and asserts the same empty-input `done` fires on that single tap, with
no confirmation element rendered in between."

`TappingPlanDoneWithAnUnansweredOpenQuestionEndsTheTurnOnOneTap`
(`src/web/screens/Plan.stories.tsx:1018`) passes
`onDone: () => Promise.resolve()` — nothing records the call — and asserts only
`queryByRole("dialog")` is absent. The "empty-input `done` fires on that single
tap" half is asserted nowhere, for this shape or any other open-question shape.
The story passes identically if the button's `onClick` were removed.

Record the call (counter or the `PlanDoneCallRecorder` pattern) and assert it
fired exactly once with `{}`.

## 2. Dead counter in the prose-only story — it asserts nothing about the tap

`TappingPlanDoneOnAProseOnlyPlanEndsTheTurnWithNoNote`
(`src/web/screens/Plan.stories.tsx:989`) declares `let calls = 0` and increments
it inside `onDone`, then never reads it. The play function asserts only that
`plan-done` is in the document and clicks it. The story's name promises an
assertion it does not make, and the variable is dead.

Criterion 1 itself IS met, by
`RealContainerTapsPlanDoneFromTheListRendersHandedBackPanel` (prose-only view,
`done` input asserted `{}`, handed-back panel asserted). So either assert on
`calls` here or drop the dead counter.

## 3. Criterion 6's "no `writeNote`, no `setValue`" guard is unfalsifiable

`RealContainerTapsPlanDoneFromTheListRendersHandedBackPanel:1088` guards with a
`writeNote` resolver that throws. A thrown resolver becomes `observer.error`
(`src/web/testing/TrpcTestProvider.tsx:45`), which `PlanView`'s own `.catch`
swallows into the refusal banner — the story asserts neither the banner's
absence nor the throw, so a spurious `writeNote` call would still leave every
assertion green. `setValue` is not mocked at all, so its half of the criterion
has no check whatsoever (an unmocked path also only produces a rejection, not a
failure).

Make it bite: assert `queryByTestId("refusal-banner")` is absent after the tap,
and record `writeNote`/`setValue` invocations into the same `done-calls`-style
DOM node so a stray call is asserted `0`.

## 4. Stale doc comment on `PlanViewProps#onDone`

`src/web/screens/Plan.tsx` — the `onDone` doc comment still reads "Passed
straight to `Deck`'s own `onDone`, which is what actually renders the button."
That is now wrong: the same prop also gates and drives the `plan-done` footer
row. A reader trusting it looks in the wrong file.
