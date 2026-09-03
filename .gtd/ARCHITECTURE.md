Replace three hand-rolled line scanners with one shared markdown tree, then
spend the positions that tree gives back on findings, outlines, and editor
jumps.

Every design decision below was checked against the real parser
(`mdast-util-from-markdown` 2.0.3 plus the GFM footnote and task-list-item
extensions), not against its documentation. Three of those checks changed the
plan and are called out where they land.

## Open Questions

### How is "one parse per document" enforced — a memo inside the tree module, or a parsed tree threaded through `SteeringFormat`'s four methods?

- [ ] A one-entry memo keyed by the content string, private to the tree module —
      `validate`/`outline`/`actions`/`pointerAt` keep their `content: string`
      signatures, so `Lsp.ts`, `SteeringMode.ts`, `program.ts`, and
      `EmittedScriptRecognizer.ts` are untouched. Parse-once is a caching
      property, asserted by an exported parse counter.
- [ ] Thread the tree: `SteeringFormat` grows a `parse` member and its four
      methods take the tree instead of a string. Parse-once becomes structural
      and unfakeable, at the cost of changing the interface and all five call
      sites, plus every format test's setup.
- [ ] _your answer_

### Does a finding carry a single `character`, or a full start/end range?

- [ ] `character` only — enough for `file:line:col:` and a caret. The LSP
      diagnostic still has to guess where the underline ends, so it keeps
      underlining the whole line.
- [ ] A full range from the offending node's own boundaries — the LSP underlines
      exactly the heading, option, or marker, and `file:line:col:` prints the
      range's start. Costs a wider `SteeringFinding` and a rule for what every
      existing positioned finding's end is.
- [ ] _your answer_

## Concern 1 — One parse per document, footnotes read off the tree

Primary paths: `src/MarkdownTree.ts` (new), `src/Footnotes.ts`, `package.json`,
`package-lock.json`.

### The parser and the dependencies

`mdast-util-from-markdown` called directly, with
`micromark-extension-gfm-footnote` + `mdast-util-gfm-footnote` and
`micromark-extension-gfm-task-list-item` + `mdast-util-gfm-task-list-item`. Five
runtime dependencies, plus `@types/mdast` as a dev dependency for the node
types.

Both micromark extensions and both mdast extensions are **factory functions**
that must be called — `gfmTaskListItem()`, not `gfmTaskListItem`. Passing the
uncalled function is silently accepted and yields `listItem.checked === null` on
every item, so the whole `qa`/`review` migration reads as "no checkboxes
anywhere". This is the single most likely way to get the wiring wrong and it
fails quietly, not loudly.

`tsdown.config.ts` sets `alwaysBundle: [/.*/]`, so all five land inside
`dist/gtd.bundle.mjs` — already 10 MB; the micromark family adds a few hundred
KB. No bundling work, no new externals.

Adding dependencies rewrites `package-lock.json`; the tree already carries
unrelated lock churn from an earlier install, which lands here as noise.

### `src/MarkdownTree.ts`

The one place that owns the parse and the coordinate conversion:

- `parseMarkdown(content)` → the mdast root, with both GFM extensions wired.
  micromark never fails: any input parses to some tree, so every current "total,
  never throws, always returns a result" contract survives unchanged.
- Position conversion. mdast gives **1-based line, 1-based column, 0-based
  offset**; the LSP wants **0-based line, 0-based character**. Every `- 1` lives
  here and nowhere else.
- `sourceText(content, node)` → the node's own source slice with every
  descendant `footnoteReference` range excised and whitespace runs collapsed to
  single spaces. This is what replaces both `stripFootnoteMarkers` and today's
  `line.trim()`-and-join body composition, and it keeps inline code, links, and
  emphasis verbatim.
- `blockNodeAt(tree, line)` → the top-level block containing a 0-based line,
  which replaces `proseBlockEnd`'s "scan to the next blank line".
- `taskItems(node)` → every `listItem` with `checked !== null`, **recursively at
  any nesting depth**. Required by concern 3; see the nesting note there.

### Footnotes off the tree

`footnoteReference` nodes become markers, `footnoteDefinition` nodes become
definitions. Deleted outright, not ported: `FENCE_RE`, `maskInlineCode`,
`MARKER_RE`, `DEFINITION_START_RE`, `scanMarkers`, `parseDefinitionAt`, and
`isContinuationLine`. `markerAt`'s hand-computed span
(`character + name.length + 3`) is replaced by the reference node's own
position.

