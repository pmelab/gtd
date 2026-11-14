import type { Root } from "mdast"
import {
  parseMarkdown,
  sourceText,
  toLspPosition,
  toLspPositionFromOffset,
} from "./MarkdownTree.js"
import type { SteeringEdit, SteeringPointer } from "./SteeringFormat.js"

/** One `[^name]` marker's anchor: line AND column of its opening `[` — never the word or sentence it follows, which the reader reads itself. `endCharacter` is the column right after the closing `]`, on the same line (a marker's name has no whitespace, so it never spans a line) — the reference node's (or, for an orphan, the regex match's) own end, never hand-computed from `name.length`. */
export interface FootnoteMarker {
  readonly name: string
  readonly line: number
  readonly character: number
  readonly endCharacter: number
}

/**
 * One `[^name]:` definition — matched to its marker(s) by NAME alone, never
 * by position. `line`/`endLine` are the real GFM continuation span (from the
 * tree, not a hand-rolled rule): a continuation line needs FOUR spaces of
 * indent, not the two the old line-based parser used to accept, and an
 * unindented line right after one still extends the body as a LAZY paragraph
 * continuation — both a change from this package's predecessor, since GFM's
 * own rule differs from it.
 */
export interface FootnoteDefinition {
  readonly name: string
  readonly line: number
  readonly endLine: number
  readonly body: string
}

export interface Footnotes {
  readonly markers: readonly FootnoteMarker[]
  readonly definitions: readonly FootnoteDefinition[]
}

/**
 * A marker's shape once it's plain text: `[^name]`, name has no whitespace
 * and no `]`. Used to recognize an ORPHAN `[^name]` sitting inside an
 * ordinary `text` node — GFM only turns `[^name]` into a real
 * `footnoteReference` node when a matching definition exists; without one it
 * stays literal text, which is exactly the shape this pattern matches.
 */
const ORPHAN_MARKER_RE = /\[\^([^\s\]]+)\]/g

/** Markdown-whitespace-collapsed, case-folded form of a footnote name, for matching a marker to its definition regardless of authored casing — mirrors mdast's own `identifier` normalization (footnote names never contain internal whitespace, so case-folding alone suffices here). */
const foldName = (name: string): string => name.toLowerCase()

/**
 * Every `[^name]` in a `text` node's SOURCE slice, never `node.value` — a
 * character reference makes `value` shorter than its source and throws off
 * every subsequent column. Each hit is an orphan by construction: GFM keeps
 * `[^name]` as literal text only when no definition matches. A `text` node can
 * span several lines, so positions come from offsets, never one line per node.
 */
const orphanMarkers = (content: string, tree: Root): FootnoteMarker[] => {
  const found: FootnoteMarker[] = []
  const walk = (node: {
    readonly type: string
    readonly position?: unknown
    readonly children?: unknown
  }): void => {
    if (node.type === "text" && node.position) {
      const { start, end } = node.position as { start: { offset: number }; end: { offset: number } }
      const slice = content.slice(start.offset, end.offset)
      const re = new RegExp(ORPHAN_MARKER_RE)
      let match: RegExpExecArray | null
      while ((match = re.exec(slice)) !== null) {
        const position = toLspPositionFromOffset(content, start.offset + match.index)
        const endPosition = toLspPositionFromOffset(
          content,
          start.offset + match.index + match[0].length,
        )
        found.push({
          name: match[1]!,
          line: position.line,
          character: position.character,
          endCharacter: endPosition.character,
        })
      }
    }
    const children = node.children as readonly (typeof node)[] | undefined
    if (children) children.forEach(walk)
  }
  walk(tree)
  return found
}

/**
 * Parses every footnote marker and definition out of `content` off a single
 * mdast parse (`parseMarkdown`'s own memo makes a second call on the same
 * string free). Total and side-effect-free: always returns a result, never
 * throws, because `parseMarkdown` never does. Fenced code, indented code,
 * and inline-code spans are excluded from marker/definition recognition
 * structurally — they simply parse as other node types — rather than by a
 * hand-rolled skip list.
 */
