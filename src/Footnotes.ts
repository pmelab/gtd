import type { Root } from "mdast"
import {
  parseMarkdown,
  sourceText,
  toLspPosition,
  toLspPositionFromOffset,
} from "./MarkdownTree.js"
import type { SteeringEdit, SteeringFinding, SteeringPointer } from "./SteeringFormat.js"

/** One `[^name]` marker's anchor: line AND column of its opening `[` — never the word or sentence it follows, which the reader reads itself. */
export interface FootnoteMarker {
  readonly name: string
  readonly line: number
  readonly character: number
}

/** One `[^name]:` definition — matched to its marker(s) by NAME alone, never by position. */
export interface FootnoteDefinition {
  readonly name: string
  readonly line: number
  readonly endLine: number
  readonly body: string
}

export interface Footnotes {
  readonly markers: readonly FootnoteMarker[]
  readonly definitions: readonly FootnoteDefinition[]
  readonly findings: readonly SteeringFinding[]
}

/** The seeded placeholder a hand-authored definition starts as — still present means the human never filled it in. `footnoteAdditionEdits` (below) seeds new definitions with this exact text, so `computeFindings`'s placeholder check fires until a human replaces it. */
const PLACEHOLDER_BODY = "your comment"

/**
 * A marker's shape once it's plain text: `[^name]`, name has no whitespace
 * and no `]`. Used both to strip markers out of already-extracted text
 * (`stripFootnoteMarkers`) and to recognize an ORPHAN `[^name]` sitting
 * inside an ordinary `text` node — GFM only turns `[^name]` into a real
 * `footnoteReference` node when a matching definition exists; without one it
 * stays literal text, which is exactly the shape this pattern matches.
 */
const ORPHAN_MARKER_RE = /\[\^([^\s\]]+)\]/g

/** A definition's start line: `[^name]:` at COLUMN 0, nothing before it. Local to `isFootnoteDefinitionLine`, the one caller still walking raw lines instead of the tree. */
const LINE_DEFINITION_START_RE = /^\[\^([^\s\]]+)\]:\s?(.*)$/

