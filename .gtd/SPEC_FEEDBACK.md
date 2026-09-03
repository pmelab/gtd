# Spec feedback — 02 — The `qa` format on the tree

Everything else in the package holds: sections/questions come off depth-2/3
heading nodes, `checkSectionOrder` is fence-immune, `CHECKBOX_RE` and
`itemEndIndex` are gone, `endLine` comes from the item's own end (indented and
lazy wraps both), and `toggleCheckbox` resolves an exact box offset bounded by
the paragraph's first child (verified: it toggles the box, not a `[` in the
option's own text, and handles `*`/`1.` markers, checked items, and
emphasis-leading text). Unit, e2e-inmem, and typecheck are green.

One task is not implemented.

## Missing — the strict reading's positioned refusal

The behavior half of "Task — the strict reading" landed; the **refusal** half
did not. Nothing in the code emits a finding when a four-space-indented `###` or
`- [ ]` is dropped, and the tests pin the opposite of the spec.

Unmet criteria:

- "Task — the strict reading, with a positioned refusal": _a file relying on the
  loose reading loses that question or option and says so with a positioned
  finding, not silently_
- "Task — cucumber scenarios": _a `.feature` scenario covers a four-space-
  indented option no longer counting, and the process refusing with a positioned
  finding_

Evidence:

- `src/OpenQuestions.ts` — `parseOpenQuestions` returns
  `errors: readonly string[]`; the only findings `QA_FORMAT.validate` emits are
  those strings (mapped to `{ message }`, no `line`) plus the footnote findings.
  No code path inspects a `code` node for a heading- or option-shaped line.
- `src/OpenQuestions.test.ts:1166` — _"a '###' heading indented four spaces is
  indented code, not a question heading — **the question is silently lost from
  the tree**"_ asserts `errors).toEqual([])`. That is the spec's failure case
  written down as the expected result.
- `src/OpenQuestions.test.ts:1187` — the four-space option case asserts only
  `options).toEqual([])` and an unanswered question. No finding.
- `tests/integration/features/check.feature:268` — the scenario refuses, but via
  the generic unanswered-question message
  (`stderr contains "Which storage backend?"`), with no position. Its own
  comment says _"the option is silently lost from the tree"_.

What is needed: a finding, carrying the offending `code` node's `line` (the
`SteeringFinding.line` field already exists — `src/SteeringFormat.ts:57` — so
this does not depend on package 04's range work), for a `code` node inside a
questions section whose content contains a `### ` or `- [ ]`/`- [x]`-shaped line
at 4+ spaces of indent. Both tests above and the feature scenario must then
assert the finding and its line instead of asserting silence.

Scope note: the heading case is the harder one — today it produces **no** signal
at all, so a whole question vanishes with an exit 0. The option case at least
fails the answer-completeness gate, but with a message that names the question
and not the offending line.
