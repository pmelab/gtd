# Feedback — 01 — One parse per document, footnotes read off the tree

Build is green (`npm test`, `npm run build`, unit 1722 pass, e2e-inmem 317
pass). Four problems, one of them a real regression.

## 1. `footnotePointerAt` dead-ends on a two-space-indented definition continuation

`isFootnoteDefinitionLine` (still line-based: any indent continues a definition)
and the new tree-based `endLine` (GFM: four spaces required) now disagree, and
`footnotePointerAt` mixes both. Verified:

```
text[^fn1]
<blank>
[^fn1]:
  the reason
```

Cursor on line 3 (`  the reason`): `isFootnoteDefinitionLine` returns `true`, so
the definition branch is taken; no definition spans line 3 (`endLine` is now 2),
so it returns `{ pointer: undefined }`. That is "resolved, but to nothing" — per
`footnotePointerAt`'s own doc comment the caller must NOT fall through, so in
`review` the hunk jump is suppressed too. Before this package the same cursor
jumped to the marker.

Either `footnotePointerAt` stops trusting `isFootnoteDefinitionLine` for the
definition branch (use the tree's own `line`/`endLine` span), or the two are
made to agree. A test must pin whichever is chosen.

## 2. The "one parse per `validate` call" criterion is not asserted

The criterion is literal: _"asserted by reading the exported parse counter
across one `validate` call"_. No test calls `validate`. `getParseCount` appears
only in `src/MarkdownTree.test.ts`, always around direct `parseMarkdown` calls.
The thing the memo exists for — one `validate` call's footnote pass and format
pass sharing a single parse — is therefore unproven, and the spec's own stated
risk ("a future caller that reparses ... the counter test is the only thing that
fails") has no counter test guarding it.

Add: `getParseCount()` before/after one `qa`/`review` `validate(content)` on a
2000-line document, asserting a delta of exactly 1.

## 3. The line-1-column-1 conversion test never calls `toLspPosition`

`src/MarkdownTree.test.ts` does not import `toLspPosition`. The test inlines the
arithmetic:

```ts
expect(paragraph.position!.start.line - 1).toBe(0)
expect(paragraph.position!.start.column - 1).toBe(0)
```

`1 - 1 === 0` is a tautology over literals the test itself just asserted.
`toLspPosition` could return `{ line: point.line, character: point.column }` and
this passes. The criterion — "a node starting on source line 1 column 1 converts
to LSP line 0 character 0" — is about the exported converter; call it.

## 4. `markerAt` still hand-computes the marker span

The spec: _"`markerAt`'s hand-computed span (`character + name.length + 3`) is
replaced by the reference node's own position."_ `src/Footnotes.ts` still
carries `const end = m.character + m.name.length + 3`, and `FootnoteMarker`
carries no end position, so it cannot do otherwise. Either carry the reference
node's own end position on `FootnoteMarker` (orphan markers get theirs from
`match.index + match[0].length`), or amend the package file — but do not leave
the arithmetic while the spec says it is gone.

## Also worth a decision, not necessarily a change

- Three behavior changes to state landed by rewriting existing test
  expectations, but only ONE (case-insensitive matching) is declared in the
  spec. The other two: a two-space-indented line is no longer a definition
  continuation, and an unindented line now IS one (lazy paragraph continuation).
  Item 1 above is the concrete damage; if the rest is intended, say so somewhere
  a reader will find it.
- `sourceText`'s criterion says it keeps "inline code, links, and emphasis"
  verbatim. Only inline code is tested.