type FootnoteTreeNode = {
  readonly type: string
  readonly position?: unknown
  readonly children?: unknown
  readonly label?: string
  readonly identifier?: string
}

/** Pushes `node` (a real `footnoteReference`) onto `markers` as a `FootnoteMarker`, its span taken from the reference node's own start/end — never hand-computed from `name.length`. */
const collectMarker = (node: FootnoteTreeNode, markers: FootnoteMarker[]): void => {
  const pos = node.position as {
    start: { line: number; column: number }
    end: { line: number; column: number }
  }
  const position = toLspPosition(pos.start)
  const endPosition = toLspPosition(pos.end)
  markers.push({
    name: node.label ?? node.identifier ?? "",
    line: position.line,
    character: position.character,
    endCharacter: endPosition.character,
  })
}

/** Pushes `node` (a real `footnoteDefinition`) onto `definitions` as a `FootnoteDefinition`, its body joined from `sourceText` over each child. */
const collectDefinition = (
  node: FootnoteTreeNode,
  content: string,
  definitions: FootnoteDefinition[],
): void => {
  const pos = node.position as {
    start: { line: number; column: number }
    end: { line: number; column: number }
  }
  const children = (node.children as readonly Parameters<typeof sourceText>[1][]) ?? []
  const body = children
    .map((child) => sourceText(content, child))
    .join(" ")
    .trim()
  definitions.push({
    name: node.label ?? node.identifier ?? "",
    line: toLspPosition(pos.start).line,
    endLine: toLspPosition(pos.end).line,
    body,
  })
}

export const parseFootnotes = (content: string): Footnotes => {
  const tree = parseMarkdown(content)
  const markers: FootnoteMarker[] = []
  const definitions: FootnoteDefinition[] = []

  const walk = (node: FootnoteTreeNode): void => {
    if (node.type === "footnoteReference" && node.position) {
      collectMarker(node, markers)
    } else if (node.type === "footnoteDefinition" && node.position) {
      collectDefinition(node, content, definitions)
    }
    const children = node.children as readonly FootnoteTreeNode[] | undefined
    if (children) children.forEach(walk)
  }
  walk(tree)

  markers.push(...orphanMarkers(content, tree))
  markers.sort((a, b) => a.line - b.line || a.character - b.character)

  return { markers, definitions }
}

/** The first integer unused by any `fnN` marker or definition already in the document — deterministic (no clock, no randomness), so "add a footnote" is testable and idempotent under re-run: applying it twice yields `fn1` then `fn2`, never a collision. Counts orphan markers too (via `parseFootnotes`), so it never reuses a name that's already written but undefined. */
export const nextFootnoteName = (content: string): string => {
  const { markers, definitions } = parseFootnotes(content)
  const NAME_RE = /^fn(\d+)$/i
  const used = new Set<number>()
  for (const name of [...markers.map((m) => m.name), ...definitions.map((d) => d.name)]) {
    const match = NAME_RE.exec(name)
    if (match) used.add(Number(match[1]))
  }
  let n = 1
  while (used.has(n)) n += 1
  return `fn${n}`
}

/** The first line index at or after `from` that is non-blank, or `lines.length` when none remain (EOF). */
const firstNonBlankFrom = (lines: readonly string[], from: number): number => {
  let i = from
  while (i < lines.length && lines[i]!.trim().length === 0) i += 1
  return i
}

/** The marker whose `[^name]` span (inclusive of both brackets) contains `position`, or `undefined`. Shared by `footnotePointerAt` and `isOnExistingFootnote` so the two can never disagree about what counts as "inside a marker". */
const markerAt = (
  markers: readonly FootnoteMarker[],
  position: { readonly line: number; readonly character: number },
): FootnoteMarker | undefined =>
  markers.find((m) => {
    if (m.line !== position.line) return false
    return position.character >= m.character && position.character <= m.endCharacter
  })

