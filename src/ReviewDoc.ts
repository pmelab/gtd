import type { Heading, ListItem, Root, RootContent } from "mdast"
import type { FootnoteMarker } from "./Footnotes.js"
import {
  footnoteAdditionEdits,
  footnotePointerAt,
  isOnExistingFootnote,
  parseFootnotes,
} from "./Footnotes.js"
import {
  blockNodeAt,
  parseMarkdown,
  sourceText,
  taskItems,
  toLspPosition,
  toLspPositionFromOffset,
} from "./MarkdownTree.js"
import type {
  SteeringEdit,
  SteeringFinding,
  SteeringFormat,
  SteeringOutlineNode,
} from "./SteeringFormat.js"

export interface ReviewFile {
  readonly path: string
  readonly line?: number
  readonly checked: boolean
  /** The pointer's explanation: same-line text (if any) first, then the lines gathered from BELOW it, joined with " ". */
  readonly note?: string
  /** 0-based line index of this file pointer's own `- [ ]`/`- [x]` line in REVIEW.md, for editor tooling. */
  readonly sourceLine: number
  /** 0-based index of the last line of this pointer's OWN span (excluding any nested hunk's span); equals `sourceLine` when it has no explanation. */
  readonly endLine: number
}

export interface Changeset {
  readonly title: string
  readonly description: string
  readonly files: readonly ReviewFile[]
  /** 0-based index of this chunk's `##` heading. */
  readonly headingLine: number
}

export interface ReviewDoc {
  readonly shortHash?: string
  readonly fullHash?: string
  readonly changesets: readonly Changeset[]
  readonly errors: readonly string[]
}

/**
 * `REVIEW_FORMAT`'s canonical sample — a minimal, valid `review`-mode
 * document: the header, the base comment, one chunk with one file pointer,
 * and one anchored footnote on that hunk's note with a body over 80
 * characters — pinned already in oxfmt's own wrapped four-space form (see
 * `src/SteeringFormats.test.ts`'s formatter round-trip). Deliberately not
 * authored to survive any particular formatter beyond that.
 */
const REVIEW_SAMPLE = `# Review: sample123

<!-- base: 0000000000000000000000000000000000000000 -->

## Sample chunk

- [ ] ./sample.ts#1 what this hunk does[^fn1]

[^fn1]:
    This note explains why the hunk exists in more detail than fits on one line
    for a reviewer.
`

/** The `# Review: <hash>` header, once a depth-1 heading's own inline text has been extracted. */
const HEADER_TEXT_RE = /^Review:\s*(\S+)$/
/** The `<!-- base: <hash> -->` comment, matched against an `html` node's own raw `value`. */
const BASE_COMMENT_RE = /^<!--\s*base:\s*(\S+)\s*-->$/
/** A pointer token's trailing `#<line>` (greedy, so a `#` inside the path stays in it). */
const POINTER_LINE_RE = /^(.*)#(\d+)$/
/** The optional dash that may lead the inline note segment or a continuation block — em dash, en dash, or hyphens. */
const NOTE_SEPARATOR_RE = /^[—–-]+\s*/

/**
 * A depth-N heading's own text (footnote references excised via `sourceText`,
 * internal whitespace collapsed) — `""` for a bare heading with no inline
 * content. Built from the heading's own CHILDREN span, never the heading
 * node's own position: that starts at the `#` run, which would pull the
 * marker and its separating space into `sourceText`'s slice.
 */
const headingText = (content: string, heading: Heading): string => {
  const children = heading.children
  if (children.length === 0) return ""
  const first = children[0]!
  const last = children[children.length - 1]!
  if (!first.position || !last.position) return ""
  const synthetic = {
    type: "heading",
    children,
    position: { start: first.position.start, end: last.position.end },
  }
  return sourceText(content, synthetic).replace(/\s+/g, " ").trim()
}

/** The `# Review: <hash>` header, required as the document's first top-level node — never a heading found merely somewhere inside a fenced example. */
const parseHeader = (tree: Root, content: string): string | undefined => {
  const first = tree.children[0]
  if (!first || first.type !== "heading" || first.depth !== 1) return undefined
  return HEADER_TEXT_RE.exec(headingText(content, first))?.[1]
}

