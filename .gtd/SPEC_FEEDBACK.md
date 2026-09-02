# Spec feedback — 02-footnote-prompts

Four problems. The wiring, the `templates.test.ts` pins, and the docs/README
prose all match the spec; these are the parts that are wrong or that do not
grade what the spec asked them to grade.

## 1. The two gate messages tell the human a footnote replaces an answer — the engine refuses that step

`src/workflows/unified.yaml`, both question-gate `with:` blocks
(`design.gate.answer` and `architecture.gate.answer`) introduce `footnoteRules`
with:

    You can also leave a footnote instead of ticking a box:

Two lines above, the same message says "Stepping is refused while any question
is unanswered." — and that is the truth: `unansweredQuestions` in
`src/OpenQuestions.ts` counts a zero-tick question as unanswered no matter what
footnotes the file carries, and `src/StepGuards.ts` blocks the step on it. A
human who follows the sentence literally (footnote, no tick) gets a refusal
naming the question they just commented on.

The injection site is right; the framing sentence is wrong. A footnote is input
carried ALONGSIDE an answer, not a substitute for ticking. Reword both
instances. Either that or make a footnoted question count as answered — but that
is not in this spec, so the sentence is what should change.

## 2. `design-triage:footnote` cannot demonstrate consumption, and punishes it if the agent does it

`evals/cases/design-triage.mjs` seeds the footnote in `.gtd/TODO.md`, and
`expect.footnote.gtdFiles` is the exact list `[".gtd/REQUIREMENTS.md"]`.
`matchGtdFiles` compares that list exactly. Verified by building the fixture: at
the `design.triage` rest, `.gtd/TODO.md` sits in the working tree with the
`[^enterprise]` marker and definition intact.

So the agent has two moves and both are bad:

- Obey `footnoteFoldIn` ("DELETE it in this same turn — marker and definition
  together") → `.gtd/TODO.md` lands in `gtdFilesChanged` →
  `checkGtdFilesChanged` fails the trial for doing exactly what the prompt
  demands
- Leave the footnote in `.gtd/TODO.md` → the trial passes, and
  `checkFootnoteConsumed` passes trivially, because `.gtd/REQUIREMENTS.md` is a
  file the turn authors from scratch and never had a `[^` in it

Either way, deletion is not graded. That is the exact defect the spec ruled out
for review-collecting ("never touches a footnote-bearing file it also rewrites,
so it cannot demonstrate consumption at all") — `.gtd/TODO.md` has the same
problem at `design.triage`.

Two more reasons the seed location is wrong:

- The spec names where a footnote reaches triage: "a footnote in
  `.gtd/REQUIREMENTS.md`, and a footnote in the reverted review-round edit read
  back out of history". `.gtd/TODO.md` is neither
- In the real workflow `unwind` reverts the start diff out of the tree before
  triage runs, so a `.gtd/TODO.md` footnote never rests in the tree at
  `design.triage` at all. The fixture reaches that state via `gtd --entry`,
  which skips the unwind — the variant grades a repository shape the workflow
  never produces
- `.gtd/TODO.md` has no `mode:`, so no footnote validation and no editor support
  applies there; the documented feature does not cover that file

Fix direction: seed the footnote in the loop-back `.gtd/REQUIREMENTS.md` the
turn actually rewrites, so deletion is real, observable, and gradeable.

## 3. The review-collecting grader does not fail a whole-file remark

`evals/asserts/build-review-collecting.mjs`'s `checkFootnoteAnchor` only
requires `result.feedback` to contain the string `src/checkout.ts`. The spec's
criterion is "its grader fails a concern that describes the whole file instead
of the anchored hunk" — a concern reading "src/checkout.ts is under-tested
overall" names the path and passes. Naming a file is not naming a hunk.

The variant's own raw review carries the anchor as `./src/checkout.ts#2` and the
footnote's substance (dropped fractional cents / rounding). Grade one of those
too, so a file-level paraphrase fails.

## 4. The documented syntax example is the placeholder body the validator rejects

`docs/configuration.md` teaches the definition shape as `[^name]: your comment`,
and `footnoteRules` in `src/workflows/unified.yaml` repeats it.
`PLACEHOLDER_BODY` in `src/Footnotes.ts` is exactly `"your comment"`, compared
case-insensitively — so a human who copies the documented example verbatim and
fills in only the name trips the fourth finding, "still has its seeded
placeholder body". The docs list that finding without ever saying what the
placeholder is, so the reader cannot connect the error to the example they were
given.

Use a filler that is not the placeholder in both places, or state plainly that
the literal words "your comment" are the unfilled-placeholder marker.

## Verified clean

- `footnoteRules` / `footnoteFoldIn` declared and non-empty; every injection
  uses the raw `<%~ %>` form; six sites, three each, exactly as named
- `build.review.reviewing` references neither tag
- `templates.test.ts` pins by name and count, plus the structural
  human-input-only / delete-in-the-same-turn / anchor / whole-file assertions;
  61 tests pass
- The existing no-leaked-`undefined` render pin covers `message` fields too, so
  the new gate injections are inside it
- `validateDefinition(definition).warnings` is still `[]`
- `npm test` green (all nine turbo tasks)
- Neither `docs/configuration.md` nor `README.md` names a `src/*.ts` module, an
  internal function, or a private type
- The four documented findings match `src/Footnotes.ts`'s finding set exactly