A definition's `body` becomes `sourceText` over its children — so a
multi-paragraph definition and an inline-code-carrying definition both come out
right without a continuation-line walker.

**An orphan `[^name]` is not a footnote reference.** GFM requires a matching
definition for a reference to be recognized at all; without one the text stays
inside an ordinary `text` node. Verified directly: `Some text[^fn1] here.` with
no definition parses to a single `text` node whose value is the literal
`"Some text[^fn1] here."`. Reading markers off `footnoteReference` nodes alone
therefore **deletes the "marker has no matching definition" finding** — one of
the four live footnote checks.

The fix: after the tree walk, scan for `[^name]` **only inside `text` nodes'
source slices**, and treat each hit as an orphan marker. This stays tree-native,
because a `text` node is exactly the content the tree has already decided is
prose — a fence, an indented code block, and an inline-code span are all other
node types and are excluded structurally rather than by a hand-rolled skip list.
That is what actually delivers this concern's four mis-read acceptance cases.

Scan the **source slice**
(`content.slice(node.position.start.offset, node.position.end.offset)`), never
`node.value`: a character reference such as `&amp;` makes `value` shorter than
its source, and every subsequent column in that node would be off by the
difference. A `text` node can also span several lines (a lazy list-item wrap
parses as one), so a hit's position comes from `start.offset + indexInSlice`
mapped back through the offset→line/column conversion, never from assuming one
line per node.

**Definition matching moves from case-sensitive to case-insensitive.** mdast
normalizes `identifier` to lowercase and keeps the raw text in `label`. Match on
`identifier`, render messages from `label`. So `[^FN1]` now resolves to
`[^fn1]: …` where today it is an orphan marker plus an unreferenced definition —
two findings become zero.

### What survives this package on purpose

`isFootnoteDefinitionLine`, `stripFootnoteMarkers`, and `proseBlockEnd` keep
their current line-based implementations and signatures, because both formats
still call them and this concern's own acceptance is that both stay green
without moving. `computeFenceSkip` therefore survives one package longer, scoped
to `isFootnoteDefinitionLine` as its only remaining caller, carrying a comment
naming the condition for its removal. Concern 3 deletes all four — it is the
last caller, so **concern 2 must land before concern 3.**

### Acceptance

A footnote definition below a fence opened _above_ the enclosing question or
chunk is not a definition — today's fence check is handed a slice of the
document, so a fence opened before the slice starts is invisible to it. Plus the
four mis-reads: `[^name]` in a four-space indented code block, in a `~~~` fence,
in a double-backtick span, and a definition inside an inline-code span.

Parsing a 2000-line document performs one parse, not one per line — counted, not
timed. How that count is enforced is the first open question.

## Concern 2 — The `qa` format on the tree

Primary path: `src/OpenQuestions.ts`.

Sections are `heading` nodes of `depth === 2`; questions are `depth === 3`
headings between a section heading and the next heading of depth ≤ 2. Options
are the `listItem`s with `checked !== null` in the list following a question
heading; `listItem.checked` replaces `CHECKBOX_RE` and `option.endLine` becomes
the item's own end line, so continuation-indent inference is gone.

`checkSectionOrder` compares `depth === 2` heading nodes and drops
`lines.findIndex` entirely. Section identity stays a literal text match on the
heading's own text.

`itemEndIndex` and the `isFootnoteDefinitionLine` call inside it are deleted: a
`footnoteDefinition` is a sibling block node, never inside a list item, so the
tree already ends the item where the definition begins.

### The checkbox's real offset

`toggleCheckbox`'s `raw.indexOf("[")` — a guess that can land on a `[` earlier
in the line — is replaced by an exact offset. The task-list extension
**consumes** the `[x]` marker: the item's first paragraph starts _after_ `] `,
so no node's boundary is the box itself. Resolve it as the first `[` at or after
the `listItem`'s start offset, bounded by the first paragraph's start offset.
That window contains only the list marker and the box, so the result is exact
and cannot pick up prose.

### Acceptance

A `## Open Questions` line inside a fenced code block is not that section —
verified: it parses to a `code` node, so a requirements file that documents its
own format stops reporting a bogus section-order finding.

Strict reading: a `### ` indented four or more spaces is a `code` node and no
longer a question heading; a `- [ ]` indented four or more spaces is likewise no
longer an option. Two or three spaces still count — verified: `  ### two spaces`
is a `depth: 3` heading, `    ### four spaces` is a `code` node. A file relying
on the loose reading loses that question or option and says so with a positioned
finding.

