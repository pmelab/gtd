## Open Questions

### Does the plan screen's Done control stay available while open questions are still unticked?

- [x] Always available, unguarded — Done means "hand the turn back now"; a human
      who leaves questions open meant to, and the answering agent handles an
      unanswered question the same way it handles one that was never asked
- [ ] Available, but a tap with unticked open questions asks for confirmation
      first ("2 questions unanswered — hand back anyway?") — a mistap on a phone
      otherwise ends the turn with the work half done
- [ ] _your answer_

## PRODUCT: end the turn from the plan screen itself, with or without a note

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

Acceptance: a storybook play test taps the plan screen's Done on a prose-only
plan and asserts the recorded `done` call carried an empty input — no `note`
key. A second asserts the deck's own `deck-done` is untouched by the change. The
existing `ui-lifecycle.feature` no-note handoff scenario already proves the
server side of the same round trip exits 0.

## PRODUCT: open questions sit at the top of the plan screen and read as the thing to act on

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

Acceptance: a storybook play test on a plan carrying a heading, prose before the
questions section, an open question, an answered question and a paragraph after
the questions section — asserting the open question renders above the prose, the
answered one below it, and the trailing paragraph after the preceding prose
rather than before it. A second play test taps the last open-question card on
that same plan and asserts the deck opens on that question, not another.

## Answered Questions

### Do the two concerns land in one package or two, and in which order?

Two, Done first. The Done control is the human's blocking complaint — they
cannot end the turn at all — and it touches no layout. The question-ordering
work is a pure render change and leaves the suite green on its own either way,
so it goes second.

### Does the plan prose collapse behind a toggle once questions move to the top?

No. The document stays fully rendered below the questions. The "Read the plan"
row already exists as the read-confirmation affordance; hiding the prose it
confirms would make that row point at nothing on screen.

### How are open questions made visually distinct?

Agent's call at build time — an accent treatment on the open cards themselves,
not a new heading or badge scheme. The requirement is that the distinction reads
without parsing text; the exact treatment is styling, not product.
