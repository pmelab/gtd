import type { List, ListItem, RootContent, Root } from "mdast"
import { noteLookup } from "./Footnotes.js"
import type { Footnotes } from "./Footnotes.js"
import { definitionsOf, joinInlineRuns, projectInline, type InlineNode } from "./Inline.js"
import { headingText, sourceText, toLspPosition } from "./MarkdownTree.js"
import type { BlockListItem, SteeringView, SteeringViewNode } from "./SteeringFormat.js"

/** A footnote marker as plain text, stripped out of every extracted title below. */
const MARKER_TEXT_RE = /\[\^([^\s\]]+)\]/g

const stripMarkerText = (text: string): string => text.replace(MARKER_TEXT_RE, "")

/** `child`'s raw source slice, UNCOLLAPSED — only `blockquoteChildrenText` needs the newlines intact, to tell a line-leading `> ` continuation marker apart from a literal `>` typed mid-prose. */
const rawChildText = (content: string, child: RootContent): string => {
  const start = child.position?.start.offset
  const end = child.position?.end.offset
  return start === undefined || end === undefined ? "" : content.slice(start, end)
}

/** Strips a blockquote's `> ` continuation markers. Must run on the RAW slice: the newline is what distinguishes them from a literal `>` typed mid-prose. */
const stripContinuationMarker = (text: string): string => text.replace(/\n[ \t]*>[ \t]?/g, "\n")

/**
 * Flattened text of a run of sibling block nodes. Each child is sliced
 * INDIVIDUALLY, never as one span from the first child's start to the last
 * child's end: a filtered-out nested `list` still sits, raw markdown and all,
 * between its neighbours' offsets.
 */