The free-text slot stays identified positionally — the last option in the block
— not by label.

## Concern 3 — The `review` format on the tree

Primary path: `src/ReviewDoc.ts`.

The header is the first block node, required to be a `depth === 1` heading
matching `Review: <hash>`. The base comment is an `html` node matching
`BASE_COMMENT_RE` — verified: `<!-- base: 0000 -->` on its own line parses to a
block-level `html` node. Chunks are `depth === 2` headings. Hunk pointers are
task items inside a chunk; the pointer token is the first word of the item's
first paragraph and the note is `sourceText` over the rest, so a multi-paragraph
explanation needs no `pointerEndIndex` and no `gatherNote`.

`FILE_POINTER_RE`, `FILE_POINTER_TICK_RE`, `pointerEndIndex`, and `gatherNote`
are all deleted. `POINTER_LINE_RE` and `isPointerToken` stay — they parse a
token, not a document.

`parseFilePointer`'s `stripFootnoteMarkers` call on the token goes away:
verified that `- [ ] ./a.ts#1[^fn1] note` yields `text` = `"./a.ts#1"` and the
reference as its own sibling node, so the marker can no longer be swallowed into
the token capture.

This package deletes `isFootnoteDefinitionLine`, `stripFootnoteMarkers`,
`proseBlockEnd`, and `computeFenceSkip` — it is their last caller.

### Nested hunks are the same hunks

**A two-space-indented `- [x] ./b.ts#2` parses as a nested list inside the
preceding item, not as a sibling.** Verified: the parent item's span swallows
the nested one whole. Requirement 3 says that line is a hunk and is cleared, so
hunks are collected with `taskItems`, recursively at any depth. A parent's note
must then exclude its nested lists' source, or every nested hunk's text is
duplicated into its parent's note.

### `gtd uncheck` stays byte-preserving

`clearFilePointerTicks` becomes an **offset splice**, not a regex and not a
reserialization: walk the tree for every task item with `checked === true`,
resolve its box offset the same way concern 2 does, and rebuild the string by
replacing exactly those single characters in the original content. Every byte
outside them survives, so the CRLF hazard the current whole-document regex
exists to avoid stays closed — a tick-only round on a CRLF checkout does not
become a whole-file diff at the review gate.

Idempotent (no `[xX]` box is left for a second pass) and total (micromark never
fails, so a structurally broken file still gets its ticks cleared — the property
the current line-wise implementation was chosen for).

One behavior change to name: a `- [x]` inside a fenced code block is no longer
cleared. It was never a tick.

### Acceptance

A `- [x] ./file.ts#1` indented two spaces is a hunk pointer AND is cleared by
`gtd uncheck`. This is the live bug: today the chunk-body parser matches it on
the _trimmed_ line so it counts as ticked, while the clearing regex anchors `-`
at column 0 and never touches it — so that tick reaches a commit, which is
exactly what the review-gate reset exists to prevent. The same line indented
four spaces is a `code` node and is neither.

A `- [x] ./file.ts#1`-shaped line inside a fenced code block in a chunk
description is neither a hunk pointer nor touched by ticking the chunk.

## Concern 4 — Findings and outlines that point at the offending token

Primary paths: `src/SteeringFormat.ts`, `src/program.ts`, `src/Lsp.ts`, with
one-line finding-site edits in `src/OpenQuestions.ts` and `src/ReviewDoc.ts`.

### The finding shape

`SteeringFinding` grows a position beyond `line` — a single `character` or a
full range, per the second open question. The field stays **optional and flat**
rather than a discriminated union, because `SteeringMode.ts`'s `findingsFrom`
must keep emitting a bare `{ message }` for every line a shell `validate:`
command prints. The invariant "a position is meaningless without a `line`" is
pinned by a test, not by the type.

`parseReviewDoc` and `parseReviewFindings` collapse into one function.
`ReviewDoc.errors: readonly string[]` becomes findings, which removes the only
reason a second parse function existed — routing around its own return type.
`OpenQuestionsDoc.errors` gets the same treatment.

Positions get attached to: `qa`'s bare-`###` finding and both section-order
findings; `review`'s chunk-has-no-pointers finding (at the chunk heading); and
all four footnote findings, which already know the marker's or definition's
column and drop it today. Unanswered-question output in
`runOpenQuestionsCheckCommand` starts naming the heading line.

### `gtd check` output

