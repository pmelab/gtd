# 01 — One parse per document, footnotes read off the tree

## Requirement

Bring in the markdown parser and make `Footnotes` read GFM footnote nodes
instead of scanning lines. Fenced code and inline code stop being special cases
the module tracks by hand — they are simply other node types — so the fence
tracker and the inline-code masker are deleted rather than ported. The parsed
document is produced once per file at the format entry point and handed down,
which is what actually retires the per-call fence recomputation the footnotes
work accepted: roughly 4M line tests on a 2000-line review file, re-run on every
keystroke in the LSP.

Both steering formats keep their current line-based parsing here and keep
consuming footnotes through the same helpers, so the suite stays green without
either format moving yet.

Adding dependencies rewrites `package-lock.json`; the human's tree already
carried unrelated lock churn from an install, which lands here as noise.

## Paths

- `src/MarkdownTree.ts` (new)
- `src/MarkdownTree.test.ts` (new)
- `src/Footnotes.ts`
- `src/Footnotes.test.ts`
- `package.json`, `package-lock.json`

## Task — add the parser dependencies

Five runtime dependencies: `mdast-util-from-markdown`,
`micromark-extension-gfm-footnote`, `mdast-util-gfm-footnote`,
`micromark-extension-gfm-task-list-item`, `mdast-util-gfm-task-list-item`. Plus
`@types/mdast` as a dev dependency for the node types.

`tsdown.config.ts` sets `alwaysBundle: [/.*/]`, so all five land inside
`dist/gtd.bundle.mjs` — already 10 MB; the micromark family adds a few hundred
KB. No bundling work and no new externals: do not touch `tsdown.config.ts`.

- [ ] `npm run build` succeeds and `dist/gtd.bundle.mjs` runs, with no entry
      added to `tsdown.config.ts`
- [ ] `npm test` passes — dependency addition alone changes no behavior

## Task — `src/MarkdownTree.ts`: the parse and the coordinate conversion

The one module that owns the parse. Nothing else in `src/` calls
`mdast-util-from-markdown` directly.

Both micromark extensions and both mdast extensions are **factory functions that
must be called** — `gfmTaskListItem()`, not `gfmTaskListItem`. Passing the
uncalled function is silently accepted and yields `listItem.checked === null` on
every item. This is the single most likely way to get the wiring wrong and it
fails quietly, not loudly.

Exports:

- `parseMarkdown(content)` → the mdast root with both GFM extensions wired.
- Position conversion: mdast gives **1-based line, 1-based column, 0-based
  offset**; the LSP wants **0-based line, 0-based character**. Every `- 1` lives
  here and nowhere else.
- `sourceText(content, node)` → the node's own source slice with every
  descendant `footnoteReference` range excised and whitespace runs collapsed to
  single spaces. Keeps inline code, links, and emphasis verbatim.
- `blockNodeAt(tree, line)` → the top-level block containing a 0-based line.
- `taskItems(node)` → every `listItem` with `checked !== null`, **recursively at
  any nesting depth**.
- A parse counter, so "one parse" is assertable.

- [ ] `- [x] a` yields `listItem.checked === true`, proving both task-list
      extensions are called and not passed uncalled
- [ ] micromark never fails: a fuzz/property test over arbitrary strings shows
      `parseMarkdown` always returns a root and never throws
- [ ] a node starting on source line 1 column 1 converts to LSP line 0 character
      0
- [ ] `sourceText` over a paragraph containing `` `a[^fn1]b` `` and a real
      `[^fn2]` reference returns the inline code verbatim and drops only the
      reference
- [ ] `taskItems` returns both items for a `- [x] a` with a two-space-indented
      `- [x] b` nested under it

## Task — a one-entry memo, so one `validate` call parses once

A one-entry memo keyed by the content string, private to `MarkdownTree.ts`.
`validate`/`outline`/`actions`/`pointerAt` keep their `content: string`
signatures, so `src/Lsp.ts`, `src/SteeringMode.ts`, `src/program.ts`, and
`src/testing/EmittedScriptRecognizer.ts` are untouched, and one `validate`
call's footnote pass and format pass share a single parse.

**Risk: parse-once is a caching property here, not a structural one.** A future
caller that reparses, or a format that mutates the tree it is handed, breaks it
silently — nothing in a type refuses either. The counter test is the only thing
that fails.

The memo holds the last document's text and tree alive — kilobytes for a
2000-line file, bounded at one entry.

- [ ] parsing a 2000-line document performs one parse, not one per line —
      asserted by reading the exported parse counter across one `validate` call,
      never by timing
- [ ] two `parseMarkdown` calls with the same string return the identical tree
      object and advance the counter once
- [ ] a second, different string evicts the first — the counter advances again
      and memory holds one entry, not two

## Task — footnotes off the tree

