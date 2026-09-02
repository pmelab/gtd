# Spec feedback — 02 footnote prompts

Tasks 1, 2 and 4 land. Task 3's two graders are wired but do not enforce what
their own acceptance criteria claim.

## 1. `footnoteSubstance` is too loose to fail a whole-file remark

`evals/cases/build-review-collecting.mjs` —
`footnoteSubstance: /round|fractional cent/i`.

`/round/i` is an unanchored substring match. It hits `around`, `background`,
`ground`, and — worst here — `round` inside `review round`, a phrase a concerns
document written by `build.review.collecting` is very likely to contain on its
own. So the exact failure the field's own comment promises to catch
("`src/checkout.ts` is under-tested overall … still fails") passes as soon as
the turn also writes the words "this round" anywhere in `.gtd/REQUIREMENTS.md`.

That defeats Task 3's criterion "its grader fails a concern that describes the
whole file instead of the anchored hunk". Needs a pattern tied to the footnote's
actual defect with word boundaries — `rounding`/`rounds`/ `fractional cent` —
not a bare `round`.

## 2. `checkOpenQuestions` fails the `footnote` variant for correct behaviour

`evals/asserts/design-triage.mjs` — `checkOpenQuestions` has no variant guard
beyond `shouldRaise = variant === "violation"`, so the new `footnote` variant
inherits the CLEAN-side bar: `## Open Questions` must not mention
`RefundWindowDays`.

But that variant's own footnote body is an argument for re-opening exactly that
decision:

> double check with support before shipping — some enterprise customers
> negotiated a longer refund window in their contracts, so a flat 30 may not
> hold for every account.

A turn that folds that footnote in as a mandatory concern — which is what
`footnoteFoldIn` instructs — and raises a follow-up question naming
`RefundWindowDays` is doing the graded behaviour right and gets scored as a
failure. The two checks contradict each other on the same fixture.

Fix one of the two: scope `checkOpenQuestions` to `violation`/`clean` (the axis
it was written for), or rewrite the footnote body so it comments on something
other than `settledDecision`.

## 3. Grader comment describes a file the fixture does not seed

`evals/asserts/design-triage.mjs` — `checkFootnoteConsumed`'s comment: "The turn
reads a footnote-bearing `.gtd/TODO.md`".

The fixture seeds `.gtd/REQUIREMENTS.md`, and `evals/cases/design-triage.mjs`'s
own comment states `.gtd/TODO.md` is _deliberately absent_. The comment
contradicts the code directly beneath it.

## 4. Both case files' header comments still say two-sided

- `evals/cases/design-triage.mjs`: "Two-sided on the same open-questions bar …
  `violation` … `clean`"
- `evals/cases/build-review-collecting.mjs`: "Two-sided by construction"

Each case now declares three variants.

## 5. `unique within the file` over-constrains the marker name

`docs/configuration.md`: "`[^name]` (any name, no whitespace or `]`, unique
within the file)". `src/workflows/unified.yaml`'s `footnoteRules` repeats it:
"it only has to be unique in this document".

Only DEFINITIONS must be unique — that is the finding that exists
("`Duplicate footnote definition`"). Markers are matched to a definition by name
alone and duplicate marker names raise nothing, so two `[^rounding]` markers
sharing one definition is legal and useful. Both texts tell a human that shape
is invalid. Task 4's criterion is user-facing syntax documented accurately;
state the uniqueness rule on the definition, not the name.