/** A node shape wide enough to walk for an `html` node's raw text, at any depth. */
interface WalkableNode {
  readonly type: string
  readonly value?: string
  readonly children?: readonly WalkableNode[]
}

/** The `<!-- base: <hash> -->` comment, wherever in the tree it appears — a real `html` node, never a string search over raw lines (which would also match one quoted inside a fence, since that content never becomes an `html` node at all). */
const parseBaseComment = (tree: Root): string | undefined => {
  let found: string | undefined
  const walk = (node: WalkableNode): void => {
    if (found !== undefined) return
    if (node.type === "html") {
      const match = BASE_COMMENT_RE.exec((node.value ?? "").trim())
      if (match) {
        found = match[1]
        return
      }
    }
    node.children?.forEach(walk)
  }
  walk(tree as unknown as WalkableNode)
  return found
}

/** True when `token` parses as a file pointer's path token — leading `./`, and a path longer than two characters once an optional `#<line>` suffix is stripped. The single source of truth for "is this a pointer token", shared by `parseHunk` and the second-pointer finding below so the two can never drift apart. */
const isPointerToken = (token: string): boolean => {
  if (!token.startsWith("./")) return false
  const lineMatch = POINTER_LINE_RE.exec(token)
  const path = lineMatch ? lineMatch[1]! : token
  return path.length > 2 // `./` with nothing after it is not a path
}

/**
 * The second-pointer validation error: a note whose first token is itself a
 * pointer token. The relaxed same-line form would otherwise silently read
 * `- [ ] ./a.ts#1 ./b.ts#2` (or with a separator, `- [ ] ./a.ts#1 — ./b.ts#2`)
 * as ONE pointer whose note is `./b.ts#2`, dropping the second hunk entirely —
 * this is the one case the relaxed parser must still refuse, and it points at
 * the pointer's own `sourceLine` so it renders as a positioned finding.
 */
const secondPointerError = (
  title: string,
  file: ReviewFile,
  secondToken: string,
): SteeringFinding => {
  const target = file.line !== undefined ? `${file.path}#${file.line}` : file.path
  return {
    message: `Chunk "${title}" hunk ${target}'s note starts with a second pointer (${secondToken}) — give it its own "- [ ]" line`,
    line: file.sourceLine,
  }
}

/** The source OFFSET right after an item's `- [ ]`/`- [x]` marker — the first inline child of the item's first paragraph, never the paragraph node's own (possibly stale) position. `undefined` when the item has no paragraph, or an empty one. */
const firstParagraphContentOffset = (item: ListItem): number | undefined => {
  const paragraph = item.children.find((c) => c.type === "paragraph")
  return paragraph?.children[0]?.position?.start.offset
}

/**
 * The text trailing the pointer token on the item's OWN source line — never
 * a later, merely wrapped-onto-the-item's-first-paragraph line. This is what
 * the second-pointer check must scope itself to: a below-pointer explanation
 * that happens to open with a path (`./src/foo.ts is the caller`, on the
 * NEXT physical line) is not the same thing as `- [ ] ./a.ts#1 ./b.ts#2` (two
 * pointers crammed onto ONE line), even though both collapse to the same
 * joined `restOfParagraph` string once whitespace is normalized.
 */
const hunkInlineSegment = (
  content: string,
  lines: readonly string[],
  item: ListItem,
  token: string,
  sourceLine: number,
): string => {
  const contentOffset = firstParagraphContentOffset(item)
  const contentPos =
    contentOffset !== undefined ? toLspPositionFromOffset(content, contentOffset) : undefined
  const sameLineRaw =
    contentPos && contentPos.line === sourceLine
      ? (lines[sourceLine] ?? "").slice(contentPos.character).trim()
      : ""
  return sameLineRaw.startsWith(token)
    ? sameLineRaw.slice(token.length).trim().replace(NOTE_SEPARATOR_RE, "")
    : ""
}

