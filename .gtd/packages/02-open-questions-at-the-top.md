# 02 — Open questions sit at the top of the plan screen and read as the thing to act on

## Requirement

Open questions are buried. `PlanBody` renders every non-question block of the
document first, then the "Open Questions" section, then "Already answered". A
real plan is long, so on a phone the questions are several screens down — past
every heading, list and code block the document happens to carry. The one thing
the human is there to do is the one thing they have to scroll to find.

Three changes, together:

- Open questions go to the top of the screen, above the document prose. The
  document is reference material; the questions are the task. The "Read the
  plan" confirmation row stays first, above the questions — it is the gate on
  answering, not part of the document.
- Open questions are visually distinct from both the prose and the answered
  ones, at a glance, without reading the heading text. The document prose stays
  fully rendered below them; nothing is collapsed or hidden behind a toggle.
- Answered questions stay where they are, below the prose — they are history,
  not work.

This also settles an ordering bug the current layout hides. `blockNodesOf` emits
every top-level block in document order — before the questions section, between
the two question sections, and after them both — but `PlanBody` filters every
non-question node into one list rendered above both sections, so prose that sat
between or after the sections is silently hoisted out of document order. The
comment above that filter still claims these nodes are "everything before
`## Open Questions`" and is now wrong — fix the comment with the layout.
Whatever layout this concern lands, the prose blocks it renders must stay in
document order relative to each other.

The card-index invariant holds through the move: a question card's start index
must stay its position in the same open-question list the deck is fed, or
tapping a card opens the deck at the wrong question. Reordering sections must
not become reordering that list.

## Task 1 — Reorder `PlanBody` to open questions, prose, answered questions

`PlanBody` keeps its three derived lists (`openNodes`, `answeredNodes`, and the
non-question `planNodes`) and only reorders the JSX: open `QuestionSection`
first, `ProseBlocks` second, answered `QuestionSection` last. The "Read the
plan" row stays above all three, in `PlanView`'s own `CardList`. The prose-only
branch — no question nodes at all — is byte-unchanged.

Prose order is safe by construction: `questionsView` in `src/OpenQuestions.ts`
builds `nodes` as every `blockNodesOf` node in document order followed by every
question node, so filtering the non-question nodes into one list preserves their
document order relative to each other. The stale comment above that filter,
claiming the nodes are "everything before `## Open Questions`", is replaced with
what the view actually emits — not moved.

Nothing collapses: the prose renders in full between the two question sections.

Paths: `src/web/screens/Plan.tsx`, `src/web/screens/Plan.stories.tsx`.

- [ ] a story on a plan carrying a heading, prose before the questions section,
      one open question, one answered question and a trailing paragraph asserts
      the open question renders above the prose
- [ ] that same story asserts the answered question renders below the prose
- [ ] that same story asserts the trailing paragraph renders after the preceding
      prose, not before it
- [ ] a prose-only plan (no question nodes) renders exactly as it does today
- [ ] the stale "everything before `## Open Questions`" comment is gone, not
      relocated

## Task 2 — Keep the card-index invariant, proved on the last open question

A question card's start index must be its position in the same list `PlanView`
feeds `Deck`. Both stay one filter — `status === "open"` over `view.nodes` in
view order. `QuestionSection` keeps `allNodes={openNodes}` for the open section
and `allNodes={answeredNodes}` for the answered one. Moving a section is moving
JSX, never re-deriving either list.

Paths: `src/web/screens/Plan.tsx`, `src/web/screens/Plan.stories.tsx`.

- [ ] a story taps the LAST open-question card on a plan that also carries an
      answered question and asserts the deck opens on that question, not another
- [ ] the deck's progress indicator counts only open questions, unchanged
- [ ] an answered question card stays inert — no drill-in, never a deck item

## Task 3 — An accent treatment that marks open cards and touches no other card

`Card` in `src/web/Card.tsx` gains one optional boolean prop that appends a left
accent rule plus the `surface` background to its existing classes. Absent, the
rendered classes are unchanged, so review and fleet cards are provably
untouched. Open question cards pass it; answered rows keep the inert, muted
`opacity-[0.85]` row they render today. No new heading, no badge, no new colour
token — `--color-accent` already exists and is already asserted at 3:1 against
`page`.

Open cards now paint body text on `surface`, so `src/web/tokens.test.ts` gains
one assertion for that pair at the 4.5:1 AA body threshold. That file's contract
is that a palette pair in use is a pair under test.

Paths: `src/web/Card.tsx`, `src/web/Card.stories.tsx`, `src/web/tokens.test.ts`,
`src/web/screens/Plan.stories.tsx`.

- [ ] an open question card renders the accent treatment and an answered one
      does not, asserted in a story without reading heading text
- [ ] a `Card` rendered without the new prop produces the exact class list it
      produces today
- [ ] `tokens.test.ts` asserts text on `surface` clears 4.5:1
- [ ] `npm test` green