/**
 * The two edits behind "gtd: add a footnote": a marker at exactly the cursor
 * position (no scan, no `+1`) and an EMPTY definition after `blockEndLine`,
 * which each caller resolves itself. The definition edit REPLACES the whole
 * blank-line run after it, so the result is deterministic whatever the
 * surrounding whitespace.
 *
 * That edit starts at `(blockEndLine + 1, 0)`, never at the end of
 * `blockEndLine` — a line past the last index is a legal LSP position,
 * clamped to EOF. Anchoring one line later is what guarantees the two ranges
 * never touch: LSP gives coincident ranges in one action no defined
 * application order, and a naive apply corrupts whatever sits at that offset.
 */
export const footnoteAdditionEdits = (
  content: string,
  position: { readonly line: number; readonly character: number },
  blockEndLine: number,
): readonly SteeringEdit[] => {
  const lines = content.split(/\r?\n/)
  const name = nextFootnoteName(content)

  const markerEdit: SteeringEdit = {
    range: {
      start: { line: position.line, character: position.character },
      end: { line: position.line, character: position.character },
    },
    newText: `[^${name}]`,
  }

  const insertLine = blockEndLine + 1
  const start = { line: insertLine, character: 0 }
  const nextContentLine = firstNonBlankFrom(lines, insertLine)
  const atEof = nextContentLine >= lines.length
  const definitionEdit: SteeringEdit = {
    range: { start, end: atEof ? start : { line: nextContentLine, character: 0 } },
    newText: atEof ? `\n[^${name}]:\n` : `\n[^${name}]:\n\n`,
  }

  return [markerEdit, definitionEdit]
}

/**
 * The footnote half of `pointerAt`, tried FIRST because
 * footnotes are column-scoped and its hunk jump is line-scoped, which would
 * otherwise shadow a marker inside a hunk's note. `undefined` means "not a
 * footnote, try the next resolver"; `{ pointer: undefined }` means "resolved,
 * but to nothing" — the caller must NOT fall through.
 */
export const footnotePointerAt = (
  content: string,
  position: { readonly line: number; readonly character: number },
): { readonly pointer: SteeringPointer | undefined } | undefined => {
  const { markers, definitions } = parseFootnotes(content)

  const marker = markerAt(markers, position)
  if (marker) {
    const definition = definitions.find((d) => foldName(d.name) === foldName(marker.name))
    return { pointer: definition ? { line: definition.line } : undefined }
  }

  // The definition's OWN span, from the tree's real GFM continuation rule
  // (four spaces, plus lazy-paragraph continuation) — a looser, hand-rolled
  // "any indent continues" rule would disagree with it on some lines, and
  // trusting that instead would resolve a position to "on a definition, but
  // no pointer" when it isn't on this definition at all — wrongly blocking a
  // caller's fallback (e.g. a hunk jump) instead of correctly not
  // applying.
  const definition = definitions.find((d) => position.line >= d.line && position.line <= d.endLine)
  if (definition) {
    const firstMarker = markers.find((m) => foldName(m.name) === foldName(definition.name))
    return {
      pointer: firstMarker
        ? { line: firstMarker.line, character: firstMarker.character }
        : undefined,
    }
  }

  return undefined
}

/** The note whose marker sits on a 0-based line, as a view node's `note`. */
export const noteLookup = (
  content: string,
  footnotes: Footnotes = parseFootnotes(content),
): ((line: number) => { readonly note?: string }) => {
  const bodies = new Map(footnotes.definitions.map((d) => [foldName(d.name), d.body]))
  return (line) => {
    const marker = footnotes.markers.find((m) => m.line === line)
    const note = marker === undefined ? undefined : bodies.get(foldName(marker.name))
    return note === undefined ? {} : { note }
  }
}