/** A hunk's composed note: the paragraph's own trailing text (same line and/or lazily wrapped, already joined and whitespace-collapsed by `sourceText`) first, then every further sibling block of the item — EXCLUDING a nested `list` (a nested hunk's own span) and a `footnoteDefinition` — each with its own leading dash separator stripped, joined by a single space. */
const hunkNote = (
  content: string,
  item: ListItem,
  paragraph: RootContent,
  restOfParagraph: string,
): string => {
  const otherChildren = item.children.filter(
    (c) => c !== paragraph && c.type !== "list" && c.type !== "footnoteDefinition",
  )
  const segments = [
    restOfParagraph.replace(NOTE_SEPARATOR_RE, ""),
    ...otherChildren.map((c) => sourceText(content, c).replace(NOTE_SEPARATOR_RE, "")),
  ].filter((s) => s.length > 0)
  return segments.join(" ").trim()
}

/** The last line of a hunk's OWN span — every non-`list` child's own end line, at most — excluding a nested hunk's span entirely, so a parent's span never swallows it (for "add a footnote" placement, or for matching which hunk a cursor sits on). */
const hunkOwnEndLine = (item: ListItem, sourceLine: number): number => {
  const nonListChildren = item.children.filter((c) => c.type !== "list")
  if (nonListChildren.length === 0) return sourceLine
  return Math.max(...nonListChildren.map((c) => toLspPosition(c.position!.end).line))
}

/** Builds one hunk's `ReviewFile` from its already-located pointer `token` and first `paragraph`. */
const buildHunkFile = (
  content: string,
  item: ListItem,
  paragraph: RootContent,
  token: string,
  sourceLine: number,
): ReviewFile => {
  const lineMatch = POINTER_LINE_RE.exec(token)
  const restOfParagraph = sourceText(content, paragraph).slice(token.length).trim()
  const note = hunkNote(content, item, paragraph, restOfParagraph)
  return {
    path: lineMatch ? lineMatch[1]! : token,
    ...(lineMatch ? { line: Number(lineMatch[2]) } : {}),
    checked: item.checked === true,
    sourceLine,
    endLine: hunkOwnEndLine(item, sourceLine),
    ...(note.length > 0 ? { note } : {}),
  }
}

/** The second-pointer finding for one hunk, or `undefined` when its inline (same-line) segment doesn't itself open with a pointer token. */
const hunkSecondPointerFinding = (
  content: string,
  lines: readonly string[],
  item: ListItem,
  token: string,
  sourceLine: number,
  title: string,
  file: ReviewFile,
): SteeringFinding | undefined => {
  const inlineSegment = hunkInlineSegment(content, lines, item, token, sourceLine)
  const secondToken = inlineSegment.split(/\s+/)[0] ?? ""
  return isPointerToken(secondToken) ? secondPointerError(title, file, secondToken) : undefined
}

/** One pointer's parse result: its `ReviewFile`, plus the second-pointer finding when its inline (same-line) segment itself opens with a pointer token. `undefined` when `item`'s first paragraph's first word isn't a pointer token at all — a real task-list item whose content isn't a hunk pointer. */
const parseHunk = (
  content: string,
  lines: readonly string[],
  title: string,
  item: ListItem,
): { readonly file: ReviewFile; readonly error?: SteeringFinding } | undefined => {
  const paragraph = item.children.find((c) => c.type === "paragraph")
  if (!paragraph || !item.position) return undefined

  const token = sourceText(content, paragraph)
    .split(/\s+/)
    .find((w) => w.length > 0)
  if (!token || !isPointerToken(token)) return undefined

  const sourceLine = toLspPosition(item.position.start).line
  const file = buildHunkFile(content, item, paragraph, token, sourceLine)
  const error = hunkSecondPointerFinding(content, lines, item, token, sourceLine, title, file)
  return { file, ...(error ? { error } : {}) }
}