`footnoteReference` nodes become markers, `footnoteDefinition` nodes become
definitions. A definition's `body` becomes `sourceText` over its children, so a
multi-paragraph definition and an inline-code-carrying definition both come out
right without a continuation-line walker.

Deleted outright, not ported: `FENCE_RE`, `maskInlineCode`, `MARKER_RE`,
`DEFINITION_START_RE`, `scanMarkers`, `parseDefinitionAt`, `isContinuationLine`.
`markerAt`'s hand-computed span (`character + name.length + 3`) is replaced by
the reference node's own position.

- [ ] a footnote definition below a fence opened _above_ the enclosing question
      or chunk is not a definition — today's fence check is handed a slice of
      the document, so a fence opened before the slice starts is invisible to it
- [ ] `[^name]` inside a four-space indented code block is not a marker
- [ ] `[^name]` inside a `~~~` fence is not a marker
- [ ] `[^name]` inside a double-backtick span is not a marker
- [ ] a `[^name]:` definition inside an inline-code span is not a definition
- [ ] a multi-paragraph definition's `body` carries all its paragraphs
- [ ] `maskInlineCode`, `FENCE_RE`, `MARKER_RE`, `DEFINITION_START_RE`,
      `scanMarkers`, `parseDefinitionAt`, and `isContinuationLine` are gone from
      `src/Footnotes.ts`

## Task — keep the orphan-marker finding alive

**An orphan `[^name]` is not a footnote reference.** GFM requires a matching
definition for a reference to be recognized at all; without one the text stays
inside an ordinary `text` node. Verified: `Some text[^fn1] here.` with no
definition parses to a single `text` node whose value is the literal
`"Some text[^fn1] here."`. Reading markers off `footnoteReference` nodes alone
therefore **deletes the "marker has no matching definition" finding** — one of
the four live footnote checks.

The fix: after the tree walk, scan for `[^name]` **only inside `text` nodes'
source slices**, and treat each hit as an orphan marker. A fence, an indented
code block, and an inline-code span are all other node types, so they are
excluded structurally rather than by a hand-rolled skip list.

Scan the **source slice**
(`content.slice(node.position.start.offset, node.position.end.offset)`), never
`node.value`: a character reference such as `&amp;` makes `value` shorter than
its source, and every subsequent column in that node would be off by the
difference. A `text` node can also span several lines (a lazy list-item wrap
parses as one), so a hit's position comes from `start.offset + indexInSlice`
mapped back through the offset→line/column conversion, never from assuming one
line per node.

- [ ] `Some text[^fn1] here.` with no definition still reports "Footnote marker
      has no matching definition", positioned at the `[`
- [ ] an orphan `[^fn1]` preceded on the same line by `&amp;` reports the
      marker's TRUE column — the case that fails if `node.value` is scanned
      instead of the source slice
- [ ] an orphan marker on the second line of a lazy list-item wrap reports line
      two, not the `text` node's start line
- [ ] an orphan `[^fn1]` inside a fence, an indented code block, and an
      inline-code span reports nothing
- [ ] `nextFootnoteName` counts orphan markers, so it never reuses a name that
      is already written but undefined
- [ ] `isOnExistingFootnote` refuses "add a footnote" inside an orphan marker's
      span

## Task — definition matching becomes case-insensitive

mdast normalizes `identifier` to lowercase and keeps the raw text in `label`.
Match on `identifier`, render messages from `label`.

**This is a behavior change to state, not a bug**: `[^FN1]` now resolves to
`[^fn1]: …` where today it is an orphan marker plus an unreferenced definition —
two findings become zero.

- [ ] `[^FN1]` with a `[^fn1]:` definition reports zero findings and jumps
      between the two
- [ ] a finding's message renders the author's own casing from `label`, not the
      normalized `identifier`

## Task — leave the formats' line-based helpers standing

`isFootnoteDefinitionLine`, `stripFootnoteMarkers`, and `proseBlockEnd` keep
their current line-based implementations and signatures, because both steering
formats still call them and this package's acceptance is that both stay green
without moving.

`computeFenceSkip` therefore survives, scoped to `isFootnoteDefinitionLine` as
its only remaining caller, carrying a comment naming the condition for its
removal.

- [ ] `isFootnoteDefinitionLine`, `stripFootnoteMarkers`, and `proseBlockEnd`
      keep their exact signatures, and every existing caller compiles unchanged
- [ ] `computeFenceSkip` is private to `isFootnoteDefinitionLine` and carries a
      comment naming when it goes
- [ ] `npm test` passes with both steering formats still line-based

## Task — cucumber scenarios

- [ ] a `.feature` scenario covers a steering file that quotes its own format
      inside a fence and still validates clean, driven through `gtd check`
- [ ] Given steps are composable and expose the actual file content in the
      scenario text, rather than hiding setup behind an abstract step name
