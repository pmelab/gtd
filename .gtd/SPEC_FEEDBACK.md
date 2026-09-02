# Spec feedback — 03 `gtd lsp` writes and navigates footnotes

Tasks 1, 3 and 4 satisfy their criteria. Task 2 does not: one code path in
`footnoteAdditionEdits` emits two edits that share a start position, and
applying them destroys the marker.

## 1. `footnoteAdditionEdits` emits colliding edit ranges

`src/Footnotes.ts` — `footnoteAdditionEdits`.

The marker edit is an insert at `(position.line, markerColumn)`. The definition
edit is a replace whose start is `(blockEndLine, lines[blockEndLine].length)`.
When `position.line === blockEndLine` AND `footnoteMarkerColumn` lands at the
end of that line, the two ranges start at the SAME offset. Two edits at one
offset have no defined order, and every back-to-front applier — including
`applyTextEdits` in `tests/integration/support/steps/lsp.steps.ts` — inserts the
definition ahead of the marker text and eats it.

That condition is not exotic: it fires for **a cursor inside the last word of
the block's last line**, the most likely place a human adds a footnote, and for
a cursor at end-of-line there.

Repro, `QA_FORMAT.sample`, cursor `{ line: 8, character: 18 }` (inside
`_your answer_`, the last option). Applying the returned edits yields:

```
- [ ] _your answer_

[^fn2]: your comment

fn2]
```

The marker is gone, a `fn2]` fragment is left behind, and `QA_FORMAT.validate`
reports `Footnote definition "[^fn2]" has no marker referencing it` — so the
document does NOT validate clean apart from the placeholder finding.

Same shape in `review`: a doc whose hunk span ends with `some trailing prose`,
cursor `{ line: 7, character: 15 }` (inside `prose`), produces the identical
`^fn1]` corruption.

Anchor the definition edit where it cannot touch the marker edit — e.g. start it
at `(blockEndLine + 1, 0)` — rather than at the end of `blockEndLine`.

## 2. No test covers a cursor on its own block's last line

`src/SteeringFormats.test.ts` — the two
`'gtd: add a footnote' produces an oxfmt fixed point` cases pick
`{ line: 7, character: 8 }` (qa) and `{ line: 6, character: 20 }` (review), both
mid-line and both on a line that is NOT `blockEndLine`.
`src/OpenQuestions.test.ts` and `src/ReviewDoc.test.ts` do the same. Nothing in
the suite exercises the collision, which is why it shipped green.

The criterion "Applying the action's edits produces a document that both
`validate`s clean apart from the placeholder finding, and is an oxfmt fixed
point" needs a case where the cursor sits on the block's LAST line, in both
formats.

## 3. The action inserts a marker into existing footnote syntax

Same criterion, same function, two more positions that yield an invalid
document:

- Cursor inside an existing marker's name, between the name and its `]` —
  `QA_FORMAT.sample` `{ line: 6, character: 19 }` — inserts the new marker
  inside the old one: `- [ ] Option A[^fn1[^fn2]]`.
- Cursor on a definition's own `[^name]:` label — `QA_FORMAT.sample`
  `{ line: 10, character: 6 }` — yields `[^fn1][^fn2]:`, breaking the existing
  definition, and the new marker lands in a definition body where marker
  scanning excludes it, so validate reports the new footnote as an orphan
  definition.

Both are reachable by a human clicking in an ordinary place. Decide the rule
(refuse to offer the action inside a marker span or on a definition line, or
plant the marker outside the span) and pin it with a test.