/** Splits one chunk's body nodes into its file pointers (hunk pointers are task items, collected recursively at ANY nesting depth via `taskItems` — a nested hunk is the same kind of hunk as a top-level one) and description prose (only the nodes before the chunk's first `list`). */
const parseChunkBody = (
  content: string,
  lines: readonly string[],
  title: string,
  body: readonly RootContent[],
): {
  readonly description: string
  readonly files: readonly ReviewFile[]
  readonly errors: readonly SteeringFinding[]
} => {
  const firstListIndex = body.findIndex((n) => n.type === "list")
  const descriptionNodes = (firstListIndex === -1 ? body : body.slice(0, firstListIndex)).filter(
    (n) => n.type !== "footnoteDefinition",
  )
  const description = descriptionNodes
    .map((n) => sourceText(content, n))
    .join(" ")
    .trim()

  const files: ReviewFile[] = []
  const errors: SteeringFinding[] = []
  for (const item of body.flatMap((n) => taskItems(n))) {
    const parsed = parseHunk(content, lines, title, item)
    if (!parsed) continue
    files.push(parsed.file)
    if (parsed.error) errors.push(parsed.error)
  }
  return { description, files, errors }
}

/** One `##` chunk heading node with its raw body block nodes (up to the next `##`-or-shallower heading). */
interface ChunkBlock {
  readonly heading: Heading
  readonly headingLine: number
  readonly body: readonly RootContent[]
}

/** Splits the tree's top-level nodes into consecutive `##` chunk blocks — a `## ` line found only inside a fence never becomes a heading node at all, so it's never mistaken for a chunk. */
const splitChunks = (tree: Root): readonly ChunkBlock[] => {
  const blocks: ChunkBlock[] = []
  let i = 0
  while (i < tree.children.length) {
    const node = tree.children[i]!
    if (node.type !== "heading" || node.depth !== 2) {
      i += 1
      continue
    }
    const heading = node
    const headingLine = toLspPosition(heading.position!.start).line
    i += 1
    const body: RootContent[] = []
    while (i < tree.children.length) {
      const next = tree.children[i]!
      if (next.type === "heading" && next.depth <= 2) break
      body.push(next)
      i += 1
    }
    blocks.push({ heading, headingLine, body })
  }
  return blocks
}

const parseChangesets = (
  tree: Root,
  content: string,
  lines: readonly string[],
): { readonly changesets: readonly Changeset[]; readonly errors: readonly SteeringFinding[] } => {
  const changesets: Changeset[] = []
  const errors: SteeringFinding[] = []
  for (const { heading, headingLine, body } of splitChunks(tree)) {
    const title = headingText(content, heading)
    const { description, files, errors: bodyErrors } = parseChunkBody(content, lines, title, body)
    errors.push(...bodyErrors)
    if (files.length === 0) errors.push({ message: `Chunk "${title}" has no file pointers` })
    changesets.push({ title, description, files, headingLine })
  }
  if (changesets.length === 0) errors.push({ message: "REVIEW.md has no '##' chunks" })
  return { changesets, errors }
}

/** Shared by `parseReviewDoc` and `REVIEW_FORMAT.validate` — the latter needs each finding's `line`, which `ReviewDoc.errors` (plain strings) drops. */
const parseReviewFindings = (
  content: string,
): {
  readonly shortHash?: string
  readonly fullHash?: string
  readonly changesets: readonly Changeset[]
  readonly findings: readonly SteeringFinding[]
} => {
  const tree = parseMarkdown(content)
  const lines = content.split(/\r?\n/)
  const shortHash = parseHeader(tree, content)
  const fullHash = parseBaseComment(tree)
  const { changesets, errors: chunkFindings } = parseChangesets(tree, content, lines)

  const findings: SteeringFinding[] = [
    ...(shortHash
      ? []
      : [
          {
            message: "Missing or malformed '# Review: <hash>' header as the document's first line",
          },
        ]),
    ...(fullHash ? [] : [{ message: "Missing '<!-- base: <hash> -->' comment" }]),
    ...chunkFindings,
  ]

  return {
    ...(shortHash ? { shortHash } : {}),
    ...(fullHash ? { fullHash } : {}),
    changesets,
    findings,
  }
}

/**
 * Parses the review structure out of `content` (the raw text of
 * `.gtd/REVIEW.md`). Total and side-effect-free: always returns a result,
 * never throws — `parseMarkdown`'s `fromMarkdown` never does either. `errors`
 * is non-empty exactly when the document violates the required structure —
 * the caller decides what to do with that (`gtd validate` exits non-zero with
 * them; the LSP publishes them as diagnostics).
 */
