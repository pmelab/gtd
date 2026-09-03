# Spec feedback — 03 The `review` format on the tree

## 1. `stripFootnoteMarkers` is not deleted — the task's own criterion is unmet

Criterion: "`isFootnoteDefinitionLine`, `stripFootnoteMarkers`, `proseBlockEnd`,
and `computeFenceSkip` are gone from `src/Footnotes.ts`".

Three of the four are gone. `stripFootnoteMarkers` is still exported at
`src/Footnotes.ts:54` (with `ORPHAN_MARKER_RE` at :51), still tested in
`src/Footnotes.test.ts:218-225`, and still has three live callers:

- `src/OpenQuestions.ts:109` — over `sourceText(...)` of a heading
- `src/OpenQuestions.ts:164` — over a RAW line (`lines[lineIndex]`)
- `src/OpenQuestions.ts:234` — over a raw string

The spec's premise ("this package is the last caller") is factually wrong:
package 01's `OpenQuestions.ts` is a caller and was never converted. Resolve one
way or the other — either delete the helper and give those three sites a
tree-based orphan-marker excision, or amend the criterion to name the surviving
caller and say why it stays. Leaving it silently unmet is the one option that is
not open.

## 2. The "four spaces" acceptance is factually wrong, and the code (correctly) does not honor it

Two places say it:

- Requirement/Acceptance: "the same line indented four spaces is indented code
  and neither [a hunk pointer nor cleared]"
- Task "nested hunks are the same hunks": "the same line indented four spaces is
  a `code` node and is not a hunk"

Measured against the shipped code, with a `- [ ] ./src/a.ts#1` above it:

```
- [ ] ./src/a.ts#1
    - [x] ./src/b.ts#2
```

parses as TWO hunks (`./src/b.ts#2`, `checked: true`, `sourceLine: 6`) and
`clearFilePointerTicks` DOES clear it. Four spaces is still a nested list, not
code: inside a list item whose content column is 2, the indented-code threshold
sits at column 6.

The code is right and CommonMark-correct; the spec sentence is wrong. The test
at `src/ReviewDoc.test.ts:1591` quietly substitutes six spaces and renames the
criterion ("indented past the item's own content column plus 4") rather than
failing — so nothing in the tree records that the stated criterion was rejected.
Correct the spec's two sentences to the real threshold.

## 3. Comments name helpers this package deleted

- `src/Footnotes.ts:295` — "or `proseBlockEnd` otherwise" in
  `footnoteAdditionEdits`'s doc comment. `proseBlockEnd` no longer exists.
- `src/Footnotes.ts:368` — "never `isFootnoteDefinitionLine`: that helper's
  line-based continuation rule …", written in the present tense about a deleted
  function.
- `src/Footnotes.test.ts:342-343` — "`isFootnoteDefinitionLine` (still
  line-based, any indent continues) would say …". "Still" is now false.

A comment that explains a decision by contrast with code that no longer exists
sends the next reader looking for it.
