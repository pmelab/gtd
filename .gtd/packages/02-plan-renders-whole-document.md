# 02 — The plan renders as the whole document, structure intact

## Requirement

"Read the plan" shows a plan nobody can read. The row itself is fine — it writes
a `gtd:plan-read:<contentHash>` flag and shows a `✓`, and it stays exactly as it
is. The renderer is the bug: `paragraphNodesOf` (`src/OpenQuestions.ts#1069`)
keeps top-level `paragraph` nodes only, and is scoped to everything before the
`## Open Questions` section. Every heading, list, code block and blockquote is
dropped silently, and so is everything after the questions section. A
heading-and-list plan arrives as a handful of orphan sentences.

Render the whole document with its structure: headings, lists, code blocks,
blockquotes, and the content after the questions section too.

Every node the view emits carries a real, server-computed anchor, and the client
hands that anchor straight back to `annotate` to attach a footnote. Paragraphs
have one today; headings, lists and code blocks do not. Extending the node set
without extending anchors breaks note attachment on the new kinds — the anchor
work is inside this requirement, not after it.

This is the first product requirement to build. It changes the shape of
`view.nodes`, which the next two packages render against; doing it first means
their stories are written once against the final shape.

## Task 1 — `blockNodesOf`: every top-level block becomes a view node

`paragraphNodesOf` (`src/OpenQuestions.ts#1069`) becomes `blockNodesOf` and
drops both of its filters. It walks every top-level `tree.children` node in
document order and emits one view node per block, skipping exactly two things:

- the `## Open Questions` / `## Answered Questions` headings themselves — the
  client renders those as its own section headers
- every node inside a question's own span, from `parseOpenQuestions`'s
  `sourceLine`..`endLine`, already computed

Everything else — before the questions, between the two sections, after them —
becomes a block node. That is what "the content after the questions section too"
resolves to precisely, with no second scoping rule.

`questionsView` (`#1113`) drops `questionsSectionHeadingIndex` (`#1043`) and
`isProseOnly` (`#1027`) as scoping devices: `nodes` is
`[...blockNodes, ...questionNodes]`, and a prose-only document is simply one
where `questionNodes` is empty. The client already splits on
`status !== undefined`.

Paths: `src/OpenQuestions.ts`, `src/OpenQuestions.test.ts`.

- [ ] a document with a heading, a nested list, a fenced code block, a
      blockquote and two paragraphs yields six block nodes, in document order
- [ ] a document with questions yields block nodes for the prose BEFORE the
      questions section and for every block AFTER it, and none for any block
      inside a question's own span
- [ ] neither the `## Open Questions` nor the `## Answered Questions` heading is
      ever itself a block node
- [ ] a prose-only document yields the same block nodes and zero question nodes
- [ ] `questionsView` still calls `parseOpenQuestions` once and walks the tree
      once — never one parse per question or per option

## Task 2 — `SteeringViewNode.block`: the structure the client renders

One new optional field, and NO new anchor kind:

    readonly block?: {
      readonly kind: "paragraph" | "heading" | "list" | "code" | "blockquote"
      readonly depth?: number                   // heading level, 1–6
      readonly ordered?: boolean                // list
      readonly items?: readonly BlockListItem[] // list, recursive
      readonly language?: string                // code info string
      readonly text?: string                    // code body / quote text, verbatim
    }

with
`BlockListItem = { text: string; checked?: boolean; items?: readonly BlockListItem[] }`.
Nesting is unbounded and recursive. `title` keeps carrying the flattened
one-line text for every kind, so a client that ignores `block` still renders
something.

The server projects structure rather than shipping raw markdown for the client
to parse: `SteeringView` exists precisely so the client never re-derives domain
shape from file bytes, and a browser-side markdown parser would be a new runtime
dependency in the bundle for a job the server already has a parsed tree for.

Paths: `src/SteeringFormat.ts` (`#133`), `src/OpenQuestions.ts`,
`src/OpenQuestions.test.ts`.

