# 01 — End the turn from the plan screen itself, with or without a note

## Requirement

A design document — a steering file with no questions in it — gives the human no
way to hand the turn back. `gtd ui` only exits when the `done` mutation fires,
and today that mutation has exactly two triggers: the note sheet's "Save & Done"
button, and the Q&A deck's Done control. A prose-only document reaches neither.
The deck never renders, because there are no question nodes to page through; the
note sheet only opens from a note seam, and it always writes a note on the way
out. A human who has read the document and wants to hand it back with nothing to
say has to kill the process from the terminal.

Put a Done control on the plan screen itself. It ends the turn the same way the
deck's Done does — the `done` mutation with no `note`, no compare-and-swap,
nothing written — and it is present whether or not the document carries
questions.

It is unguarded. Unticked open questions do not hide it, disable it, or trigger
a confirmation step — one tap ends the turn. A human who hands back with
questions still open meant to, and the answering agent treats an unanswered
question exactly as it treats one that was never asked. The cost of that choice
is real: a mistap on a phone ends the turn with the plan half answered, and
there is no undo — the process has already exited.

The no-note `done` path already exists end to end and needs no server work: the
real `Plan` container builds `onDone` (`done.mutateAsync({})`, caught and never
rethrown), and passes it down today only to reach the deck's button. This
concern renders it on the list screen and gives it its own test id, distinct
from the deck's `deck-done`.

Two things the wiring must not break. A refused `done` surfaces through the
existing refusal banner rather than silently leaving the process alive — the
container's own `.catch` already routes it there. And the resolved state still
swaps the whole screen for the terminal handed-back panel, which is what tells
the human the process is exiting.

## Task 1 — A `plan-done` footer row below the plan screen's scroll container

`PlanView`'s list branch already returns a `flex h-full min-h-0 flex-1 flex-col`
shell whose only child is the scrolling `div`. The Done row becomes that div's
sibling, after it, exactly as `DeckControls` sits below `deck-content` in
`src/web/Deck.tsx`: in normal flow, never `fixed`/`sticky`, so it can never
overlay the plan, and inside the viewport for free because the column is exactly
viewport-tall. Not a card appended to `CardList` — that buries the one control
the human is there to reach at the bottom of a long document.

The row holds one primary `Button` with `data-testid="plan-done"`, distinct from
the deck's `deck-done`. It renders only when `onDone` is defined, matching every
other optional callback on `PlanViewProps`, so the pure-data stories that pass
no mutations render no Done button.

The click handler calls `onDone()` as a statement and discards the promise —
never awaited. `usePlanMutations#onDone` already is `done.mutateAsync({})` with
a `.catch` that calls `onRefusal` and never rethrows, so awaiting it in the view
would only create a second place for the same rejection to escape.

Nothing about the deck changes: `onDone` keeps flowing into `Deck`, so
`deck-done` and the "Back to list" last-item advance label are untouched.

The deck branch and the note-sheet branch both `return` before the list branch,
so the footer cannot appear next to `deck-done` or under the note sheet. That is
an invariant of those early returns — flattening them breaks it.

Paths: `src/web/screens/Plan.tsx`, `src/web/screens/Plan.stories.tsx`.

- [ ] a story taps `plan-done` on a prose-only plan (no question nodes) and
      asserts the recorded `done` input is exactly `{}` — no `note` key — and
      that the handed-back panel renders
- [ ] a story taps `plan-done` on a plan carrying an unticked open question and
      asserts the same empty-input `done` fires on that single tap, with no
      confirmation element rendered in between
- [ ] a story asserts `deck-done` still renders inside the deck with its
      existing label, and the deck's last-item advance button still reads "Back
      to list"
- [ ] a refused `done` shows the refusal banner, leaves the plan screen rendered
      and editable, and does not render the handed-back panel
- [ ] a story with no `onDone` prop renders no `plan-done` control at all
- [ ] no `writeNote` and no `setValue` call is made by the `plan-done` path
- [ ] `npm test` green
