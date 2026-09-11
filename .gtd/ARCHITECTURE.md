# Architecture

Two packages, in build order, both landing entirely in the web client. Package
01 adds a control to the plan screen's shell; package 02 reorders the list that
shell scrolls. They touch the same two files but never the same hunks — 01 works
below `PlanView`'s scroll container, 02 works inside `PlanBody` — and the build
order is the one requirements already settled: the Done control is the human's
blocking complaint and touches no layout, so it goes first.

No server work in either package. `Router.ts#done`'s note-absent branch, the
`done` tRPC mutation and `ctx.handOff()` already carry the no-note hand-off end
to end; both packages are render and wiring only.

## 01 — A Done control on the plan screen itself

Primary paths: `src/web/screens/Plan.tsx`, `src/web/screens/Plan.stories.tsx`.

**The control is a `shrink-0` footer row, not a card in the list.** `PlanView`'s
list branch already returns a `flex h-full min-h-0 flex-1 flex-col` shell whose
only child is the scrolling `div`. The Done row becomes that div's sibling,
after it, exactly as `Deck.tsx#DeckControls` sits below `deck-content`: in
normal flow, never `fixed`/`sticky`, so it can never overlay the plan, and
inside the viewport for free because the column is exactly viewport-tall. A card
appended to the end of `CardList` would put the one control the human is there
to reach at the bottom of a long document — the same scroll-to-find failure
package 02 exists to kill.

**Wiring reuses the container's existing `onDone`.** `usePlanMutations#onDone`
already is `done.mutateAsync({})` with a `.catch` that calls `onRefusal` and
never rethrows; `Plan` already passes it into `PlanView`. This package renders
it. The click handler discards the promise (`onDone()` as a statement, never
awaited) for the reason `onDoneNote`'s own `.catch` exists: a rejection nobody
awaits is an unhandled rejection, and the catch is already inside the container.

**Test id is `plan-done`, distinct from `deck-done`.** The deck's own control
and its `doneLabel`/`advanceLabel` pairing in `deckDoneProps` are untouched —
`onDone` keeps flowing into `Deck` unchanged, so the last-item advance button
still reads "Back to list".

**The footer renders only when `onDone` is defined**, matching every other
optional callback on `PlanViewProps`, so `Plan.stories.tsx`'s pure-data stories
that pass no mutations render no Done button and assert nothing about one.

**Three screen states must keep excluding it.** The deck branch and the note
sheet branch both `return` before the list branch, so the footer cannot appear
next to `deck-done` or under the note sheet — that is an invariant of the early
returns, and any later refactor that flattens them breaks it. And `isDone` still
swaps the whole screen for `HandedBackPanel` in the container above `PlanView`,
which is what tells the human the process is exiting.

**Error handling**: a refused `done` surfaces through the existing
`RefusalBanner` via the container's `showRefusal`, and the screen stays alive
and editable. No compare-and-swap tokens are sent, because nothing is written.

**The risk stands and is accepted**: the control is unguarded, so a mistap on a
phone ends the turn with the plan half answered and there is no undo — the
process has already exited. No confirmation step, no disabled state while
questions are unticked.

**Acceptance**: a storybook play test taps `plan-done` on a prose-only plan and
asserts the recorded `done` input is exactly `{}` — no `note` key — using the
same `PlanDoneCallRecorder`/`TrpcTestProvider` shape
`RealContainerTapsDoneFromTheDeckWithNoNoteRendersHandedBackPanel` already uses,
and asserts `handed-back-panel` renders. A second taps it on a plan carrying an
unticked open question and asserts the same empty-input `done` fires on that
single tap with no intervening confirmation element. A third asserts `deck-done`
still behaves as today. `ui-lifecycle.feature`'s existing no-note handoff
scenario already proves the server half exits 0 and is not re-written here.

## 02 — Open questions at the top, and in document order below them

Primary paths: `src/web/screens/Plan.tsx`, `src/web/Card.tsx`,
`src/web/tokens.test.ts`, `src/web/screens/Plan.stories.tsx`.

**Render order inside `PlanBody` becomes: open questions, prose, answered
questions.** The "Read the plan" row stays above all three, in `PlanView`'s own
`CardList` — it gates answering, it is not part of the document. `PlanBody`
keeps its three derived lists (`openNodes`, `answeredNodes`, and the
non-question `planNodes`) and only reorders the JSX; the prose-only branch (no
question nodes at all) is byte-unchanged.

**Prose order is safe by construction, and the comment claiming otherwise
goes.** `OpenQuestions.ts#questionsView` builds `nodes` as every `blockNodesOf`
node in document order followed by every question node — the section headings
themselves are skipped and question-span content is never emitted twice. So
filtering the non-question nodes into one list preserves their document order
relative to each other, which is the invariant requirements demand. The stale
comment above that filter — "everything before `## Open Questions`" — is wrong
and is replaced with what the view actually emits, not merely moved.

**The card-index invariant is the thing this package can break.** A question
card's start index must be its position in the same list `PlanView` feeds
`Deck`. Both stay `openQuestionNodesOf(view)` / `openNodes` — one filter,
`status === "open"`, over `view.nodes` in view order — and `QuestionSection`
keeps `allNodes={openNodes}` for the open section and `allNodes={answeredNodes}`
for the answered one. Moving a section is moving JSX, never re-deriving either
list.

**The visual distinction is an accent treatment on the open cards themselves.**
`Card` gains one optional boolean prop (`accent`), which appends a left accent
rule plus the `surface` background to its existing classes and changes nothing
when absent — every other `Card` call site in the client stays identical. Open
question cards pass it; the answered rows keep the inert, muted `opacity-[0.85]`
row they render today. No new heading, no badge, no new colour token:
`--color-accent` already exists and `tokens.test.ts` already asserts it clears
3:1 against `page`. Because open cards now paint body text on `surface`,
`tokens.test.ts` gains one assertion for that pair at the 4.5:1 body threshold —
that file's whole contract is that a palette pair in use is a pair under test.

**Nothing is collapsed.** The document prose stays fully rendered between the
two question sections; no toggle, no truncation.

**Acceptance**: a storybook play test on a plan carrying a heading, prose before
the questions section, one open question, one answered question and a trailing
paragraph — asserting the open question renders above the prose, the answered
one below it, and the trailing paragraph after the preceding prose rather than
before it. A second taps the _last_ open-question card on that same plan and
asserts the deck opens on that question, not another — the direct guard on the
card-index invariant.

## Answered Questions

### Do the two concerns still land as two packages once their file footprints are known?

Yes. Both center on `Plan.tsx` and `Plan.stories.tsx`, which would normally
merge them, but requirements already settled two packages with Done first, and
the edits do not collide: package 01 writes a footer sibling of the scroll
container, package 02 rewrites `PlanBody`'s interior.

### Where on the plan screen does the Done control sit?

An in-flow `shrink-0` footer row below the scroll container, mirroring
`DeckControls`. A card at the end of the list would bury the control at the
bottom of a long plan, which is the exact failure package 02 removes.

### How does the click handler treat the `done` promise?

Fire and forget — the container's `onDone` already catches every rejection and
routes it to the refusal banner, so awaiting it in the view would only create a
second place for the same error to escape.

### What carries the open-card accent without touching every other card?

One optional boolean prop on `Card` that appends an accent rule and the
`surface` background; absent, the rendered classes are unchanged, so review and
fleet cards are provably untouched.
