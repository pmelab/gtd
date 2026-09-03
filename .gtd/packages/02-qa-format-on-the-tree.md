# 02 — The `qa` format on the tree

## Requirement

Headings, checkbox options, wrapped-option spans, section ordering, and the code
action's insertion point all come from nodes. `listItem.checked` replaces the
checkbox regex, and `toggleCheckbox`'s `raw.indexOf("[")` — a guess at where the
box is — is replaced by the box's real offset. An option's `endLine` stops being
inferred from continuation-line indentation.

**Acceptance**: a `## Open Questions` line inside a fenced code block is not
that section. Today `checkSectionOrder` does a bare `findIndex` for the literal
string with no fence awareness, so a requirements file that documents its own
format reports a bogus section-order finding.

**Acceptance, strict reading**: a `### ` indented four or more spaces is
indented code and no longer a question heading, and a `- [ ]` indented four or
more spaces is no longer an option. Today both count, because the heading check
trims the line before matching and the checkbox regex is indent-tolerant. Two or
three spaces still count, per CommonMark. A file relying on the loose reading
loses that question or option and says so with a positioned finding.

The free-text slot stays identified positionally — the last option in the block
— not by label.

## Paths

- `src/OpenQuestions.ts`
- `src/OpenQuestions.test.ts`

## Task — sections and questions from heading nodes

Sections are `heading` nodes of `depth === 2`. Questions are `depth === 3`
headings between a section heading and the next heading of depth ≤ 2. Section
identity stays a literal text match on the heading's own text.

- [ ] `## Open Questions` and `## Answered Questions` are found as depth-2
      heading nodes, never by `lines.findIndex`
- [ ] a `### ` heading with no question text is still recognized and still
      reports its one structural finding — it must not be skipped as prose
- [ ] a question's own text comes from the heading node, with footnote
      references excised

## Task — options from task list items

Options are the `listItem`s with `checked !== null` in the list following a
question heading. `listItem.checked` replaces `CHECKBOX_RE`, and
`option.endLine` becomes the item's own end line, so continuation-indent
inference is gone.

`itemEndIndex` and the `isFootnoteDefinitionLine` call inside it are deleted: a
`footnoteDefinition` is a sibling block node, never inside a list item, so the
tree already ends the item where the definition begins.

The free-text slot stays identified positionally — the last option in the block
— not by label.

- [ ] an option whose text wraps onto an indented continuation line has
      `endLine` at the wrap, from the item's own end
- [ ] an option whose text wraps onto an UNINDENTED lazy line has `endLine` at
      the wrap — the tree keeps the lazy line inside the item
- [ ] a `footnoteDefinition` written directly below the last option is not part
      of that option's span, with no `isFootnoteDefinitionLine` call involved
- [ ] `itemEndIndex` and `CHECKBOX_RE` are gone from `src/OpenQuestions.ts`
- [ ] the unfilled `_your answer_` placeholder still normalizes to `""` on the
      LAST option only, and a ticked-but-unfilled free-text slot still reads as
      unanswered

## Task — `checkSectionOrder` over heading nodes

`checkSectionOrder` compares `depth === 2` heading nodes and drops
`lines.findIndex` entirely.

- [ ] a `## Open Questions` line inside a fenced code block is not that section
      — verified: it parses to a `code` node, so a requirements file that
      documents its own format stops reporting a bogus section-order finding
- [ ] `## Open Questions` preceded by another `##` section still reports one
      finding, and only one, however many sections offend
- [ ] `## Answered Questions` followed by another `##` section still reports one
      finding
- [ ] level-1 headings and prose still do not count

## Task — the checkbox's real offset

`toggleCheckbox`'s `raw.indexOf("[")` — a guess that can land on a `[` earlier
in the line — is replaced by an exact offset.

The task-list extension **consumes** the `[x]` marker: the item's first
paragraph starts _after_ `] `, so no node's boundary is the box itself. Resolve
it as the first `[` at or after the `listItem`'s start offset, bounded by the
first paragraph's start offset. That window contains only the list marker and
the box, so the result is exact and cannot pick up prose.

- [ ] `toggleCheckbox` on an option flips exactly one character and leaves every
      other byte of the line untouched
- [ ] an option whose TEXT contains a `[` before any bracket of its own still
      toggles the box, not the text — the case `raw.indexOf("[")` gets wrong
- [ ] `toggleCheckbox` returns `undefined` for a bare `[x]` in ordinary prose,
      which is not a list item
- [ ] radio semantics survive: picking an option unchecks every ticked sibling,
      leaving exactly one tick

## Task — the strict reading, with a positioned refusal

- [ ] a `### ` indented four or more spaces is a `code` node and no longer a
      question heading
- [ ] a `- [ ]` indented four or more spaces is a `code` node and no longer an
      option
- [ ] two or three spaces still count — verified: `  ### two spaces` is a
      `depth: 3` heading, `    ### four spaces` is a `code` node
- [ ] a file relying on the loose reading loses that question or option and says
      so with a positioned finding, not silently

## Task — code actions off the tree

The "add a footnote" insertion point and the pick/uncheck actions both resolve
their spans from nodes.

- [ ] "add a footnote" with the cursor inside an option list plants the
      definition after the whole contiguous list's own span, never splitting two
      items
- [ ] "add a footnote" with the cursor in question-body prose above a list, in a
      question with no options, and outside every question all resolve to the
      containing block node
- [ ] the marker edit and the definition edit never share a start position — LSP
      forbids overlapping (including coincident zero-length) ranges in one
      action
- [ ] no pick/uncheck action off an option's span, or on an answered-section
      (prose) question

## Task — cucumber scenarios

- [ ] a `.feature` scenario covers a `qa` steering file that quotes
      `## Open Questions` inside a fence and validates clean
- [ ] a `.feature` scenario covers a four-space-indented option no longer
      counting, and the process refusing with a positioned finding
- [ ] Given steps are composable and expose the actual file content in the
      scenario text