/** A fenced-code-block delimiter line (any indent, ``` or more backticks) — local to `computeFenceSkip`, `isFootnoteDefinitionLine`'s one remaining caller. */
const LINE_FENCE_RE = /^\s*```/

/** A non-blank line that starts with leading whitespace — the shape of a definition's continuation line, for `isFootnoteDefinitionLine`'s own line-based walk. */
const isIndentedContinuationLine = (line: string): boolean =>
  line.trim().length > 0 && /^\s+\S/.test(line)

/**
 * For each line in `lines`, whether it's inside (or is the delimiter of) a
 * fenced code block — content that `isFootnoteDefinitionLine` excludes from
 * definition recognition. Survives ONLY as `isFootnoteDefinitionLine`'s
 * helper now that `parseFootnotes` reads real definitions off the tree
 * instead; goes away entirely once `isFootnoteDefinitionLine` itself moves
 * onto the tree, which it doesn't in this package (both steering formats
 * still call it line-based against `REVIEW.md`/`QUESTIONS.md` line arrays).
 */
const computeFenceSkip = (lines: readonly string[]): boolean[] => {
  const skip: boolean[] = []
  let inFence = false
  for (const line of lines) {
    if (LINE_FENCE_RE.test(line)) {
      skip.push(true)
      inFence = !inFence
    } else {
      skip.push(inFence)
    }
  }
  return skip
}

/**
 * True when `lines[index]` is part of a footnote definition — either the
 * `[^name]:` start line itself, or one of its indented continuation lines —
 * and is not itself fenced-code content. Walks backward through the
 * contiguous run of indented non-blank lines above `index` to find the
 * start; a blank line, an unindented line, fenced-code content, or the top
 * of `lines` ends the search with `false`. Exported so `OpenQuestions.ts`
 * and `ReviewDoc.ts` can break their own item/pointer spans on a definition
 * without re-parsing the whole document.
 */
export const isFootnoteDefinitionLine = (lines: readonly string[], index: number): boolean => {
  const line = lines[index]
  if (line === undefined) return false
  const fenceSkip = computeFenceSkip(lines)
  if (fenceSkip[index]) return false
  if (LINE_DEFINITION_START_RE.test(line)) return true
  if (!isIndentedContinuationLine(line)) return false

  let i = index - 1
  while (i >= 0) {
    if (fenceSkip[i]) return false
    const prev = lines[i]!
    if (LINE_DEFINITION_START_RE.test(prev)) return true
    if (!isIndentedContinuationLine(prev)) return false
    i -= 1
  }
  return false
}

/** Strips every `[^name]` marker out of `text` — applied to every extracted text field so a marker never leaks into an option's or note's text. */
export const stripFootnoteMarkers = (text: string): string => text.replace(ORPHAN_MARKER_RE, "")

/** Markdown-whitespace-collapsed, case-folded form of a footnote name, for matching a marker to its definition regardless of authored casing — mirrors mdast's own `identifier` normalization (footnote names never contain internal whitespace, so case-folding alone suffices here). */
const foldName = (name: string): string => name.toLowerCase()

const computeFindings = (
  markers: readonly FootnoteMarker[],
  definitions: readonly FootnoteDefinition[],
): readonly SteeringFinding[] => {
  const findings: SteeringFinding[] = []
  const definedIds = new Set(definitions.map((d) => foldName(d.name)))
  const referencedIds = new Set(markers.map((m) => foldName(m.name)))
  const seenDefinitionIds = new Set<string>()

  for (const marker of markers) {
    if (!definedIds.has(foldName(marker.name))) {
      findings.push({
        message: `Footnote marker "[^${marker.name}]" has no matching definition`,
        line: marker.line,
      })
    }
  }

  for (const def of definitions) {
    const id = foldName(def.name)
    if (seenDefinitionIds.has(id)) {
      findings.push({
        message: `Duplicate footnote definition "[^${def.name}]"`,
        line: def.line,
      })
    } else {
      seenDefinitionIds.add(id)
    }
    if (!referencedIds.has(id)) {
      findings.push({
        message: `Footnote definition "[^${def.name}]" has no marker referencing it`,
        line: def.line,
      })
    }
    if (def.body.trim().toLowerCase() === PLACEHOLDER_BODY) {
      findings.push({
        message: `Footnote definition "[^${def.name}]" still has its seeded placeholder body`,
        line: def.line,
      })
    }
  }

  return findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
}

/**
 * Every `[^name]` found inside an ordinary `text` node's own SOURCE slice
 * (never `node.value`: a character reference like `&amp;` makes `value`
 * shorter than its source, which would throw off every subsequent column in
 * that node) — each hit is, by construction, an orphan marker: GFM only
 * keeps `[^name]` as literal text when no definition matches, so anything
 * this scan finds already failed to become a real `footnoteReference` node.
 * A `text` node can span several source lines (a lazy list-item wrap parses
 * as one node), so each hit's position is computed from the node's own
 * offset plus the match's index in the slice, never from assuming one line
 * per node.
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
        found.push({ name: match[1]!, line: position.line, character: position.character })
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
export const parseFootnotes = (content: string): Footnotes => {
  const tree = parseMarkdown(content)
  const markers: FootnoteMarker[] = []
  const definitions: FootnoteDefinition[] = []

  const walk = (node: {
    readonly type: string
    readonly position?: unknown
    readonly children?: unknown
    readonly label?: string
    readonly identifier?: string
  }): void => {
    if (node.type === "footnoteReference" && node.position) {
      const position = toLspPosition(
        (node.position as { start: { line: number; column: number } }).start,
      )
      markers.push({ name: node.label ?? node.identifier ?? "", ...position })
    } else if (node.type === "footnoteDefinition" && node.position) {
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
    const children = node.children as readonly (typeof node)[] | undefined
    if (children) children.forEach(walk)
  }
  walk(tree)

  markers.push(...orphanMarkers(content, tree))
  markers.sort((a, b) => a.line - b.line || a.character - b.character)

  return { markers, definitions, findings: computeFindings(markers, definitions) }
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

/**
 * Where "add a footnote" plants the marker: scan right from `character` while
 * the character at that position is a word character, and stop there. One
 * rule, no branching — a cursor inside a word lands at the word's end, a
 * cursor already just past a word (or on whitespace/punctuation) doesn't
 * move at all, landing right at the cursor.
 */
export const footnoteMarkerColumn = (line: string, character: number): number => {
  let i = character
  while (i < line.length && /\w/.test(line[i]!)) i += 1
  return i
}

/** The first line index at or after `from` that is non-blank, or `lines.length` when none remain (EOF). */
const firstNonBlankFrom = (lines: readonly string[], from: number): number => {
  let i = from
  while (i < lines.length && lines[i]!.trim().length === 0) i += 1
  return i
}

/**
 * The last non-blank line of the current prose block starting at `index` —
 * the "otherwise" placement rule for "add a footnote": the next blank line,
 * or end of file. Shared by both formats' fallback case (a hunk's own span
 * and a question's option-list span are format-specific and computed by the
 * caller instead).
 */
export const proseBlockEnd = (lines: readonly string[], index: number): number => {
  let end = index
  for (let i = index + 1; i < lines.length; i += 1) {
    if (lines[i]!.trim().length === 0) break
    end = i
  }
  return end
}

/** The marker whose `[^name]` span (inclusive of both brackets) contains `position`, or `undefined`. Shared by `footnotePointerAt` and `isOnExistingFootnote` so the two can never disagree about what counts as "inside a marker". */
const markerAt = (
  markers: readonly FootnoteMarker[],
  position: { readonly line: number; readonly character: number },
): FootnoteMarker | undefined =>
  markers.find((m) => {
    if (m.line !== position.line) return false
    const end = m.character + m.name.length + 3 // `[^` + name + `]`
    return position.character >= m.character && position.character <= end
  })

/**
 * True when `position` sits inside an EXISTING marker's `[^name]` span, or on
 * an existing definition's own line (its `[^name]:` label line or an indented
 * continuation) — the guard "gtd: add a footnote" uses to refuse itself
 * rather than plant a new marker/definition into already-written footnote
 * syntax (which would corrupt it: a marker inserted inside another marker's
 * name, or a definition inserted between an existing definition's label and
 * its own name).
 */
export const isOnExistingFootnote = (
  content: string,
  position: { readonly line: number; readonly character: number },
): boolean => {
  const { markers } = parseFootnotes(content)
  if (markerAt(markers, position)) return true
  return isFootnoteDefinitionLine(content.split(/\r?\n/), position.line)
}

/**
 * The two edits behind "gtd: add a footnote": a marker inserted at the
 * cursor (via `footnoteMarkerColumn`) and a definition seeded with
 * `PLACEHOLDER_BODY`, planted right after `blockEndLine` — the caller's own
 * notion of "the current block's last line" (a hunk's span in `ReviewDoc.ts`,
 * an option-list's span in `OpenQuestions.ts`, or `proseBlockEnd` otherwise).
 * The definition edit REPLACES any existing blank-line run between
 * `blockEndLine` and the next non-blank content (or EOF) with exactly one
 * blank line, the definition, and — unless at EOF — one more blank line, so
 * the result is deterministic regardless of the surrounding whitespace.
 *
 * The definition edit's range starts at `(blockEndLine + 1, 0)` — the line
 * AFTER `blockEndLine` — never at the end of `blockEndLine` itself, even when
 * that line doesn't literally exist yet (a document with no trailing
 * newline): a `line` past the document's last index is a legal LSP position,
 * clamped to end-of-file, per the protocol. The marker edit's own position is
 * always on or before `blockEndLine` (callers only ever pass a `blockEndLine`
 * at or after the cursor's line), so anchoring one line later guarantees the
 * two edits' ranges never touch: two edits that share a start position have
 * no defined application order (LSP forbids overlapping — including
 * coincident-zero-length — ranges in one action), and a naive apply corrupts
 * whichever text sits at the shared offset.
 */
export const footnoteAdditionEdits = (
  content: string,
  position: { readonly line: number; readonly character: number },
  blockEndLine: number,
): readonly SteeringEdit[] => {
  const lines = content.split(/\r?\n/)
  const cursorLine = lines[position.line] ?? ""
  const markerColumn = footnoteMarkerColumn(cursorLine, position.character)
  const name = nextFootnoteName(content)

  const markerEdit: SteeringEdit = {
    range: {
      start: { line: position.line, character: markerColumn },
      end: { line: position.line, character: markerColumn },
    },
    newText: `[^${name}]`,
  }

  const insertLine = blockEndLine + 1
  const start = { line: insertLine, character: 0 }
  const nextContentLine = firstNonBlankFrom(lines, insertLine)
  const atEof = nextContentLine >= lines.length
  const definitionEdit: SteeringEdit = {
    range: { start, end: atEof ? start : { line: nextContentLine, character: 0 } },
    newText: atEof
      ? `\n[^${name}]: ${PLACEHOLDER_BODY}\n`
      : `\n[^${name}]: ${PLACEHOLDER_BODY}\n\n`,
  }

  return [markerEdit, definitionEdit]
}

/**
 * The footnote half of `pointerAt`, shared by `qa` (which serves footnote
 * jumps ONLY) and `review` (which tries this FIRST — footnotes are
 * column-scoped and the hunk jump is line-scoped, so a marker sitting in a
 * hunk's inline note would otherwise be shadowed by it). Returns `undefined`
 * when `position` isn't on a footnote at all (the caller should try its own
 * next resolver); returns `{ pointer: undefined }` for an orphan marker or
 * definition — resolved, but to nothing, so the caller must NOT fall through
 * to another resolver (an orphan marker inside a review hunk's note must not
 * jump to the hunk).
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

  const lines = content.split(/\r?\n/)
  if (isFootnoteDefinitionLine(lines, position.line)) {
    const definition = definitions.find(
      (d) => position.line >= d.line && position.line <= d.endLine,
    )
    const firstMarker = definition
      ? markers.find((m) => foldName(m.name) === foldName(definition.name))
      : undefined
    return {
      pointer: firstMarker
        ? { line: firstMarker.line, character: firstMarker.character }
        : undefined,
    }
  }

  return undefined
}
