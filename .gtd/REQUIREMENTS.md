## PRODUCT: end the turn from the plan screen itself, with or without a note

A design document — a steering file with no questions in it — gives the human no
way to hand the turn back. `gtd ui` only exits when the `done` mutation fires,
and today that mutation has exactly two triggers: the note sheet's "Save & Done"
button, and the Q&A deck's new Done control. A prose-only document reaches
neither. The deck never renders, because there are no question nodes to page
through; the note sheet only opens from a note seam, and it always writes a note
on the way out. A human who has read the document and wants to hand it back with
nothing to say has to kill the process from the terminal.

Put a Done control on the plan screen itself. It ends the turn the same way the
deck's Done does — the `done` mutation with no `note`, no compare-and-swap,
nothing written — and it is present whether or not the document carries
questions. The whole point of the phone client is that the terminal is not in
reach.

A refused `done` still has to surface through the existing refusal banner rather
than silently leaving the process alive.

Acceptance: a storybook play test taps Done on a prose-only plan and asserts the
real `done` call carried no note; the existing `ui-lifecycle.feature` no-note
handoff scenario already proves the server side of the same round trip exits 0.

## PRODUCT: open questions sit at the top of the plan screen and read as the thing to act on

Open questions are buried. `PlanBody` renders every non-question block of the
document first, then the "Open Questions" section, then "Already answered". A
real plan is long, so on a phone the questions are several screens down — past
every heading, list and code block the document happens to carry. The one thing
the human is there to do is the one thing they have to scroll to find.

Two changes, together:

- Open questions go to the top of the screen, above the document prose. The
  document is reference material; the questions are the task.
- Open questions are visually distinct from both the prose and the answered
  ones, at a glance, without reading the heading text. Answered questions stay
  where they are, below the prose — they are history, not work.

This also settles an ordering bug the current layout hides. `blockNodesOf` now
emits blocks that follow the questions sections, but `PlanBody` filters every
non-question node into one list rendered above both sections, so trailing prose
is silently hoisted out of document order. The comment above that filter still
claims these nodes are "everything before `## Open Questions`" and is now wrong.
Whatever layout this concern lands, the prose blocks it renders must stay in
document order.

Acceptance: a storybook play test on a plan carrying a heading, prose before the
questions section, an open question, an answered question and a paragraph after
the questions section — asserting the open question renders above the prose, the
answered one below it, and the trailing paragraph after the preceding prose
rather than before it.