export const parseReviewDoc = (content: string): ReviewDoc => {
  const { shortHash, fullHash, changesets, findings } = parseReviewFindings(content)
  return {
    ...(shortHash ? { shortHash } : {}),
    ...(fullHash ? { fullHash } : {}),
    changesets,
    errors: findings.map((f) => f.message),
  }
}

/** The character offset of a checked task item's own box character (`x`/`X`) — the first `[` at or after the item's own start offset, bounded by (before) its content's start offset, mirroring how a checkbox toggle resolves the same offset. `undefined` when the item carries no resolvable box (never happens for a real GFM task item, but kept total). */
const checkboxOffset = (content: string, item: ListItem): number | undefined => {
  if (!item.position) return undefined
  const startOffset = item.position.start.offset
  if (startOffset === undefined) return undefined
  const boundOffset = firstParagraphContentOffset(item) ?? item.position.end.offset!
  const bracketOffset = content.indexOf("[", startOffset)
  if (bracketOffset === -1 || bracketOffset >= boundOffset) return undefined
  return bracketOffset + 1
}

/**
 * Resets every checked task item's box in `content` back to `- [ ]` — ticks
 * are read-progress, never sign-off, and are cleared on every land at the
 * human review gate (see `src/Edge.ts#renderDecision`). A byte-preserving
 * OFFSET SPLICE, never a reserialization (`split`/`join` would normalize CRLF
 * and rewrite every line of a CRLF checkout, turning a tick-only round into a
 * whole-file diff — `src/Git.ts`'s `hashObjects` warns of the same failure
 * mode): every byte of `content` outside the resolved box offsets survives
 * untouched. Total — `fromMarkdown` never throws, so a structurally broken
 * document still gets its ticks cleared — and idempotent, since the result
 * has no `checked` item left for a second pass to find. Returns `content`
 * itself (not just an equal string) when there is nothing to clear, so a
 * caller can skip the write and leave the file's mtime untouched.
 */
export const clearFilePointerTicks = (content: string): string => {
  const tree = parseMarkdown(content)
  const offsets = taskItems(tree)
    .filter((item) => item.checked === true)
    .map((item) => checkboxOffset(content, item))
    .filter((o): o is number => o !== undefined)
    .sort((a, b) => a - b)
  if (offsets.length === 0) return content

  let result = ""
  let cursor = 0
  for (const offset of offsets) {
    result += content.slice(cursor, offset) + " "
    cursor = offset + 1
  }
  result += content.slice(cursor)
  return result
}

/** Flips the `[ ]`/`[x]` box of the hunk pointer task item starting at `line`, preserving path/note text exactly. `undefined` when `line` isn't a real task item's own start line, or its content isn't a valid hunk pointer. */
export const toggleFilePointer = (content: string, line: number): SteeringEdit | undefined => {
  const tree = parseMarkdown(content)
  const item = taskItems(tree).find((it) => toLspPosition(it.position!.start).line === line)
  if (!item?.position) return undefined

  const paragraph = item.children.find((c) => c.type === "paragraph")
  const firstWord = paragraph ? sourceText(content, paragraph).split(/\s+/)[0] : undefined
  if (!firstWord || !isPointerToken(firstWord)) return undefined

  const offset = checkboxOffset(content, item)
  if (offset === undefined) return undefined
  const position = toLspPositionFromOffset(content, offset)
  return {
    range: { start: position, end: { line: position.line, character: position.character + 1 } },
    newText: item.checked === true ? " " : "x",
  }
}

const lineRange = (lines: readonly string[], line: number) => ({
  start: { line, character: 0 },
  end: { line, character: (lines[line] ?? "").length },
})

const spanRange = (lines: readonly string[], startLine: number, endLine: number) => ({
  start: { line: startLine, character: 0 },
  end: { line: endLine, character: (lines[endLine] ?? "").length },
})

/** One footnote marker rendered as an outline leaf: `[^name] <body>`. */
const footnoteLeaf = (
  lines: readonly string[],
  definitionByName: ReadonlyMap<string, string>,
  marker: FootnoteMarker,
): SteeringOutlineNode => ({
  name: `[^${marker.name}] ${definitionByName.get(marker.name) ?? ""}`.trim(),
  range: lineRange(lines, marker.line),
  selectionRange: lineRange(lines, marker.line),
  leaf: true,
})

