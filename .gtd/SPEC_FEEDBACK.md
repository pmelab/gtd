# Spec feedback — 02 Open questions at the top

## Task 3 — the open-vs-answered accent criterion is not asserted anywhere

Criterion: "an open question card renders the accent treatment and an answered
one does not, asserted in a story without reading heading text". Nothing in
`src/web/screens/Plan.stories.tsx` asserts it —
`grep -n accent src/web/screens/Plan.stories.tsx` matches only line 942, a
comment about `Notice`'s error border.

What exists instead is `Card`-level only:
`CardWithAccentPropRendersTheAccentTreatment` and
`CardWithoutAccentPropIsUnchanged` in `src/web/Card.stories.tsx` prove the
`accent` prop's own two class lists. Neither touches `PlanBody`, so the wiring
the criterion is about — `QuestionCard` passing `accent` on the open path and
the answered path rendering the inert `opacity-[0.85]` row without it
(`Plan.tsx` lines 86-96) — is untested. Deleting `accent` from `Plan.tsx:94`
leaves the whole suite green.

Fix: add a story to `src/web/screens/Plan.stories.tsx` rendering a plan with one
open and one answered question, and assert on computed style of
`question-card-*` — the open card has `borderLeftWidth` `4px` and the `surface`
background, the answered one does not — reading no heading text.

The spec lists `src/web/screens/Plan.stories.tsx` in Task 3's own Paths; it is
the only Task 3 path that received no change.

## Everything else checks out

Tasks 1 and 2 and the remaining Task 3 criteria are met: the reorder, the
replaced comment, the in-document-order trailing paragraph story, the
last-open-card index story with the `2 / 2` progress assertion, the inert
answered card, the unchanged-class-list story, `tokens.test.ts:85` on
text/`surface` at 4.5:1, and `npm test` green.
