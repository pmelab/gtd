# Spec feedback — 04 Findings and outlines that point at the offending token

Three problems. The runtime behavior is right everywhere I checked; two of these
are unpinned criteria and one is a misplaced doc comment.

## 1. The outline's headline change is asserted only on the LAST node

Task "outline ranges from real node boundaries", criterion "a question or chunk
followed by blank lines before the next heading has an outline range ending at
its own last block, not at the blank run".

Both fixtures that exercise it assert the last node only, and both predate this
package:

- `src/ReviewDoc.test.ts:917`
  `describe("REVIEW_FORMAT.outline — last-chunk end-of-range fallback")` —
  asserts `last.range.end.line` in both its cases (lines 943, 951). Chunk One
  and Chunk Two go unasserted.
- `src/OpenQuestions.test.ts:710`
  `describe("QA_FORMAT.outline fold end (last question)")` — asserts
  `nodes[2]?.range.end.line` in both its cases (lines 734, 757). Q1 and Q2 go
  unasserted.

The last node never went through "next sibling's heading minus one" — it had no
next sibling, which is why that describe block is named "fallback". So nothing
in the suite would fail if `chunkEndLines` / `questionEndLines` went back to the
old guess for interior nodes. In `threeChunkLines(true)`, Chunk One's end is 5
under the new node-boundary rule and 6 under the old guess; in `threeQuestions`,
Q1's end is 4 versus 5. Neither number is asserted anywhere.

Pin an interior node in each format.

## 2. No test that a footnote marker in a hunk note is not a document link

Task "hunk pointers become document links", criterion "a footnote marker inside
a hunk's inline note is not turned into a document link to the hunk's file".

`documentLinksFor`'s tests (`src/Lsp.test.ts:274` onward) use a review fixture
with no footnote at all, and `src/ReviewDoc.test.ts` mentions `documentLinks`
nowhere — `grep -n documentLinks src/ReviewDoc.test.ts` returns nothing.
`reviewDocumentLinks` walks task items only, so the behavior holds today, but
the criterion is unasserted.

Add a review fixture whose hunk note carries a `[^name]` marker (with its
definition) and assert exactly one link, covering the pointer token only.

## 3. Orphaned doc comment in `src/OpenQuestions.ts`

`src/OpenQuestions.ts:702` — the JSDoc block beginning "The outline tree for a
`qa`-mode file's open/answered questions" now sits directly above
`blockEndLine`, immediately followed by a second JSDoc block that actually
documents `blockEndLine`. `questionsOutline` (line 740) is left with no doc
comment, and the two stacked blocks read as one comment describing the wrong
function.

Move the outline-tree block to `questionsOutline`.