`formatFinding` prints `file:line:col: message` — the shape editors and
grep-style tools already jump on, so a driver's raw output becomes clickable. It
prints today's `file:line: message` for a finding with a line and no column, and
a bare message for a finding about the whole document. Both remaining line-only
cases are `review`'s: the missing-header finding is positioned at the first
block node (the wrong heading is a real place to point), while missing-base
stays positionless when the document has no base comment at all — there is no
offending token when the thing is simply absent.

`docs/cli.md`'s `## Commands` block and exit-code table are pinned to rendered
help output; adding a column to a finding changes neither, so no doc regen is
expected here.

### Outlines and links

Outline node ranges stop being computed as _next sibling's heading minus one_ —
a guess that swallows trailing blank lines and any intervening content — and
come from a section span walked over nodes: the heading through the last block
before the next heading of depth ≤ its own.

Hunk pointers become **document links**. That needs a new optional
`SteeringFormat` member returning each pointer token's precise range plus its
target path and line, declared by `review` and absent on `qa`; `Lsp.ts` gains an
`onDocumentLink` handler, the matching server capability, and the new handler
name in its handler-name union. Path resolution against the repo root stays the
LSP's concern, exactly as it already is for `pointerAt`. Deriving links by
calling `pointerAt` per line is rejected: it is one call per line and cannot
produce the token's own range, which is the whole point.

### Acceptance

`gtd check qa` on a file whose `## Answered Questions` is followed by another
`##` section reports that finding with a position; today it prints a bare
message with no position at all. The LSP diagnostic for it underlines the
offending heading instead of spanning the whole document, which is the current
fallback for any unpositioned finding.

**Scoped condition, not a regression**: a mode whose `validate:` shells out to
`gtd check` gets each stdout line back as an opaque, positionless message,
because a shell command's findings can never carry one. On that path the new
column rides inside the message text, exactly as the line number already does.
`gtd validate` emits a script and reads no files, so it is untouched.

## Merged Concerns

None. Each concern's file footprint centers on a different module —
`Footnotes.ts` plus the new `MarkdownTree.ts`, then `OpenQuestions.ts`, then
`ReviewDoc.ts`, then `SteeringFormat.ts`/`program.ts`/`Lsp.ts` — and each later
concern only consumes what the earlier one created rather than reworking it.
Concerns 2 and 3 are fully disjoint. Concern 4 touches both, but only at
existing finding-construction sites, one line each; its own center of gravity is
the finding shape and the two consumers that spend it, and it cannot merge into
2 or 3 individually because it spans both. Merging 2, 3, and 4 into one package
would collapse three independently greenable slices into a blob for no gain.

The one ordering coupling: concern 3 deletes the four line-based helpers concern
2 still calls, so 2 must land before 3.

## Answered Questions

### Which markdown parser?

`mdast-util-from-markdown` with the two GFM extensions, called directly. The
code needs a syntax tree and nothing else — no plugins, no transformers, no
stringifier — so `unified` + `remark-parse` would buy a plugin pipeline nobody
uses and inline a larger dependency graph into a bundle that bundles everything.

### Where does the tree's coordinate conversion live?

One new module, `src/MarkdownTree.ts`, owns the parse and every 1-based-to-
0-based conversion. mdast and the LSP disagree on both line and column bases;
scattering that arithmetic across three formats is how off-by-one bugs get
written four times.

### How do document links get their ranges — a new format member, or derived from `pointerAt`?

A new optional `SteeringFormat` member. `pointerAt` answers "what is at this
cursor position" and would need one call per line to enumerate links, and it
returns no range for the token it matched — which is precisely what a document
link is.

### Does an orphan `[^name]` still report a finding?

Yes, via a `[^name]` scan restricted to `text` nodes' source slices. GFM does
not create a `footnoteReference` without a matching definition, so the tree
alone cannot see an orphan marker. Restricting the scan to `text` nodes keeps
fences, indented code, and inline code excluded structurally.

### Is `stripFootnoteMarkers` ported to the tree?

No, deleted. Extracted text is built by slicing source and excising
`footnoteReference` node ranges, which is exact and also removes the
token-corruption workaround in the review format's pointer parser.

### Does `SteeringFinding` become a discriminated union once it carries a position?

No. It stays flat with optional fields, because a shell `validate:` command's
findings are inherently positionless and `findingsFrom` must keep constructing
`{ message }` alone. A test pins the invariant instead.

### Is missing-base positioned?

No. A missing `<!-- base: … -->` comment has no offending token to point at, so
it stays a whole-document finding. Missing-header does get a position: the
document's wrong first block node is a real place to send a reader.
