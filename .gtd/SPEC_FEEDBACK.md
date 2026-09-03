# Spec feedback — 02 The `qa` format on the tree

## `optionText` slices the marker line with a character index from a different line

`src/OpenQuestions.ts`'s `optionText` takes `optionContentOffset(item)` — an
absolute offset that can land on a CONTINUATION line — converts it to a
`character`, then slices `lines[sourceLine]` (the marker's own line) at that
character. When an option's checkbox is alone on its line and its text starts on
the next (indented or lazy) line, the paragraph's first child begins at column 1
of that next line, so `character === 0` and the slice returns the whole marker
line. The option's `text` becomes the marker itself.

Repro (`parseOpenQuestions`):

```
## Open Questions

### Q?

- [ ]
  text here
- [ ] _your answer_
```

→ first option `text: "- [ ]"`. Expected `""` (the package's own doc comment
pins `optionText` to "matching the OLD per-line regex capture", and the old
`CHECKBOX_RE` captured `""` here).

Two consequences, both user-visible:

- the outline renders that option as `[ ] - [ ]`
- a ticked free-text slot answered on its continuation line
  (`- [x]\n  my own answer` as the last option) gets `text: "- [x]"` — non-empty
  by accident, not by the human's text, so `answered` flips to `true` for the
  wrong reason. Old behavior read `""` → unanswered.

The fix belongs in `optionText`: derive the slice line from the offset too (or
return `""` when the content offset's line is past `sourceLine`), not from
`item.position.start` alone.

No test covers a checkbox whose text lives only on a continuation line —
`src/OpenQuestions.test.ts`'s wrap tests (`option line span (endLine)`) all put
text on the marker line, so the whole `text`/`answered` half of this shape is
unasserted. Add both the unchecked and the ticked-free-text variant.
