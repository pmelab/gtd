import type { Node, Paragraph, Parent, Root } from "mdast"
import { eolOf } from "./Eol.js"
import { parseMarkdown } from "./MarkdownTree.js"

export const LINE_WIDTH = 80

/** Inline nodes a line never breaks inside. */
const ATOMIC = new Set([
  "inlineCode",
  "link",
  "image",
  "linkReference",
  "imageReference",
  "html",
  "footnoteReference",
])

/**
 * A word that would start a block if it opened a line: a list marker, an ATX
 * heading, a quote, a fence, an HTML block, a setext underline or a thematic
 * break. Such a word stays on the line before, even past the width.
 */
const BLOCK_START = /^(?:[-+*]|\d{1,9}[.)]|#{1,6}|>.*|`{3,}.*|~{3,}.*|<[!/?A-Za-z].*|=+|-+|\*+|_+)$/

/** Joins the words of an atomic node while the paragraph is split; never in markdown source. */
const GLUE = "\u0000"

const TASK_BOX = /^\[[ xX]\]\s+/

const offsets = (node: Node): readonly [number, number] => [
  node.position?.start.offset ?? 0,
  node.position?.end.offset ?? 0,
]

const atomicRanges = (paragraph: Paragraph): (readonly [number, number])[] => {
  const ranges: (readonly [number, number])[] = []
  const walk = (node: Node): void => {
    if (ATOMIC.has(node.type)) {
      ranges.push(offsets(node))
      return
    }
    for (const child of (node as Partial<Parent>).children ?? []) walk(child)
  }
  walk(paragraph)
  return ranges
}

const hasHardBreak = (node: Node): boolean =>
  node.type === "break" || ((node as Partial<Parent>).children ?? []).some(hasHardBreak)

/** The paragraph's words: whitespace splits them, except inside an atomic node, where it collapses to one space. */
const words = (content: string, paragraph: Paragraph, start: number): string[] => {
  const end = offsets(paragraph)[1]
  let text = ""
  let cursor = start
  for (const [atomStart, atomEnd] of atomicRanges(paragraph)) {
    if (atomEnd <= cursor) continue
    const from = Math.max(atomStart, cursor)
    text += content.slice(cursor, from) + content.slice(from, atomEnd).replace(/\s+/g, GLUE)
    cursor = atomEnd
  }
  text += content.slice(cursor, end)
  return text
    .split(/\s+/)
    .filter((word) => word !== "")
    .map((word) => word.replaceAll(GLUE, " "))
}

/** Greedy fill; `width` is what is left of a line after `indent`, the same on the first line. */
const fill = (tokens: readonly string[], width: number, indent: string): string => {
  const lines: string[] = []
  let line = ""
  for (const token of tokens) {
    if (line === "") line = token
    else if (line.length + 1 + token.length <= width || BLOCK_START.test(token)) line += ` ${token}`
    else {
      lines.push(line)
      line = token
    }
  }
  lines.push(line)
  return lines.join(`\n${indent}`)
}

interface Rewrap {
  readonly start: number
  readonly end: number
  readonly text: string
}

const isFirstOfTaskItem = (node: Node, parent: Node | undefined): boolean =>
  parent?.type === "listItem" &&
  typeof (parent as { checked?: unknown }).checked === "boolean" &&
  (parent as Parent).children[0] === node

const rewrap = (
  content: string,
  paragraph: Paragraph,
  parent: Node | undefined,
): Rewrap | undefined => {
  const [start, end] = offsets(paragraph)
  const source = content.slice(start, end)
  if (hasHardBreak(paragraph) || source.trimStart().startsWith("|")) return undefined
  const column = (paragraph.position?.start.column ?? 1) - 1
  // A task item whose text opens with an inline node keeps its box inside the paragraph.
  const box = isFirstOfTaskItem(paragraph, parent) ? (TASK_BOX.exec(source)?.[0] ?? "") : ""
  const lead = box === "" ? "" : `${box.trimEnd()} `
  const indent = " ".repeat(column + lead.length)
  const body = words(content, paragraph, start + box.length)
  return { start, end, text: lead + fill(body, LINE_WIDTH - indent.length, indent) }
}

const rewrapsOf = (content: string, tree: Root): Rewrap[] => {
  const result: Rewrap[] = []
  const visit = (node: Node, parent: Node | undefined): void => {
    if (node.type === "blockquote" || node.type === "table") return
    if (node.type === "paragraph") {
      const found = rewrap(content, node as Paragraph, parent)
      if (found !== undefined) result.push(found)
      return
    }
    for (const child of (node as Partial<Parent>).children ?? []) visit(child, node)
  }
  visit(tree, undefined)
  return result
}

/**
 * The canonical form of a steering file: every paragraph refilled to
 * {@link LINE_WIDTH} columns, everything else as written, one final newline.
 * Idempotent.
 */
export const serialize = (content: string): string => {
  const eol = eolOf(content)
  const lf = content.replace(/\r\n/g, "\n")
  const tree = parseMarkdown(lf)
  let out = ""
  let cursor = 0
  for (const { start, end, text } of rewrapsOf(lf, tree)) {
    out += lf.slice(cursor, start) + text
    cursor = end
  }
  out += lf.slice(cursor)
  out = `${out.replace(/\n+$/, "")}\n`
  return eol === "\n" ? out : out.replace(/\n/g, eol)
}
