import type { List, ListItem, RootContent, Root } from "mdast"
import { parseFootnotes } from "./Footnotes.js"
import { headingText, sourceText, toLspPosition } from "./MarkdownTree.js"
import type { BlockListItem, SteeringView, SteeringViewNode } from "./SteeringFormat.js"

/**
 * A marker's shape once it's plain text: `[^name]`, no whitespace, no `]` —
 * stripped out of every extracted title/text below, since a marker read back
 * out of a heading's or a blockquote's own body is noise no caller wants.
 */
const MARKER_TEXT_RE = /\[\^([^\s\]]+)\]/g

const stripMarkerText = (text: string): string => text.replace(MARKER_TEXT_RE, "")

/**
 * The flattened, marker-stripped, whitespace-collapsed text of a run of
 * sibling BLOCK nodes (a blockquote's own children, a list item's own
 * non-list children) — built by taking EACH child's own `sourceText`
 * individually and joining the results, never by slicing one span from the
 * first child's start to the last child's end. A single shared span would
 * include every byte BETWEEN the children verbatim — a nested `list`
 * filtered out of a list item's own children (see `listItemText`) still
 * sits, raw markdown and all, between its neighbors' offsets; a blockquote's
 * OWN `> ` continuation markers between two paragraphs sit there too (each
 * child's own position starts right after its line's `> `, but the raw text
 * BETWEEN two children's positions still crosses that marker).
 */
