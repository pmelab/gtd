# Spec feedback — 01 Footnotes are structure in the `qa` and `review` formats

Three problems. All verified by running the built code, not read off the diff.

## 1. A marker on a hunk pointer token silently corrupts the path

The requirement lists "a hunk pointer line" among the places a marker must be
recognised. `FILE_POINTER_RE`'s token group is `(\S+)`, so a marker written
directly against the pointer — the most natural way to comment on a hunk — is
swallowed into the token, and `POINTER_LINE_RE` then fails to split off the
`#<line>` suffix:

| input                       | parsed `path`    | parsed `line` | findings |
| --------------------------- | ---------------- | ------------- | -------- |
| `- [ ] ./a.ts#1[^fn1]`      | `./a.ts#1[^fn1]` | absent        | none     |
| `- [ ] ./a.ts#1 [^fn1]`     | `./a.ts`         | `1`           | none     |
| `- [ ] ./a.ts#1 note[^fn1]` | `./a.ts`         | `1`           | none     |

Only the space-separated forms work. The first row is a broken, non-navigable
hunk with no error — `reviewPointerAt` hands the LSP a path that does not exist,
and the validator says the document is fine. Markers must be stripped from the
pointer token before `isPointerToken`/`POINTER_LINE_RE` see it.

## 2. Markers are not stripped from three extracted text fields

Settled decision: "Markers are stripped from every extracted text field." The
requirement names "a chunk heading or description" explicitly. Three fields
still carry the raw marker:

- `ReviewDoc.ts` chunk `title` (`## Add calculator[^fn1]` →
  `"Add calculator[^fn1]"`)
- `ReviewDoc.ts` chunk `description` (`some description[^fn2]` →
  `"some description[^fn2]"`)
- `OpenQuestions.ts` `question.question` (`### Which API[^fn3]?` →
  `"Which API[^fn3]?"`)

Only `note`, `option.text`, and `question.text` got `stripFootnoteMarkers`. The
leak is user-visible: `reviewOutline` renders `${chunk.title} (0/1)`, so a
chunk-heading marker shows up verbatim in the editor outline next to the
footnote leaf it produced.

## 3. `leaf: true` is kept on `qa` option nodes that now have `children`

`SteeringFormat.ts` documents the field as: "`leaf: true` marks a node with no
children of its own". `questionsOutline` now spreads `children` onto an option
node while leaving its `leaf: true` in place. `Lsp.ts`'s `toDocumentSymbol`
reads that flag directly and emits `SymbolKind.Boolean` for a symbol that
carries children — a checkbox icon on a container. `ReviewDoc.ts`'s chunk nodes
got this right (children, no `leaf`); the `qa` option nodes did not. Either drop
`leaf` when footnote children are attached, or change the documented invariant —
but not neither.

## Minor: `isFootnoteDefinitionLine` is not fence-aware

`parseFootnotes` skips fenced code blocks, so a `[^x]:` line inside a fence
yields no definition. `isFootnoteDefinitionLine` has no fence tracking, so
`pointerEndIndex`, `gatherNote`, `parseChunkBody`, and `itemEndIndex` all break
their span on that same line anyway. The two exported functions disagree about
what a definition is. Low impact, but it is the kind of drift the "scanning
skips code" rule exists to prevent.

## Not problems — checked and clean

- `npm test` green; `npm run format:check` green; both samples are oxfmt fixed
  points and validate to zero findings
- All Task 1 acceptance criteria have a matching test, including the totality
  property, the four-space and two-space continuations, and the no-placement-
  finding case
- `clearFilePointerTicks` is proven byte-identical on a definition line
- The mid-note truncation is tested and documented as the accepted cost
