One concern: **`.gtd/REVIEW.md`'s checkboxes go back to `- [ ]` when the human's
review turn lands**, so a round in which the human only ticked boxes commits an
empty diff for that file, and the feedback collector never has to reason about a
tick again.

## Open Questions

### Should the record of which hunks the human read survive the round at all?

Today the ticks live in exactly one place — the human review turn's commit — and
`.gtd/REVIEW.md` is deleted on the very next turn. Clearing the boxes before the
commit erases that record permanently.

- [x] No — erase them. A tick means "I read this hunk", never sign-off; once the
      round closes nobody consults it, and keeping it is the churn we are
      removing
- [ ] Yes — keep a record outside the file. Clear the boxes, but carry the list
      of read hunks into the turn commit's message (or `.gtd/REVIEW_RAW.md`), so
      the round still shows what was read without a file diff
- [ ] _your answer_

### Does the human's own copy of the file visibly clear, or only the commit?

- [x] Clear the file on disk at `gtd land` — the human watches every box empty
      in their editor as the turn commits. Simple, and the file is deleted next
      turn anyway
- [ ] Clear only what gets committed — the file on disk stays exactly as the
      human left it, ticks and all, until the next turn deletes it. Nothing
      changes under an open editor
- [ ] _your answer_

## Reset review checkboxes when the review turn lands

PRODUCT. This is the whole of the entry sketch, and it changes what the human
sees at the review gate.

**What changes:** at the point the `await-review` turn is captured, every
`- [x]` / `- [X]` pointer line in `.gtd/REVIEW.md` becomes `- [ ]` again. The
human's notes, hunk pointers, chunk headings, and the base comment are untouched
— **only the box character is reset.**

**Three things follow from it, and all three ship together:**

- The tick-tolerance in the round's sign-off-vs-feedback decision (the
  `[ ]`/`[x]` normalisation before the two `REVIEW.md` blobs are compared) is no
  longer load-bearing, because no `[x]` can reach a commit.
- The feedback collector stops being told to ignore checkbox flips. Its rule
  becomes plainly "a note on `.gtd/REVIEW.md` is a concern" with no tick caveat.
- The `await-review` message stops promising the tick persists. It should say
  ticks are read-progress only and are cleared when you land.

**Acceptance:** a scenario where the human ticks boxes in `.gtd/REVIEW.md` and
changes nothing else, then lands — the review turn's commit shows no change to
`.gtd/REVIEW.md`, and the round is judged a clean sign-off, not feedback. It
fails today (the commit carries the flipped boxes) and passes after.

**Scope guard, and it is a real hazard:** this applies to `review` mode only.
`qa` mode's `- [ ]` boxes in `.gtd/REQUIREMENTS.md` ARE the answer — an open
question is answered iff exactly one option is ticked, and clearing them would
unanswer every question and deadlock the answer-completeness gate. A regression
test pinning that qa ticks survive belongs in this concern.

**Open technical points, for the design phase, not answers now:** where the
reset hooks in (gtd ships no formatter for built-in modes, and the emitted
landing script was deliberately stripped to its commit, so neither is a free
home); and whether the sign-off comparison keeps its tick normalisation as
defence-in-depth or drops it as dead code.

## Answered Questions

### Is the `package-lock.json` change in the entry commit part of the intent?

No. The entry commit dropped two transitive `mongoose` lock entries — ordinary
`npm install` churn that rode along with the note. It carries no intent and is
not a concern.

### Which files' checkboxes does "after a finished human review" mean?

`.gtd/REVIEW.md` only. It is the sole `review`-mode file a human ever edits —
the workflow has exactly one human state in that mode — and the sketch's phrase
"handled by the review collection" names the feedback collector, which reads
that file and nothing else.