const childrenText = (content: string, children: readonly RootContent[]): string =>
  children
    .map((child) => stripMarkerText(sourceText(content, child)))
    .filter((text) => text.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()

/**
 * One list item's own text, EXCLUDING any nested `list` child (that's a
 * separate, recursive `items` entry — see `blockListItemOf`).
 */
const listItemText = (content: string, item: ListItem): string =>
  childrenText(
    content,
    item.children.filter((c) => c.type !== "list"),
  )

/** One list item as a `BlockListItem`, recursing into a nested `list` child (there is at most one, CommonMark's own shape) as its own `items`. */
const blockListItemOf = (content: string, item: ListItem): BlockListItem => {
  const nested = item.children.filter((c): c is List => c.type === "list")
  const items = nested.flatMap((list) => blockListItemsOf(content, list.children))
  return {
    text: listItemText(content, item),
    ...(item.checked === true || item.checked === false ? { checked: item.checked } : {}),
    ...(items.length > 0 ? { items } : {}),
  }
}

/** Every item of a `list` node's own `children`, as `BlockListItem`s, in document order. */
const blockListItemsOf = (content: string, items: readonly ListItem[]): readonly BlockListItem[] =>
  items.map((item) => blockListItemOf(content, item))

/** The `title` an empty fenced code block (a `` ``` ``/`` ``` `` pair with nothing between them) falls back to — its real body is `""`, and every node still carries a non-empty title. */
const EMPTY_CODE_BLOCK_TITLE = "(empty code block)"

/**
 * A `list` node's own children with `options.skipListItem` removed — identity
 * filtering, not a line-range guess (see `BlockWalkOptions.skipListItem`'s own
 * doc comment for why): a caller excluding SOME of a list's items (`qa.ts`'s
 * own option items, mixed in the SAME list as ordinary body bullets) still
 * sees whatever's left, rather than losing the whole node the moment any one
 * child matches.
 */
const visibleListItems = (node: List, options?: BlockWalkOptions): readonly ListItem[] =>
  options?.skipListItem
    ? node.children.filter((item) => !options.skipListItem!(item))
    : node.children

/**
 * A top-level node's own one-line, marker-stripped, whitespace-collapsed
 * text — every block kind's `title`, and reused verbatim as a `blockquote`'s
 * own `text`. `heading`/`blockquote` use `childrenText` (their own CHILDREN
 * span — the NODE's own position starts at the `#` run / the `>` marker,
 * which `sourceText` would otherwise pull in); `code` uses its `value`
 * directly (never `sourceText`, which would pull in the fence lines),
 * falling back to `EMPTY_CODE_BLOCK_TITLE` when that value is blank; `list`
 * joins each VISIBLE item's own text (`options.skipListItem`-filtered, never
 * raw `sourceText` over the whole node's span — that span still covers every
 * excluded item's own markdown, checkbox syntax included, which would leak
 * straight back into `title`/`detail` the moment any item was filtered);
 * everything else uses `sourceText` over the node's own span.
 */
const blockTitle = (content: string, node: RootContent, options?: BlockWalkOptions): string => {
  if (node.type === "heading") return headingText(content, node, stripMarkerText)
  if (node.type === "blockquote") return childrenText(content, node.children)
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

/** A top-level node's own raw source bytes, verbatim — the exact slice `apply` would replace to rewrite this block whole. `""` for a node with no resolvable offsets. */
const rawNodeText = (content: string, node: RootContent): string => {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) return ""
  return content.slice(start, end)
}

/**
 * `SteeringViewNode.block` for one top-level node — `undefined` for a kind
 * this walk doesn't project structure for (a `thematicBreak`, an `html`
 * node, …), which still renders via `title` alone. `code`'s own `text` is
 * `node.value` VERBATIM — leading whitespace intact, never
 * whitespace-collapsed like every other kind's `title` — and its `language`
 * is the fence's own info string, omitted entirely when there is none
 * (`node.lang` is `null`/`undefined`).
 *
 * `fullText`, when set, OVERRIDES whatever `text` the switch below produces
 * (including `code`/`blockquote`'s own) with the node's raw source bytes,
 * verbatim — `qa`/`review` never pass it (their `code`/`blockquote` text
 * stays the collapsed/fence-stripped form above), so this is opt-in per
 * caller, never a change to either built-in's own behavior.
 */
const blockOf = (
  content: string,
  node: RootContent,
  options?: BlockWalkOptions,
): SteeringViewNode["block"] | undefined => {
  const block = ((): SteeringViewNode["block"] | undefined => {
    switch (node.type) {
      case "heading":
        return { kind: "heading", depth: node.depth }
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
        return { kind: "blockquote", text: blockTitle(content, node) }
      case "paragraph":
        return { kind: "paragraph" }
      default:
        return undefined
    }
  })()
  if (block === undefined) {
    // Free-form (`options.fullText`) has no structure of its own to fall
    // back on, so a node kind this walk otherwise ignores (`table`, `html`,
    // `thematicBreak`, …) still needs an editable, raw-source block — a
    // bare `paragraph` kind carrying the node's own bytes verbatim, rather
    // than silently dropping `block` (and with it, Task 7's edit textarea)
    // for that node.
    return options?.fullText ? { kind: "paragraph", text: rawNodeText(content, node) } : undefined
  }
  return options?.fullText ? { ...block, text: rawNodeText(content, node) } : block
}

/**
 * Options that let a caller narrow the shared block walk to its own
 * document shape, without this module hardcoding any one format's rules:
 * `skipNode` excludes a top-level node outright (`qa`'s own `## Open
 * Questions`/`## Answered Questions` section headings); `skipLine` excludes
 * a node by its own start line (`qa`'s question spans, already projected
 * elsewhere as `question`/`option` nodes); `skipListItem` excludes individual
 * `listItem`s of a top-level `list` by NODE IDENTITY (`qa`'s own option items
 * — `optionListItems`'s exact return set — mixed in the SAME list as ordinary
 * body bullets in source, never by line arithmetic or by dropping the whole
 * list the moment ANY child matches: a list that still has visible items
 * after filtering stays in the walk, with only the matched items gone from
 * its own `items`/title). None is required — a caller passing none gets every
 * top-level block, and every one of its items, unfiltered.
 */
export interface BlockWalkOptions {
  readonly skipNode?: (content: string, node: RootContent) => boolean
  readonly skipLine?: (line: number) => boolean
  readonly skipListItem?: (item: ListItem) => boolean
  /** See `blockOf`'s own doc — forwarded through to every node's own `block`. */
  readonly fullText?: boolean
}

/**
 * `true` for a top-level `list` node that `options.skipListItem` empties out
 * ENTIRELY (every child matches) — the one case still excluded from the walk
 * wholesale, mirroring the old whole-list exclusion for `qa`'s pure option
 * list. A list with at least one surviving item stays, filtered rather than
 * dropped (see `BlockWalkOptions.skipListItem`'s own doc comment).
 */
const isEmptiedList = (node: RootContent, options?: BlockWalkOptions): boolean =>
  node.type === "list" &&
  node.children.length > 0 &&
  options?.skipListItem !== undefined &&
  visibleListItems(node, options).length === 0

/**
 * Every block of an arbitrary RUN of sibling `RootContent` nodes as a view
 * node, in document order — headings, lists, code blocks, blockquotes and
 * paragraphs alike. A `footnoteDefinition` is skipped unconditionally: it is
 * the note ITSELF, surfaced below as a node's own `note`, never new document
 * content in its own right. `options.skipNode`/`options.skipLine` let a
 * caller exclude its own already-projected structure (see
 * `BlockWalkOptions`) — a caller passing neither gets every node in `nodes`,
 * unfiltered. `blockNodesOf` (below) is this walk over a WHOLE document's own
 * `tree.children`; `qa.ts`'s question-body projection is this walk over one
 * `QuestionBlock.body` array instead — the same per-node logic either way.
 *
 * Every node still carries a real, server-computed `{kind:"paragraph",
 * line}` anchor at its own start line, and an existing footnote marker
 * anchored at that same line surfaces as the node's own `note` (mirrors
 * `review.ts#chunkNoteOf`'s exact-line-match convention), so a block already
 * carrying a note offers editing it, not a second one.
 */
export const blockNodesOfRun = (
  content: string,
  nodes: readonly RootContent[],
  options?: BlockWalkOptions,
): readonly SteeringView["nodes"][number][] => {
  const { markers, definitions } = parseFootnotes(content)
  const definitionByName = new Map(definitions.map((d) => [d.name, d.body]))
  return nodes
    .filter((node) => node.position !== undefined)
    .filter((node) => node.type !== "footnoteDefinition")
    .filter((node) => !(options?.skipNode?.(content, node) ?? false))
    .filter((node) => !(options?.skipLine?.(toLspPosition(node.position!.start).line) ?? false))
    .filter((node) => !isEmptiedList(node, options))
    .map((node) => {
      const startLine = toLspPosition(node.position!.start).line
      const noteBodies = markers
        .filter((marker) => marker.line === startLine)
        .map((marker) => definitionByName.get(marker.name))
        .filter((body): body is string => body !== undefined)
      const block = blockOf(content, node, options)
      return {
        title: blockTitle(content, node, options),
        anchor: { kind: "paragraph" as const, line: startLine },
        ...(block !== undefined ? { block } : {}),
        ...(noteBodies.length > 0 ? { note: noteBodies.join(" ") } : {}),
      }
    })
}

/** Every top-level block of the WHOLE document, in document order — `blockNodesOfRun` over `tree.children`. See that function's own doc comment for the shared per-node logic. */
export const blockNodesOf = (
  content: string,
  tree: Root,
  options?: BlockWalkOptions,
): readonly SteeringView["nodes"][number][] => blockNodesOfRun(content, tree.children, options)
