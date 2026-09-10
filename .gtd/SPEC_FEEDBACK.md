# Package 02 — spec feedback

`npm test` is green and Tasks 1, 3 and 4 hold. Task 2's text projection is wrong
in two ways, both reachable from ordinary plan markdown and both unasserted by
the new tests (every new case is single-line).

## 1. A list item's `text` swallows its own nested list — the nested item renders twice

`childrenText` (`src/OpenQuestions.ts#1063`) builds a synthetic node spanning
`children[0].position.start`..`children[last].position.end` and then slices the
RAW source over that span. `listItemText` (`#1080`) filters `c.type !== "list"`
out of the children array first, but that filter changes only the span's
endpoints — every byte between them, the nested list's own source included, is
still inside the slice.

    - Top

      - Nested

      Tail para.

yields
`items: [{ text: "Top - Nested Tail para.", items: [{ text: "Nested" }] }]`.
`ProseBlock`'s `BlockList` renders `item.text` and then `item.items`, so
"Nested" appears twice on screen — once as literal `- Nested` inside the
parent's line, once as the real nested `<li>`.

This contradicts `BlockListItem.text`'s own doc comment ("EXCLUDING any nested
list under it", `src/SteeringFormat.ts`) and T2's criterion that the `items`
tree's nesting matches the source.

- [ ] a list item with a nested list AND a trailing paragraph of its own yields
      `text` containing neither the nested item's text nor its `-` marker, with
      that item present exactly once in the `items` tree

## 2. A multi-line blockquote's `text` keeps the `>` markers

Same root cause, one level up: `blockTitle` (`#1113`) / `blockOf`'s `blockquote`
branch (`#1143`) call `childrenText` over the quote's children, so the
continuation lines' `> ` prefixes fall inside the slice and survive the
whitespace collapse.

    > First line.
    >
    > Second para.

yields `block: { kind: "blockquote", text: "First line. > > Second para." }` and
the same string as `title` — markdown syntax rendered verbatim to the user.
`SteeringViewNode.block.text` documents itself as the quote text "verbatim";
this is the quote text plus its own markers. The doc comment on `childrenText`
claims it "never includes the CONTAINER's own leading syntax" — true only for
the first line.

- [ ] a blockquote spanning two paragraphs carries `text` with no `>` character
      in it

## 3. An empty fenced code block yields an empty `title`

    ```
    ```

yields `{ title: "", block: { kind: "code", text: "" } }`. T2's criterion "every
node still carries a non-empty `title`" is asserted only over a document whose
every block has content, so the suite passes. Either give `code` a non-empty
fallback title or make the criterion's test cover the empty fence.

- [ ] a fenced code block with an empty body still carries a non-empty `title`

## 4. The heading-note story cannot fail on a wrong anchor line

`NoteAttachesToAHeadingOnItsOwnLine` (`src/web/screens/Plan.stories.tsx`)
renders ONE node, at line 0, and asserts `paragraph-note-0` — which is keyed by
array INDEX. Index 0 and line 0 coincide, so the story passes whether the note
lands on the heading's anchor line or on its array position. T4's criterion is
"asserts it lands on that heading's own line": put the heading at a non-zero
line behind at least one preceding block, or assert the `writeNote` anchor the
way `RealContainerWriteThroughsAParagraphNoteViaWriteNote` does.