const childrenText = (content: string, children: readonly RootContent[]): string =>
  children
    .map((child) => stripMarkerText(sourceText(content, child)))
    .filter((text) => text.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()

/**
 * `childrenText` scoped to blockquotes: their `> ` continuation markers sit in
 * the raw bytes BETWEEN two children's positions, so they are stripped before
 * the whitespace collapse. Never reused for `listItemText` — a list item's
 * fenced code block can carry a real line-leading `>` that must survive.
 */
const blockquoteChildrenText = (content: string, children: readonly RootContent[]): string =>
  children
    .map((child) => stripMarkerText(stripContinuationMarker(rawChildText(content, child))))
    .filter((text) => text.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()

/** One list item's text, EXCLUDING any nested `list` child — that's a recursive `items` entry instead. */
const listItemText = (content: string, item: ListItem): string =>
  childrenText(
    content,
    item.children.filter((c) => c.type !== "list"),
  )

/**
 * One list item's own inline structure, EXCLUDING any nested `list` child
 * (mirrors `listItemText`'s identical exclusion) — recurses through each
 * remaining non-list child via `nodeInline`, joined the same way
 * `childrenText` joins its own text. Feeds `BlockListItem.inline` (the FULL
 * block rendering) ONLY — a nested item renders as its own nested `<li>`
 * there (`BlockListItem.items`), so folding its text back into the PARENT's
 * own `inline` would duplicate it. `flattenListItemsInline` (below) is the
 * separate, deliberately non-recursive-exclusion sibling `nodeInline`'s own
 * `list` branch uses instead, for the flattened `detailInline` path.
 */
const listItemInline = (content: string, item: ListItem): readonly InlineNode[] =>
  joinInlineRuns(item.children.filter((c) => c.type !== "list").map((c) => nodeInline(content, c)))

/**
 * Every list item's own inline run, AT ANY NESTING DEPTH, flattened and
 * joined in document order — what `nodeInline`'s own `list` branch needs for
 * `detailInline` (R2: "a list contributes its items' runs joined by
 * spaces", explicitly INCLUDING a nested item, since block structure stays
 * flattened there). Deliberately distinct from `listItemInline`/
 * `BlockListItem.inline`, which keep a nested item's text OUT of its
 * parent's own `inline` — that field feeds the FULL block's own recursive
 * `<li>` tree, where a nested item already renders once, on its own.
 */
const flattenListItemsInline = (
  content: string,
  items: readonly ListItem[],
): readonly InlineNode[] =>
  joinInlineRuns(
    items.flatMap((item) => {
      const ownRun = listItemInline(content, item)
      const nested = item.children.filter((c): c is List => c.type === "list")
      const nestedRuns = nested.map((list) => flattenListItemsInline(content, list.children))
      return [ownRun, ...nestedRuns]
    }),
  )

/**
 * One top-level (or list-item-child) node's own inline structure —
 * `heading`/`paragraph` project their own `children` directly; `blockquote`
 * joins each non-footnote-definition child's own inline run; `list` joins
 * each of its visible items' own `listItemInline`; `code` has none of its
 * own beyond its plain `value`. Mirrors `blockTitle`'s per-kind dispatch,
 * structurally rather than as a flattened string.
 */
const nodeInline = (
  content: string,
  node: RootContent,
  options?: BlockWalkOptions,
): readonly InlineNode[] => {
  if (node.type === "heading" || node.type === "paragraph") {
    return projectInline(node.children, definitionsOf(content))
  }
  if (node.type === "blockquote") {
    return joinInlineRuns(
      node.children
        .filter((c) => c.type !== "footnoteDefinition")
        .map((c) => nodeInline(content, c, options)),
    )
  }
  if (node.type === "list") {
    return flattenListItemsInline(content, visibleListItems(node, options))
  }
  if (node.type === "code") return [{ kind: "text", value: node.value }]
  // Every other kind (a block-level `html` node, a `thematicBreak`, …) has
  // no inline structure of its own to project — but its own text must still
  // survive as an inert `text` node (R4: "raw HTML in a description stays
  // inert text", not nothing), mirroring `blockTitle`'s own identical
  // `sourceText` fallback for the same set of kinds.
  const title = blockTitle(content, node, options)
  return title.length > 0 ? [{ kind: "text", value: title }] : []
}

/** One list item as a `BlockListItem`, recursing into a nested `list` child (there is at most one, CommonMark's own shape) as its own `items`. */
const blockListItemOf = (content: string, item: ListItem): BlockListItem => {
  const nested = item.children.filter((c): c is List => c.type === "list")
  const items = nested.flatMap((list) => blockListItemsOf(content, list.children))
  return {
    text: listItemText(content, item),
    inline: listItemInline(content, item),
    ...(item.checked === true || item.checked === false ? { checked: item.checked } : {}),
    ...(items.length > 0 ? { items } : {}),
  }
}

/** Every item of a `list` node's own `children`, as `BlockListItem`s, in document order. */
const blockListItemsOf = (content: string, items: readonly ListItem[]): readonly BlockListItem[] =>
  items.map((item) => blockListItemOf(content, item))

/** The `title` an empty fenced code block (a `` ``` ``/`` ``` `` pair with nothing between them) falls back to — its real body is `""`, and every node still carries a non-empty title. */
const EMPTY_CODE_BLOCK_TITLE = "(empty code block)"

/** A `list`'s children with `options.skipListItem` removed. Filtering, never dropping the whole node: `qa`'s option items share a list with ordinary body bullets. */
const visibleListItems = (node: List, options?: BlockWalkOptions): readonly ListItem[] =>
  options?.skipListItem
    ? node.children.filter((item) => !options.skipListItem!(item))
    : node.children

/**
 * Every block kind's `title`. Each branch reads the node's CHILDREN rather
 * than its own span, because the span includes syntax the title must not
 * carry: a heading's `#` run, a blockquote's `>`, a code fence, and — for a
 * filtered list — every excluded item's markdown, checkbox syntax included.
 */
const blockTitle = (content: string, node: RootContent, options?: BlockWalkOptions): string => {
  if (node.type === "heading") return headingText(content, node, stripMarkerText)
  if (node.type === "blockquote") return blockquoteChildrenText(content, node.children)
  if (node.type === "code") {
    const text = stripMarkerText(node.value).replace(/\s+/g, " ").trim()
    return text.length > 0 ? text : EMPTY_CODE_BLOCK_TITLE
  }
  if (node.type === "list") {
    return visibleListItems(node, options)
      .map((item) => listItemText(content, item))
      .filter((text) => text.length > 0)
      .join(" ")
  }
  return stripMarkerText(sourceText(content, node)).replace(/\s+/g, " ").trim()
}

/**
 * `SteeringViewNode.block` for one top-level node — `undefined` for a kind
 * with no projected structure (`thematicBreak`, `html`, …), which still
 * renders via `title` alone. `code`'s `text` is `node.value` VERBATIM,
 * leading whitespace intact, unlike every other kind's collapsed `title`.
 */
const blockOf = (
  content: string,
  node: RootContent,
  options?: BlockWalkOptions,
): SteeringViewNode["block"] | undefined => {
  switch (node.type) {
    case "heading":
      return {
        kind: "heading",
        depth: node.depth,
        inline: projectInline(node.children, definitionsOf(content)),
      }
    case "list":
      return {
        kind: "list",
        ordered: node.ordered === true,
        items: blockListItemsOf(content, visibleListItems(node, options)),
      }
    case "code":
      return {
        kind: "code",
        text: node.value,
        ...(node.lang !== null && node.lang !== undefined ? { language: node.lang } : {}),
      }
    case "blockquote":
      return {
        kind: "blockquote",
        text: blockTitle(content, node),
        inline: nodeInline(content, node),
      }
    case "paragraph":
      return { kind: "paragraph", inline: projectInline(node.children, definitionsOf(content)) }
    default:
      return undefined
  }
}

/**
 * Lets a caller narrow the shared walk to its own document shape, so this
 * module hardcodes no format's rules. `skipListItem` matches by NODE
 * IDENTITY, never line arithmetic: `qa`'s option items share a source list
 * with ordinary body bullets, so a partly-filtered list stays in the walk.
 */
export interface BlockWalkOptions {
  readonly skipNode?: (content: string, node: RootContent) => boolean
  readonly skipLine?: (line: number) => boolean
  readonly skipListItem?: (item: ListItem) => boolean
  /**
   * Pre-parsed footnotes, for a caller that walks MULTIPLE runs of the SAME
   * document (`qa.ts`'s one call per question, now one per option too) and
   * must not pay `parseFootnotes`'s own whole-document walk again for each
   * one. Absent means "parse it here" — every single-call caller (`review.ts`,
   * `freeform.ts`, this module's own `blockNodesOf`) still gets that for
   * free, unchanged.
   */
  readonly footnotes?: Footnotes
}

/** A `list` that `skipListItem` empties ENTIRELY — the one case excluded wholesale; one surviving item keeps the list in the walk. */
const isEmptiedList = (node: RootContent, options?: BlockWalkOptions): boolean =>
  node.type === "list" &&
  node.children.length > 0 &&
  options?.skipListItem !== undefined &&
  visibleListItems(node, options).length === 0

/**
 * The nodes of a run that `blockNodesOfRun`/`blockRunInline` both walk —
 * a real position (so `position!` below is total), not a footnote
 * definition, not `options`-skipped, not a list emptied down to nothing by
 * `skipListItem`. Shared so the two walks can never drift apart on which
 * nodes they see (see `blockRunInline`'s own doc comment).
 */
const visibleNodes = (
  content: string,
  nodes: readonly RootContent[],
  options?: BlockWalkOptions,
): readonly RootContent[] =>
  nodes
    .filter((node) => node.position !== undefined)
    .filter((node) => node.type !== "footnoteDefinition")
    .filter((node) => !(options?.skipNode?.(content, node) ?? false))
    .filter((node) => !(options?.skipLine?.(toLspPosition(node.position!.start).line) ?? false))
    .filter((node) => !isEmptiedList(node, options))

/**
 * Every block of a RUN of sibling nodes as a view node, in document order. A
 * `footnoteDefinition` is skipped unconditionally: it is the note ITSELF,
 * surfaced below as a node's `note`, never document content of its own.
 *
 * A footnote marker on a node's start line becomes that node's `note`, so a
 * block already carrying one offers editing it rather than a second note.
 *
 * `options.footnotes`, when given, replaces this call's own
 * `parseFootnotes(content)` — see its own doc for why a caller walking many
 * runs of one document needs it.
 */
export const blockNodesOfRun = (
  content: string,
  nodes: readonly RootContent[],
  options?: BlockWalkOptions,
): readonly SteeringView["nodes"][number][] => {
  const noteAt = noteLookup(content, options?.footnotes)
  return visibleNodes(content, nodes, options).map((node) => {
    const startLine = toLspPosition(node.position!.start).line
    const block = blockOf(content, node, options)
    return {
      title: blockTitle(content, node, options),
      anchor: { kind: "paragraph" as const, line: startLine },
      ...(block !== undefined ? { block } : {}),
      ...noteAt(startLine),
    }
  })
}

/** Every top-level block of the WHOLE document, in document order — `blockNodesOfRun` over `tree.children`. See that function's own doc comment for the shared per-node logic. */
export const blockNodesOf = (
  content: string,
  tree: Root,
  options?: BlockWalkOptions,
): readonly SteeringView["nodes"][number][] => blockNodesOfRun(content, tree.children, options)

/**
 * A run of sibling nodes' own inline structure, flattened and joined exactly
 * the way `blockTitle`/`childrenText` flatten the SAME run into one string —
 * a caller's `detailInline` (`review.ts`'s chunk, `qa.ts`'s question)
 * builds this over the same node run its own `detail` string is built over,
 * with the SAME `options` (so a skipped node/line/list-item is skipped in
 * both). Never itself collapses an image to alt text — a caller wanting the
 * compact-row rule (R2) applies `Inline.ts#collapseImages` to the result.
 */
export const blockRunInline = (
  content: string,
  nodes: readonly RootContent[],
  options?: BlockWalkOptions,
): readonly InlineNode[] => {
  const filtered = visibleNodes(content, nodes, options)
  return joinInlineRuns(filtered.map((node) => nodeInline(content, node, options)))
}
