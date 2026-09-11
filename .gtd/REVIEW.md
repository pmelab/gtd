# Review: e58b89b

<!-- base: 90ac5299ccc3f8079e435bd41536811fe2f80bf6 -->

Three changes to the phone web UI's plan screen: open-question cards get a
visual accent, open questions move above the plan prose, and the plan list
screen grows its own **Done** footer row. All product code lives in two files;
the rest is stories and one contrast test.

## Accent treatment on open-question cards

`Card` gains an optional `accent` prop that adds a 4px left rule plus the
`surface` background. Only the open-question path sets it, so an open question
reads as the thing to act on.

- [ ] ./src/web/Card.tsx#16 — new optional `accent?: boolean` prop with a doc
      comment naming which cards stay unaccented
- [ ] ./src/web/Card.tsx#25 — the two class lists are **written out in full,
      duplicated**, rather than composed from a shared base. Deliberate: the
      unaccented branch is pinned byte-identical by a story. Costs a long
      duplicated literal that must be edited twice.
- [ ] ./src/web/screens/Plan.tsx#94 — `QuestionCard` passes `accent` on the open
      branch only; the answered branch returns earlier and stays inert
- [ ] ./src/web/Card.stories.tsx#138 — asserts the no-accent className string
      exactly, so merely adding the prop cannot change existing rendering
- [ ] ./src/web/Card.stories.tsx#154 — asserts the accent treatment via computed
      style (`borderLeftWidth` 4px, `rgb(28, 28, 30)`), not by reading text
- [ ] ./src/web/screens/Plan.stories.tsx#125 — the same assertion one level up,
      so dropping `accent` from `Plan.tsx` fails here even with `Card`'s own
      stories green
- [ ] ./src/web/tokens.test.ts#85 — new gate: body text on `surface` must clear
      4.5:1. Needed because `surface` is now a **resting** background, not only
      the pressed state.

## Open questions render above the plan prose

The prose block moved below the Open Questions section. Open questions are the
task; the plan text is reference. The card-index invariant is untouched —
indices still come from the open-question list `Deck` is fed.

- [ ] ./src/web/screens/Plan.tsx#207 — comment corrected: `questionsView` emits
      **all** non-question nodes in document order, not just "everything before
      `## Open Questions`". The old comment was wrong about the data.
- [ ] ./src/web/screens/Plan.tsx#232 — the `planNodes` prose block now renders
      after `QuestionSection`, before the answered section
- [ ] ./src/web/screens/Plan.stories.tsx#152 — order story with heading, prose,
      open question, answered question and a trailing paragraph; asserts via
      `compareDocumentPosition` that the trailing paragraph is not hoisted above
      the earlier prose
- [ ] ./src/web/screens/Plan.stories.tsx#359 — guards the real risk of this
      move: tapping the last open card, with an answered question sorted
      between, still opens the deck on that question and the progress reads
      `2 / 2`

## Done control on the plan list screen

A footer row with a primary **Done** button, gated on `onDone`. Without it a
prose-only plan (no questions, so no deck) had no way to hand the turn back.

- [ ] ./src/web/screens/Plan.tsx#399 — the footer row renders only when `onDone`
      is defined; the click handler calls `onDone()` and drops the promise,
      matching the existing `deckDoneProps` pattern. Safe only because the
      container's `onDone` catches and never rethrows — a future caller that
      rethrows gets an unhandled rejection here.
- [ ] ./src/web/screens/Plan.tsx#136 — `onDone`'s doc comment rewritten: it now
      drives two controls, the deck's Done and this footer row
- [ ] ./src/web/screens/Plan.stories.tsx#1088 — **stale doc block.** This
      "Package 05 Task 1" comment describes the story at #1112 but sits directly
      on `PlanDoneCallCounter`, which has its own doc comment right below it.
      Two stacked JSDoc blocks on one const; the first belongs on the story or
      should be deleted.
- [ ] ./src/web/screens/Plan.stories.tsx#1112 — prose-only plan: one tap fires
      exactly one empty-input `done`
- [ ] ./src/web/screens/Plan.stories.tsx#1129 — same control with an open
      question still unanswered: one tap, no confirmation, no dialog
- [ ] ./src/web/screens/Plan.stories.tsx#1141 — `deck-done` unchanged; the
      deck's last-item label still reads "Back to list" and `plan-done` is
      absent while the deck is open
- [ ] ./src/web/screens/Plan.stories.tsx#1158 — no `onDone` prop means no
      control, matching every other optional callback
- [ ] ./src/web/screens/Plan.stories.tsx#1176 — real container: `done` fires
      with `{}`, `HandedBackPanel` renders, and `writeNote`/`setValue` are
      recorded as firing **zero** times rather than being thrown from, so a
      stray write shows up as a count instead of a refusal banner
- [ ] ./src/web/screens/Plan.stories.tsx#1238 — refused `done` from this control
      surfaces the existing refusal banner, keeps the plan screen up, never
      renders `HandedBackPanel`
- [ ] ./src/web/screens/Plan.stories.tsx#1285 — `PlanDoneCallRecorder` gains an
      optional second recorder for `writeNote`/`setValue`; every existing call
      site leaves it unset
