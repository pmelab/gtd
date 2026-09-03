# 03 — The `review` format on the tree

Land package 02 before this one: this package deletes the four line-based
helpers that package's code still calls.

## Requirement

The header, the `<!-- base: … -->` comment (an `html` node), chunk headings,
hunk pointers, and the notes gathered below them all come from nodes. Chunk
ticking stops being a document-wide multiline regex — the one the code itself
documents as able to anchor across a blank line and drag a later line into the
match — and becomes an edit per list item.

**Acceptance**: a `- [x] ./file.ts#1` indented two spaces is a hunk pointer AND
is cleared by `gtd uncheck`; the same line indented four spaces is indented code
and neither. Today the two-space case is the live bug: the chunk-body parser
matches it on the _trimmed_ line, so it counts as a ticked hunk, while the
clearing regex anchors its `-` at column 0 and never touches it — so that tick
reaches a commit, which is exactly what the review-gate reset exists to prevent.

**Acceptance**: a `- [x] ./file.ts#1`-shaped line inside a fenced code block in
a chunk description is neither a hunk pointer nor touched by ticking the chunk.

**Risk, blunt**: `gtd uncheck`'s clearing pass must stay byte-preserving outside
the one changed character. It is a whole-document regex replace today precisely
to avoid a split-and-join, which would normalize line endings and turn a
tick-only round on a CRLF checkout into a whole-file diff at the review gate.
Parsing moves to the tree; this rewrite stays a surgical positional edit, never
a reserialized document.

## Paths

- `src/ReviewDoc.ts`
- `src/ReviewDoc.test.ts`
- `src/Footnotes.ts` (deletions only)

## Task — header, base comment, and chunks from nodes

The header is the first block node, required to be a `depth === 1` heading
matching `Review: <hash>`. The base comment is an `html` node matching
`BASE_COMMENT_RE` — verified: `<!-- base: 0000 -->` on its own line parses to a
block-level `html` node. Chunks are `depth === 2` headings.

- [ ] a `# Review: <hash>` line inside a fence is not the header
- [ ] a `<!-- base: <hash> -->` comment is found as an `html` node wherever in
      the document it appears
- [ ] a `## ` chunk heading inside a fence is not a chunk

## Task — hunk pointers and notes from task items

Hunk pointers are task items inside a chunk. The pointer token is the first word
of the item's first paragraph, and the note is `sourceText` over the rest, so a
multi-paragraph explanation needs no `pointerEndIndex` and no `gatherNote`.

`FILE_POINTER_RE`, `FILE_POINTER_TICK_RE`, `pointerEndIndex`, and `gatherNote`
are all deleted. `POINTER_LINE_RE` and `isPointerToken` stay — they parse a
token, not a document.

`parseFilePointer`'s `stripFootnoteMarkers` call on the token goes away:
verified that `- [ ] ./a.ts#1[^fn1] note` yields `text` = `"./a.ts#1"` and the
reference as its own sibling node, so the marker can no longer be swallowed into
the token capture.

- [ ] `- [ ] ./a.ts#1[^fn1] note` parses `path` as `./a.ts` and `line` as `1`,
      with no marker-stripping step on the token
- [ ] a hunk with a multi-paragraph note keeps every paragraph in `note`, and a
      blank line between two paragraphs does not end the span
- [ ] the second-pointer finding still fires for `- [ ] ./a.ts#1 ./b.ts#2` and
      for `- [ ] ./a.ts#1 — ./b.ts#2`, scoped to the inline segment alone
- [ ] a below-pointer explanation that legitimately opens with a path
      (`./src/foo.ts is the caller`) is NOT refused
- [ ] `FILE_POINTER_RE`, `FILE_POINTER_TICK_RE`, `pointerEndIndex`, and
      `gatherNote` are gone from `src/ReviewDoc.ts`

## Task — nested hunks are the same hunks

**A two-space-indented `- [x] ./b.ts#2` parses as a nested list inside the
preceding item, not as a sibling.** Verified: the parent item's span swallows
the nested one whole. That line is a hunk and is cleared, so hunks are collected
recursively at any depth.

A parent's note must exclude its nested lists' source, or every nested hunk's
text is duplicated into its parent's note.

- [ ] a `- [x] ./file.ts#1` indented two spaces IS a hunk pointer
- [ ] the same line indented four spaces is a `code` node and is not a hunk
- [ ] the parent hunk's `note` does NOT contain its nested hunk's text
- [ ] the parent hunk's own span does not swallow the nested hunk for the
      purposes of "add a footnote" placement

## Task — `gtd uncheck` as a byte-preserving offset splice

`clearFilePointerTicks` becomes an **offset splice**, not a regex and not a
reserialization: walk the tree for every task item with `checked === true`,
resolve its box offset the same way package 02 does, and rebuild the string by
replacing exactly those single characters in the original content.

Every byte outside them survives, so the CRLF hazard the current whole-document
regex exists to avoid stays closed — a tick-only round on a CRLF checkout does
not become a whole-file diff at the review gate.

Total: micromark never fails, so a structurally broken file still gets its ticks
cleared — the property the current line-wise implementation was chosen for.

One behavior change to name: a `- [x]` inside a fenced code block is no longer
cleared. It was never a tick.

- [ ] a `- [x] ./file.ts#1` indented two spaces IS cleared by `gtd uncheck` —
      the live bug, where today the tick reaches a commit
- [ ] a CRLF document with one tick comes back with exactly one byte changed and
      every `\r\n` intact
- [ ] a document with no trailing newline is not given one
- [ ] a structurally broken document still gets its ticks cleared
- [ ] idempotent: a second pass changes nothing
- [ ] a `- [x]` inside a fenced code block is NOT cleared
- [ ] `gtd uncheck` on an untouched file writes nothing, so its mtime never
      moves

## Task — chunk ticking as an edit per list item

Chunk ticking stops being a document-wide multiline regex — the one able to
anchor across a blank line and drag a later line into the match — and becomes an
edit per list item.

- [ ] "check all hunks" produces one edit per hunk not already at the target
      state, and zero edits when the chunk is already uniform
- [ ] a `- [x] ./file.ts#1`-shaped line inside a fenced code block in a chunk
      description is neither a hunk pointer nor touched by ticking the chunk
- [ ] the toggle target rule is unchanged: check all unless a strict majority
      are already checked, an even split checking

## Task — delete the last line-based helpers

This package is the last caller of `isFootnoteDefinitionLine`,
`stripFootnoteMarkers`, `proseBlockEnd`, and `computeFenceSkip`. All four go.

- [ ] `isFootnoteDefinitionLine`, `stripFootnoteMarkers`, `proseBlockEnd`, and
      `computeFenceSkip` are gone from `src/Footnotes.ts`
- [ ] `npm run deadcode` reports nothing left behind
- [ ] no module in `src/` splits content on `/\r?\n/` to decide what a heading,
      a checkbox, or a footnote is

## Task — cucumber scenarios

- [ ] a `.feature` scenario ticks a two-space-indented hunk, lands, and shows
      the tick cleared at the review gate rather than reaching the commit
- [ ] a `.feature` scenario covers a chunk description containing a fenced
      `- [x] ./file.ts#1` and shows it untouched by both parsing and ticking
- [ ] Given steps are composable and expose the actual file content in the
      scenario text