/**
 * Document outline for `.gtd/REVIEW.md`: the headlines of chunks (the
 * user-facing "work packages") that still carry at least one unchecked hunk
 * — the outline is the list of packages left to review — PLUS any chunk
 * that carries at least one footnote, even when every hunk in it is ticked:
 * `reviewOutline` otherwise drops a fully-checked chunk, which would make a
 * human's own comment vanish the moment they tick the last box. A chunk's
 * footnotes are `leaf: true` children; a chunk with none has no children.
 */
const reviewOutline = (content: string): readonly SteeringOutlineNode[] => {
  const { changesets } = parseReviewDoc(content)
  const { markers, definitions } = parseFootnotes(content)
  const definitionByName = new Map(definitions.map((d) => [d.name, d.body]))
  const lines = content.split(/\r?\n/)
  return changesets
    .map((chunk, i) => {
      const start = chunk.headingLine
      const end = Math.max(start, (changesets[i + 1]?.headingLine ?? lines.length) - 1)
      const checkedCount = chunk.files.filter((file) => file.checked).length
      const chunkMarkers = markers.filter((m) => m.line >= start && m.line <= end)
      const children = chunkMarkers.map((m) => footnoteLeaf(lines, definitionByName, m))
      return {
        name: `${chunk.title} (${checkedCount}/${chunk.files.length})`,
        range: spanRange(lines, start, end),
        selectionRange: lineRange(lines, start),
        ...(children.length > 0 ? { children } : {}),
        unchecked: checkedCount < chunk.files.length || chunkMarkers.length > 0,
      }
    })
    .filter((node) => node.unchecked)
    .map(({ unchecked: _unchecked, ...node }) => node)
}

/**
 * The target state a whole-chunk toggle drives every hunk to: `true` (check
 * all) unless a strict majority are already checked, in which case `false`
 * (uncheck all) — a chunk with no strict majority either way (including an
 * even split) defaults to checking, so it's never a meaningless no-op on a
 * chunk that's already uniform.
 */
const chunkToggleTarget = (checkedCount: number, total: number): boolean =>
  checkedCount * 2 <= total

/** Toggles every hunk in the chunk headed at `headingLine` to a single target state (`chunkToggleTarget`) — one edit per hunk not already at the target state, none when the chunk is already uniform. */
const toggleChunkEdits = (content: string, headingLine: number): SteeringEdit[] => {
  const { changesets } = parseReviewDoc(content)
  const chunk = changesets.find((c) => c.headingLine === headingLine)
  if (!chunk || chunk.files.length === 0) return []
  const checkedCount = chunk.files.filter((file) => file.checked).length
  const target = chunkToggleTarget(checkedCount, chunk.files.length)
  const edits: SteeringEdit[] = []
  for (const file of chunk.files) {
    if (file.checked === target) continue
    const edit = toggleFilePointer(content, file.sourceLine)
    if (edit) edits.push(edit)
  }
  return edits
}

/**
 * The block a footnote lands after when "add a footnote" fires with the
 * cursor at `cursorLine`: the containing hunk's own span (`ReviewFile.endLine`
 * — never a nested hunk's own span, since a parent hunk's `endLine` excludes
 * it) when the cursor sits in one, otherwise the surrounding top-level block
 * node's own end line (`blockNodeAt`, from `MarkdownTree.ts`).
 */
const footnoteBlockEnd = (content: string, tree: Root, cursorLine: number): number => {
  const { changesets } = parseReviewDoc(content)
  const hunk = changesets
    .flatMap((chunk) => chunk.files)
    .find((file) => cursorLine >= file.sourceLine && cursorLine <= file.endLine)
  if (hunk) return hunk.endLine
  const block = blockNodeAt(tree, cursorLine)
  return block?.position ? toLspPosition(block.position.end).line : cursorLine
}