- [ ] a heading node carries `block.kind: "heading"` and its real `depth`
- [ ] a list node carries `block.kind: "list"`, its `ordered` flag, and an
      `items` tree whose nesting matches the source — a list nested two deep
      yields two levels of `items`
- [ ] a task-list item carries its `checked` state on the item
- [ ] a fenced code block carries `block.kind: "code"`, its `language` from the
      info string (absent when the fence has none), and its body verbatim in
      `text` — leading whitespace intact
- [ ] a blockquote carries `block.kind: "blockquote"` and its text
- [ ] every node still carries a non-empty `title`
- [ ] `SteeringAnchor` gains no new member

## Task 3 — Anchors: one kind covers every block, code blocks excepted

`resolveQuestionsParagraphAnchor` (`src/OpenQuestions.ts#1178`) already resolves
through `blockNodeAt`, which returns ANY top-level block containing the line — a
heading, a list and a blockquote all resolve today, unchanged. Every block node
carries `{ kind: "paragraph", line }` at its own start line. `NoteSheet`'s
`ANCHOR_TITLE.paragraph` (`src/web/NoteSheet.tsx#5`) label changes to "Note on
this block", since it is no longer always a paragraph.

**A fenced code block renders but carries no note seam — every other kind gets
one.** `footnoteAttachEdits` puts the marker at the end of the anchor line,
which for a fenced block is the opening fence: a marker there would land in the
info string, corrupt the fence, and never parse as a footnote reference. So
`annotate` gains no code-block branch and the document can never be corrupted.
The server still emits the code block's `{ kind: "paragraph", line }` anchor
like every other node — withholding the affordance is the client's job, one
branch in Task 4's `ProseBlock`, not a hole in the view.

Paths: `src/OpenQuestions.ts`, `src/OpenQuestions.test.ts`,
`src/web/NoteSheet.tsx`.

- [ ] `annotate` with a `paragraph` anchor at a heading's start line attaches
      the marker at the end of that heading's own line and the definition after
      the heading's block
- [ ] `annotate` with a `paragraph` anchor at a list's start line and at a
      blockquote's start line each succeed, and the resulting document still
      passes that mode's own `validate` with zero findings
- [ ] a block node that already carries a footnote marker on its start line
      surfaces that note as `note`, for every block kind — not just paragraphs
- [ ] `annotate` gains no branch keyed on a code block
- [ ] the note sheet's title for a `paragraph` anchor reads "Note on this block"

## Task 4 — `ProseBlock`: render each kind, seam on all but code

`ProseParagraph` (`src/web/screens/Plan.tsx#101`) becomes `ProseBlock`,
switching on `node.block?.kind` — `heading` → an `h2`/`h3`/`h4` by `depth`,
`list` → a recursive `ul`/`ol`, `code` → `pre > code`, `blockquote` →
`blockquote`, and anything else (including `block` absent) → the `p` it renders
today. The note seam and the inline note row render below every kind EXCEPT
`code`, which renders neither. `ProseParagraphs` (`#144`) → `ProseBlocks`, keyed
on the anchor line exactly as now; `PlanBody`'s two call sites (`#259`, `#272`)
follow the rename.

Paths: `src/web/screens/Plan.tsx`, `src/web/screens/Plan.stories.tsx`.

- [ ] a story renders a plan containing a heading, a nested list, a fenced code
      block and a paragraph after the questions section, and asserts all four
      are on screen
- [ ] the heading renders as a real heading element at a level derived from
      `depth`, the nested list renders as nested list elements, and the code
      block renders inside `pre > code` with its body's whitespace intact
- [ ] a story attaches a note to a heading and asserts it lands on that
      heading's own line
- [ ] every block kind except `code` shows a note seam; the code block shows
      neither a seam nor an inline note row
- [ ] the "Read the plan" row still writes its `gtd:plan-read:<contentHash>`
      flag and shows its `✓` — unchanged behaviour, asserted
- [ ] `npm test` green
