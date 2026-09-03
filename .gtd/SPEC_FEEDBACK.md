# Spec feedback — 02 `qa` format on the tree

Two criteria are unmet. Everything else in the package checks out:
`CHECKBOX_RE`, `itemEndIndex`, and the `isFootnoteDefinitionLine` call are gone
from `src/OpenQuestions.ts`; `checkSectionOrder` walks depth-2 heading nodes;
`toggleCheckbox` resolves the box's real offset within the marker window; the
cucumber scenarios exist and are composable. `npm test` is green.

## 1. The strict-reading refusal misses the lazy-continuation case, silently

Task "the strict reading, with a positioned refusal", last bullet: "a file
relying on the loose reading loses that question or option and says so with a
positioned finding, not silently."

`recognizedStructureLines` (`src/OpenQuestions.ts:367`) excludes every `heading`
node and every task-list `listItem` **at any nesting depth**. When a 4+-space
line follows a non-blank list-item line, CommonMark folds it INTO that item — so
it becomes a nested `heading`/`listItem` node, lands in the exclusion set, and
`strictReadingFindingsInRange` skips it. No finding, and the question or option
is gone from `parseOpenQuestions`.

Repro A — the question disappears entirely and its options merge into the
previous question, with zero findings:

```
## Open Questions

### A?

- [ ] one
    ### B?

- [ ] two
```

`parseOpenQuestions` returns one question `A?` with 2 options. `B?` is lost.
`QA_FORMAT.validate` returns `[]`.

Repro B — the option disappears and gets absorbed into the preceding option's
span, with zero findings:

```
## Open Questions

### A?

- [ ] REST
    - [ ] GraphQL
- [x] _your answer_ x
```

`options` is `[REST (lines 4-5), _your answer_ x (line 6)]` — `GraphQL` is gone,
`REST.endLine` swallows its line, and the question reads `answered: true`.
`QA_FORMAT.validate` returns `[]`. The pick action and the footnote insertion
point on line 5 both target `REST`.

The old indent-tolerant `CHECKBOX_RE` (`^\s*[-*]\s*\[([ xX])\]`) counted both of
these, so both are exactly the "file relying on the loose reading" the bullet
names.

The existing `optionListItems` comment and the test at
`src/OpenQuestions.test.ts:1235` assert this silence is by design because the
node is "correctly-recognized, not lost text." That reasoning holds for the
2-space nested case (indent < 4, below the strict threshold, genuinely a
sub-list). It does not hold at 4+ spaces: the text IS lost from the format's
output, which is what the bullet is about.

Direction: narrow the exclusion sets to the nodes this format actually consumes
— TOP-LEVEL depth-2/3 headings and top-level task-list items — instead of any
depth. The existing `raw` indent >= 4 guard already keeps a real 2-space nested
sub-item from being flagged, so narrowing costs no false positives there.

## 2. Two of the three named footnote cursor positions are unasserted

Task "code actions off the tree", second bullet names three positions that must
resolve to the containing block node: question-body prose above a list, **a
question with no options**, and **outside every question**.

Only the first is asserted (`src/OpenQuestions.test.ts:1061`). The nearest test
for the others (`:1078`, cursor at line 0 of `QA_FORMAT.sample`) asserts only
that the action is offered with two edits — it never checks the resolved
insertion line. Add the two missing assertions on `edits[1].range.start.line`.

## Standing docs rule, outside the spec's Paths

The strict reading is a user-visible format constraint: a `qa` file that indents
an option or a question heading 4+ spaces now fails `gtd check qa`. `docs/`
documents the `qa` format's other user-facing rules (section order, footnotes,
`docs/configuration.md:497`) and says nothing about indentation. One sentence
there — 2-3 spaces still count, 4+ does not — is the kind of fact only the docs
can tell a user. No later package covers it.