/**
 * Actions for `.gtd/REVIEW.md`: "check/uncheck this hunk" when `range` sits
 * on a hunk line, "check/uncheck all hunks" when `range` sits anywhere in a
 * chunk (heading or body), and "add a footnote" everywhere EXCEPT inside an
 * existing marker's span or on an existing definition's own line — planting
 * a new marker/definition there would corrupt the footnote already written.
 */
const reviewActions: SteeringFormat["actions"] = (content, range) => {
  const { changesets } = parseReviewDoc(content)
  const tree = parseMarkdown(content)
  const lines = content.split(/\r?\n/)
  const cursorLine = range.start.line
  const actions: Array<{ readonly title: string; readonly edits: readonly SteeringEdit[] }> = []
  if (!isOnExistingFootnote(content, range.start)) {
    actions.push({
      title: "gtd: add a footnote",
      edits: footnoteAdditionEdits(
        content,
        range.start,
        footnoteBlockEnd(content, tree, cursorLine),
      ),
    })
  }

  // fallow-ignore-next-line complexity
  changesets.forEach((chunk, i) => {
    const hunk = chunk.files.find(
      (file) => cursorLine >= file.sourceLine && cursorLine <= file.endLine,
    )
    if (hunk) {
      const edit = toggleFilePointer(content, hunk.sourceLine)
      if (edit) {
        actions.push({
          title: hunk.checked ? "gtd: uncheck this hunk" : "gtd: check this hunk",
          edits: [edit],
        })
      }
    }

    const chunkEnd = Math.max(
      chunk.headingLine,
      (changesets[i + 1]?.headingLine ?? lines.length) - 1,
    )
    if (chunk.files.length > 0 && cursorLine >= chunk.headingLine && cursorLine <= chunkEnd) {
      const edits = toggleChunkEdits(content, chunk.headingLine)
      if (edits.length > 0) {
        const checkedCount = chunk.files.filter((file) => file.checked).length
        const willCheck = chunkToggleTarget(checkedCount, chunk.files.length)
        actions.push({
          title: willCheck
            ? `gtd: check all hunks in "${chunk.title}"`
            : `gtd: uncheck all hunks in "${chunk.title}"`,
          edits,
        })
      }
    }
  })

  return actions
}

/**
 * Go-to-definition pointer for a `.gtd/REVIEW.md` hunk line: the file the
 * hunk pointer at `line` (0-based) points into. Returns `undefined` when
 * `line` isn't a parsed hunk pointer (a heading, prose, or a malformed line
 * has no `sourceLine`). The `#line` in a pointer is 1-based (git/human line
 * numbers); this maps it to 0-based (`line - 1`) — a bare `./path` with no
 * `#line` lands at line 0. Path RESOLUTION (against a repo root) is the LSP's
 * concern, not this module's — the path returned here is the pointer's raw
 * `./`-relative text.
 */
const hunkPointerAt = (
  content: string,
  line: number,
): { path: string; line: number } | undefined => {
  const { changesets } = parseReviewDoc(content)
  const hunk = changesets.flatMap((chunk) => chunk.files).find((file) => file.sourceLine === line)
  if (!hunk) return undefined
  return { path: hunk.path, line: hunk.line !== undefined ? hunk.line - 1 : 0 }
}

/**
 * `.gtd/REVIEW.md`'s `pointerAt`: footnotes resolve FIRST (they're
 * column-scoped, the hunk jump is line-scoped — a marker sitting in a hunk's
 * inline note would otherwise be shadowed by it), the hunk-pointer jump to
 * another file second. An orphan marker/definition resolves (via
 * `footnotePointerAt`) to "handled, but no pointer" — so it returns
 * `undefined` here too, rather than falling through to the hunk jump.
 */
const reviewPointerAt: SteeringFormat["pointerAt"] = (content, position) => {
  const footnote = footnotePointerAt(content, position)
  if (footnote) return footnote.pointer
  return hunkPointerAt(content, position.line)
}

export const REVIEW_FORMAT: SteeringFormat = {
  sample: REVIEW_SAMPLE,
  validate: (content) => [
    ...parseReviewFindings(content).findings,
    ...parseFootnotes(content).findings,
  ],
  outline: reviewOutline,
  actions: reviewActions,
  pointerAt: reviewPointerAt,
}
