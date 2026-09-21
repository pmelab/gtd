import { blockNodesOf } from "./Blocks.js"
import { eolOf } from "./Eol.js"
import { footnoteAttachEdits, type FootnoteAnchor } from "./Footnotes.js"
import { blockNodeAt, parseMarkdown, toLspPosition } from "./MarkdownTree.js"
import type {
  SteeringAnnotateResult,
  SteeringEdit,
  SteeringFormat,
  SteeringView,
} from "./SteeringFormat.js"

const FREE_FORM_SAMPLE = `Sample plan. Add a thing.

## Notes

Nothing here is validated — free-form has no structure to conform to.
`

/** Resolves a `paragraph` anchor: attaches at the end of `line`'s own text, the definition landing after that line's containing top-level block node. `undefined` when `line` isn't inside a real block — mirrors `qa.ts`/`review.ts`'s identical resolver. */
const resolveParagraphAnchor = (
  tree: ReturnType<typeof parseMarkdown>,
  lines: readonly string[],
  line: number,
): FootnoteAnchor | undefined => {
  const block = blockNodeAt(tree, line)
  if (!block?.position) return undefined
  return {
    line,
    endCharacter: (lines[line] ?? "").length,
    blockEndLine: toLspPosition(block.position.end).line,
    key: `paragraph:${line}`,
  }
}

/** Free-form's `annotate`: only a `paragraph` anchor resolves here (it's the only kind `view` ever reports) — delegates the two-edit mechanics to `Footnotes.ts#footnoteAttachEdits`, exactly as both built-ins do. */
const freeFormAnnotate: SteeringFormat["annotate"] = (
  content,
  anchor,
  text,
): SteeringAnnotateResult => {
  if (anchor.kind !== "paragraph") return { ok: false, reason: "anchor-not-found" }
  const tree = parseMarkdown(content)
  const lines = content.split(/\r?\n/)
  const resolved = resolveParagraphAnchor(tree, lines, anchor.line)
  if (!resolved) return { ok: false, reason: "anchor-not-found" }
  const result = footnoteAttachEdits(content, resolved, text)
  if (!result.ok) return result
  return { ok: true, edits: result.edits }
}

/**
 * A single edit spanning the WHOLE document, replacing it with `newText` —
 * free-form's `apply` reasons about the resulting document as a plain string
 * (splice/join on lines) rather than surgical offset math, since there is no
 * structure here to preserve beyond the blocks themselves. Its end position
 * is computed from a plain `"\n"` split — matching `applySteeringEdits`'s own
 * offset convention (a CRLF line keeps its `\r` as part of the line's own
 * length) rather than `/\r?\n/`, which would strip it and undercount.
 */
const wholeDocumentEdit = (content: string, newText: string): SteeringEdit => {
  const lines = content.split("\n")
  return {
    range: {
      start: { line: 0, character: 0 },
      end: { line: lines.length - 1, character: (lines[lines.length - 1] ?? "").length },
    },
    newText,
  }
}

/**
 * The append edit: `text` lands at the very end of the document, preceded by
 * exactly one blank line — trailing whitespace on the existing document is
 * trimmed first so this is idempotent regardless of how many blank lines
 * already trail it. An empty `text` (an append row submitted with nothing
 * typed) appends nothing rather than a bare trailing blank line.
 */
const appendEdit = (content: string, text: string): SteeringEdit => {
  const eol = eolOf(content)
  const trimmed = content.replace(/\s+$/, "")
  const normalizedText = text.split(/\r?\n/).join(eol)
  if (text.length === 0)
    return wholeDocumentEdit(content, trimmed.length > 0 ? `${trimmed}${eol}` : "")
  const newText =
    trimmed.length > 0 ? `${trimmed}${eol}${eol}${normalizedText}${eol}` : `${normalizedText}${eol}`
  return wholeDocumentEdit(content, newText)
}

/**
 * Free-form's `apply`: only a `paragraph` anchor resolves (the only kind
 * `view` ever reports). `anchor.line` matching a real top-level block's own
 * start line replaces that block's whole source span with `opts.text`
 * (`""` deletes the block AND its one trailing blank line, so repeated
 * deletes never pile up blank runs); a `line` at or beyond the document's
 * last line — past every real block — appends instead (`appendEdit`); any
 * other `line` (inside the document, but not a block's own start) refuses
 * `anchor-not-found`.
 */
const freeFormApply: SteeringFormat["apply"] = (content, anchor, opts): SteeringAnnotateResult => {
  if (anchor.kind !== "paragraph") return { ok: false, reason: "anchor-not-found" }
  const text = opts.text ?? ""
  const tree = parseMarkdown(content)
  const lines = content.split(/\r?\n/)
  const lastLineIndex = lines.length - 1
  const block = tree.children.find(
    (node) =>
      node.position !== undefined && toLspPosition(node.position.start).line === anchor.line,
  )

  if (!block) {
    if (anchor.line < lastLineIndex) return { ok: false, reason: "anchor-not-found" }
    return { ok: true, edits: [appendEdit(content, text)] }
  }

  const startLine = toLspPosition(block.position!.start).line
  const endLine = toLspPosition(block.position!.end).line

  const eol = eolOf(content)

  if (text.length === 0) {
    const hasTrailingBlank =
      endLine + 1 <= lastLineIndex && (lines[endLine + 1] ?? "").trim() === ""
    const deleteThroughLine = hasTrailingBlank ? endLine + 1 : endLine
    const newLines = [...lines.slice(0, startLine), ...lines.slice(deleteThroughLine + 1)]
    return { ok: true, edits: [wholeDocumentEdit(content, newLines.join(eol))] }
  }

  const newLines = [
    ...lines.slice(0, startLine),
    ...text.split(/\r?\n/),
    ...lines.slice(endLine + 1),
  ]
  return { ok: true, edits: [wholeDocumentEdit(content, newLines.join(eol))] }
}

/** Free-form's `view`: every top-level block, in document order, each carrying its own raw source bytes verbatim as `block.text` — no format-specific structure (no questions, no chunks) to project beyond the shared block walk. */
const freeFormView = (content: string): SteeringView => {
  const tree = parseMarkdown(content)
  return { nodes: blockNodesOf(content, tree, { fullText: true }) }
}

/**
 * The free-form `SteeringFormat`: no structure to validate, outline, or
 * offer code actions over — a mode-less steering file has no schema to
 * conform to, so `validate`/`outline`/`actions` are all constant `[]`, and
 * there is nothing to jump to (`pointerAt`/`documentLinks` stay absent).
 * Exported but deliberately NOT registered in `index.ts#REGISTRY` — this
 * package's later tasks wire it in as the FALLBACK for an absent or
 * unregistered `mode`, never a mode name of its own.
 */
export const freeFormFormat: SteeringFormat = {
  sample: FREE_FORM_SAMPLE,
  validate: () => [],
  outline: () => [],
  actions: () => [],
  view: freeFormView,
  annotate: freeFormAnnotate,
  apply: freeFormApply,
}
