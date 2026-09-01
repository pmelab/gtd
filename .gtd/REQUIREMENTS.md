One concern: **`.gtd/REVIEW.md`'s checkboxes go back to `- [ ]` on disk when the
human's review turn lands**, so a round in which the human only ticked boxes
commits an empty diff for that file, and the feedback collector never has to
reason about a tick again.

## Reset review checkboxes when the review turn lands

PRODUCT. This is the whole of the entry sketch, and it changes what the human
sees at the review gate.

**What changes:** at the point the `await-review` turn is captured, every
`- [x]` / `- [X]` pointer line in `.gtd/REVIEW.md` becomes `- [ ]` again. The
human's notes, hunk pointers, chunk headings, and the base comment are untouched
— **only the box character is reset.**

**The reset rewrites the file on disk, not just the committed blob.** The human
watches every box empty in their editor as `gtd land` runs. That is accepted:
the file is deleted on the very next turn anyway, so there is nothing to
preserve on disk past the land.

**The ticks are erased, and nothing records them anywhere else.** No list of
read hunks goes into the turn commit message, into `.gtd/REVIEW_RAW.md`, or into
any other file. A tick means "I read this hunk", never sign-off; once the round
closes nobody consults it. Accepted risk, stated plainly: **after this change
there is no record, in history or on disk, of which hunks the human read.**

**Three things follow from it, and all three ship together:**

- The tick-tolerance in the round's sign-off-vs-feedback decision (the
  `[ ]`/`[x]` normalisation before the two `REVIEW.md` blobs are compared) is no
  longer load-bearing, because no `[x]` can reach a commit.
- The feedback collector stops being told to ignore checkbox flips. Its rule
  becomes plainly "a note on `.gtd/REVIEW.md` is a concern" with no tick caveat.
- The `await-review` message stops promising the tick persists. It should say
  ticks are read-progress only, are cleared when you land, and are not kept.

**Acceptance:** a scenario where the human ticks boxes in `.gtd/REVIEW.md` and
changes nothing else, then lands — the file on disk carries no `[x]` after the
land, the review turn's commit shows no change to `.gtd/REVIEW.md`, and the
round is judged a clean sign-off, not feedback. It fails today (the commit
carries the flipped boxes) and passes after.

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

### Should the record of which hunks the human read survive the round at all?

No — erase them, and record them nowhere. A tick only ever meant "I read this
hunk", never sign-off, and nothing downstream reads it once the round closes;
keeping it is exactly the churn this change removes.

### Does the human's own copy of the file visibly clear, or only the commit?

The file on disk clears at `gtd land`. Boxes empty in the human's open editor as
the turn commits, which is acceptable because the next turn deletes the file.

### Is the `package-lock.json` change in the entry commit part of the intent?

No. The entry commit dropped two transitive `mongoose` lock entries — ordinary
`npm install` churn that rode along with the note. It carries no intent and is
not a concern.

### Which files' checkboxes does "after a finished human review" mean?

`.gtd/REVIEW.md` only. It is the sole `review`-mode file a human ever edits —
the workflow has exactly one human state in that mode — and the sketch's phrase
"handled by the review collection" names the feedback collector, which reads
that file and nothing else.
