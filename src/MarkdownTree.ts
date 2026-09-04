import { fromMarkdown } from "mdast-util-from-markdown"
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote"
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item"
import { gfmFootnote } from "micromark-extension-gfm-footnote"
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item"
import type { ListItem, Node, Root, RootContent } from "mdast"

/** The same 0-based shape the LSP protocol uses, everywhere a converted mdast position ends up. */
export interface LspPosition {
  readonly line: number
  readonly character: number
}

/**
 * How many times `parseMarkdown` has actually run `fromMarkdown` (memo hits
 * excluded) — the only way "one parse per document" is assertable, since
 * timing is not.
 */
let parseCount = 0
export const getParseCount = (): number => parseCount

/** One-entry memo: the last content string parsed and its tree, so re-validating the same document never re-parses. */
let memoContent: string | undefined
let memoTree: Root | undefined

/**
 * Parses `content` into an mdast tree with both GFM extensions wired —
 * footnotes and task-list checkboxes. Both the micromark and the mdast half
 * of each extension must be CALLED (`gfmTaskListItem()`, not
 * `gfmTaskListItem`); passing the bare function is accepted silently and
 * yields `listItem.checked === null` on every item instead of a real
 * checkbox. Total: `fromMarkdown` never throws, so this never does either.
 *
 * Memoized on the content string, one entry deep — the last document parsed
 * stays cached so one `validate` call's footnote pass and format pass share
 * a single parse; a different string evicts it.
 */
export const parseMarkdown = (content: string): Root => {
  if (memoContent === content && memoTree !== undefined) return memoTree
  const tree = fromMarkdown(content, {
    extensions: [gfmFootnote(), gfmTaskListItem()],
    mdastExtensions: [gfmFootnoteFromMarkdown(), gfmTaskListItemFromMarkdown()],
  })
  parseCount += 1
  memoContent = content
  memoTree = tree
  return tree
}

/** mdast gives 1-based line/column; the LSP wants 0-based line/character. Every `- 1` lives here. */
export const toLspPosition = (point: {
  readonly line: number
  readonly column: number
}): LspPosition => ({
  line: point.line - 1,
  character: point.column - 1,
})

/**
 * Converts an absolute 0-based character offset into `content` to a 0-based
 * LSP line/character — the general form a caller needs for a position that
 * isn't a tree node's own point (a hit found by scanning a `text` node's own
 * source slice for a pattern the parser didn't turn into a node, say).
 */
export const toLspPositionFromOffset = (content: string, offset: number): LspPosition => {
  let line = 0
  let lineStart = 0
  for (let i = 0; i < offset; i += 1) {
    if (content[i] === "\n") {
      line += 1
      lineStart = i + 1
    }
  }
  return { line, character: offset - lineStart }
}

/** Collects every descendant `footnoteReference` node's own `[start, end)` source-offset range, in document order. */
const footnoteReferenceRanges = (node: Node): Array<readonly [number, number]> => {
  const ranges: Array<readonly [number, number]> = []
  const walk = (n: Node): void => {
    if (n.type === "footnoteReference" && n.position) {
      ranges.push([n.position.start.offset!, n.position.end.offset!])
    }
    const children = (n as { children?: readonly Node[] }).children
    if (children) children.forEach(walk)
  }
  walk(node)
  return ranges.sort((a, b) => a[0] - b[0])
}

/**
 * `node`'s own source slice, with every descendant `footnoteReference`
 * range excised and every run of whitespace collapsed to a single space.
 * Inline code, links, and emphasis are untouched — only footnote markers are
 * ever cut out, because a marker read back out of a definition's or a
 * heading's body is noise no caller wants.
 */
export const sourceText = (content: string, node: Node): string => {
  if (!node.position) return ""
  const start = node.position.start.offset!
  const end = node.position.end.offset!
  let result = ""
  let cursor = start
  for (const [rangeStart, rangeEnd] of footnoteReferenceRanges(node)) {
    if (rangeStart < cursor) continue
    result += content.slice(cursor, rangeStart)
    cursor = rangeEnd
  }
  result += content.slice(cursor, end)
  return result.replace(/\s+/g, " ").trim()
}

/** The top-level block of `tree` that contains 0-based `line`, or `undefined` past the end of the document. */
export const blockNodeAt = (tree: Root, line: number): RootContent | undefined =>
  tree.children.find((node) => {
    if (!node.position) return false
    return line >= node.position.start.line - 1 && line <= node.position.end.line - 1
  })

/** Every `listItem` under `node` with `checked !== null` (a real task-list item), at any nesting depth. */
export const taskItems = (node: Node): readonly ListItem[] => {
  const items: ListItem[] = []
  const walk = (n: Node): void => {
    if (n.type === "listItem" && (n as ListItem).checked !== null) items.push(n as ListItem)
    const children = (n as { children?: readonly Node[] }).children
    if (children) children.forEach(walk)
  }
  walk(node)
  return items
}
