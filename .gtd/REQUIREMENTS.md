Footnotes become gtd's commenting tool in planning and review files: a marker
sits at a specific word or sentence, and the comment itself lives below the
block it annotates. Three concerns, in build order.

## Open Questions

### Do the human's footnotes survive the lap that folds them in?

- [x] Consumed — the agent deletes each footnote once it is folded into a
      concern or package, so the file never carries a comment that was already
      acted on and no stale footnote can be re-read next lap
- [ ] Kept — footnotes persist as the record of what was asked and why; only the
      review gate's existing tick reset touches the file
- [ ] _your answer_

### May the agent write footnotes of its own?

- [x] Human-only — a footnote is input. The agent answers in
      `.gtd/REQUIREMENTS.md` prose and never annotates a review file
- [ ] Two-way — the agent may reply with its own footnote at the same anchor,
      turning a review file into a threaded comment thread
- [ ] _your answer_

## Concerns

### 1. Footnotes are structure in the `qa` and `review` steering formats — TECHNICAL

**Both formats parse a footnote as an anchored comment, not as prose they
swallow.** A marker (`[^name]`) sits inline after a word or sentence; its
definition (`[^name]: …`, plus indented continuation lines) sits below the
paragraph, list, or hunk that carries the marker.

- A marker is anchored by line AND column, so the comment attaches to the word
  or sentence it follows, not just to the line
- Markers are recognised anywhere a human writes prose in either format: a
  question option, an answered-question paragraph, a chunk heading or
  description, a hunk pointer line, and a hunk's note
- **A definition is no longer absorbed into the thing above it** — a hunk's
  `note` and a question option's `text` both exclude it today only by accident,
  and must exclude it by rule
- Validation reports, positioned at the offending line: a marker with no
  definition, a definition no marker references, and a duplicate name
- The outline shows each footnote as a leaf under the node it annotates

**Risk: everything under `.gtd/` is oxfmt-formatted and covered by
`format:check`.** A footnote definition that is not an oxfmt fixed point reds
`start-gate`, `review-gate`, and `fix-precheck` alike, and past experience is
that a markdown reflow of a steering file deadlocks the review loop rather than
failing the agent. Pin a footnote-bearing sample through oxfmt in a test —
`SteeringFormat.sample` already exists for exactly this round-trip.

Acceptance: `src/OpenQuestions.test.ts` and `src/ReviewDoc.test.ts` — an
anchored footnote parses with its anchor column, the three findings fire, and a
hunk's note excludes its footnote body. All fail before, pass after.

### 2. Agents read a footnote as a comment on its anchor — PRODUCT

**A footnote is only worth writing if the agent that receives the file treats it
as a comment about the exact context it is attached to.** Every prompt and gate
message on the feedback path learns the shape:

- `build.review.await-review` — the human's instructions for how to comment on a
  hunk, alongside "a note on a line" and "a code edit"
- `build.review.collecting` — each footnote is a mandatory concern, described
  against its anchor's hunk, never flattened into a whole-file remark
- `design.gate.answer` and `design.triage`'s loop-back read — a footnote in
  `.gtd/REQUIREMENTS.md`, and a footnote in the reverted review-round edit read
  back out of history
- `docs/configuration.md`'s steering-format section and `README.md` — the syntax
  a human types is user-facing, so it is documented; nothing about how the
  parser is built

Acceptance: `src/workflows/templates.test.ts` pins the new prompt text, and an
`evals/` case grades that a footnote anchored on one hunk becomes a concern
about that hunk rather than a generic one.

### 3. `gtd lsp` writes and navigates footnotes — TECHNICAL

**One code action puts the marker in the right place, and go-to-symbol jumps
both ways.**

- "add a footnote" at the cursor: the marker lands after the word the cursor is
  inside, or at the cursor when it already sits just past the word; the
  definition lands below the current paragraph or list; the name is generated
  unique within the document
- Definition jumps marker → footnote and footnote → marker, within the one
  document

**The `SteeringFormat` seam does not carry either of these yet:** `pointerAt`
takes a line and returns a foreign file path, and the LSP's `definition`
discards the cursor column. Widening that seam to carry a column and a
same-document target belongs to this concern, not ahead of it.

Acceptance: `src/Lsp.test.ts` plus a `tests/integration/features/lsp.feature`
scenario that drives the code action and then the definition round trip.

## Answered Questions

### What syntax marks a footnote?

Standard markdown footnotes — `[^name]` and `[^name]: …`. Editors already
render, fold, and link them, and no format in this repo claims that shape.

### Where does a footnote's body sit?

Directly below the paragraph, list, or hunk that carries the marker — the sketch
says so, and it keeps a review chunk self-contained instead of pushing comments
to the document's end.

### Does a footnote count as "request changes" at the review gate?

Yes. `build.review.deciding` already routes any `.gtd/REVIEW.md` byte change to
feedback, and a footnote is a comment by definition, so no routing changes.

### Can a footnote answer an open question instead of ticking a box?

No. A footnote is commentary; the answer-completeness guard still requires
exactly one ticked option per open question.

### Which steering files get footnotes?

Both formats — `qa` (`.gtd/REQUIREMENTS.md`, `.gtd/ARCHITECTURE.md`) and
`review` (`.gtd/REVIEW.md`) — per the sketch's "planning and review files".
