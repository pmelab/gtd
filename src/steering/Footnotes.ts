import type { Paragraph, Root } from "mdast"
import {
  blockNodeAt,
  lineRange,
  parseMarkdown,
  sourceText,
  spanRange,
  toLspPosition,
  toLspPositionFromOffset,
} from "./MarkdownTree.js"
import type {
  SteeringAction,
  SteeringEdit,
  SteeringFinding,
  SteeringOutlineNode,
  SteeringPointer,
  SteeringViewThread,
} from "./SteeringFormat.js"
import { eolOf } from "./Eol.js"
import { collectThreads } from "./Threads.js"
import type { Thread } from "./Threads.js"

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
  readonly findings: readonly SteeringFinding[]
}

/** The footnote-addition action's title — the ONE shared literal `qa`/`review` offer it under and `src/lsp/Lsp.ts` matches to compute the reveal position. A drifted copy in any one place silently breaks the cursor jump without failing a single test, so this constant is the only place the string is spelled. */
export const FOOTNOTE_ACTION_TITLE = "gtd: add a footnote"

/** The thread-reply action's title — shared with `src/lsp/Lsp.ts` for the same reason as `FOOTNOTE_ACTION_TITLE`. */
export const THREAD_REPLY_ACTION_TITLE = "gtd: reply"

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

/** A `FootnoteMarker`'s own `[^name]` span, as a `SteeringFinding.range` — the marker NODE the finding is about. */
const markerRange = (marker: FootnoteMarker) => ({
  start: { line: marker.line, character: marker.character },
  end: { line: marker.line, character: marker.endCharacter },
})

/** A `FootnoteDefinition`'s own span (its `[^name]:` line through its last continuation line), as a `SteeringFinding.range` — the definition NODE the finding is about. */
const definitionRange = (lines: readonly string[], def: FootnoteDefinition) => ({
  start: { line: def.line, character: 0 },
  end: { line: def.endLine, character: (lines[def.endLine] ?? "").length },
})

/** The stranded paragraph right after `def`, when the raw next line is indented 1-3 spaces (GFM's own threshold: 4+ joins the body, a tab expands to the next 4-column stop and joins too) and that line itself opens the top-level `paragraph` the tree sees there — never a second definition, heading, list, fence or other block, which the type check excludes structurally rather than via a hand-rolled list of block openers. */
const strandedParagraphAfter = (
  tree: Root,
  lines: readonly string[],
  def: FootnoteDefinition,
): Paragraph | undefined => {
  const nextLine = def.endLine + 1
  if (!/^ {1,3}\S/.test(lines[nextLine] ?? "")) return undefined
  const block = blockNodeAt(tree, nextLine)
  if (block?.type !== "paragraph") return undefined
  if (toLspPosition(block.position!.start).line !== nextLine) return undefined
  return block
}

const computeFindings = (
  content: string,
  lines: readonly string[],
  tree: Root,
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
        range: markerRange(marker),
      })
    }
  }

  for (const def of definitions) {
    const id = foldName(def.name)
    if (seenDefinitionIds.has(id)) {
      findings.push({
        message: `Duplicate footnote definition "[^${def.name}]"`,
        line: def.line,
        range: definitionRange(lines, def),
      })
    } else {
      seenDefinitionIds.add(id)
    }
    if (!referencedIds.has(id)) {
      findings.push({
        message: `Footnote definition "[^${def.name}]" has no marker referencing it`,
        line: def.line,
        range: definitionRange(lines, def),
      })
    }
    // The body being empty has two distinct causes that read the same on
    // `def` alone (`def.body` is empty either way) — telling them apart
    // needs the raw source below the definition, which no other finding
    // here depends on.
    if (def.body.trim() === "") {
      const stranded = strandedParagraphAfter(tree, lines, def)
      if (stranded) {
        findings.push({
          message: `Footnote definition "[^${def.name}]": the text below it is indented too little to belong to it — indent continuation lines by 4 spaces`,
          line: def.line,
          range: spanRange(lines, def.line, toLspPosition(stranded.position!.end).line),
        })
      } else {
        findings.push({
          message: `Footnote definition "[^${def.name}]" has an empty body`,
          line: def.line,
          range: definitionRange(lines, def),
        })
      }
    }
  }

  findings.push(...collectThreads(content, tree, markers).findings)
  return findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
}

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

  const lines = content.split(/\r?\n/)
  return {
    markers,
    definitions,
    findings: computeFindings(content, lines, tree, markers, definitions),
  }
}

/** Every thread (a footnote whose body is a `H:`/`A:` list) in `content` and its syntax findings, each prefixed `Footnote thread "[^name]": `, off the same `parseMarkdown` memo as `parseFootnotes`. */
export const parseThreadsWithFindings = (
  content: string,
): { readonly threads: readonly Thread[]; readonly findings: readonly SteeringFinding[] } =>
  collectThreads(content, parseMarkdown(content), parseFootnotes(content).markers)

export const parseThreads = (content: string): readonly Thread[] =>
  parseThreadsWithFindings(content).threads

/** One-entry memo: a view walks many runs of ONE document, each building its own lookup. */
let memo: { content: string; threads: ReadonlyMap<string, Thread> } | undefined
const threadsByName = (content: string, footnotes: Footnotes): ReadonlyMap<string, Thread> => {
  if (memo?.content !== content) {
    const threads = collectThreads(content, parseMarkdown(content), footnotes.markers).threads
    memo = { content, threads: new Map(threads.map((t) => [foldName(t.name), t])) }
  }
  return memo.threads
}

/**
 * A view node's note, resolved by the line its markers sit on. A thread fills
 * `thread` and suppresses `note`; a one-shot footnote fills `note`. Built once
 * per document so a view walking many nodes never re-parses per node.
 */
export const noteLookup = (
  content: string,
  footnotes: Footnotes = parseFootnotes(content),
): ((line: number) => { readonly note?: string; readonly thread?: SteeringViewThread }) => {
  const threads = threadsByName(content, footnotes)
  const bodies = new Map(footnotes.definitions.map((d) => [d.name, d.body]))
  return (line) => {
    const named = footnotes.markers.filter((m) => m.line === line)
    const thread = named.map((m) => threads.get(foldName(m.name))).find((t) => t !== undefined)
    if (thread) {
      return {
        thread: {
          name: thread.name,
          entries: thread.entries.map((e) => ({ author: e.author, text: e.text })),
          waitingOn: thread.waitingOn,
        },
      }
    }
    const note = named
      .map((m) => bodies.get(m.name))
      .filter((body): body is string => body !== undefined)
      .join(" ")
    return note === "" ? {} : { note }
  }
}

/** Thread syntax findings alone — what free-form `validate` reports without inheriting the other footnote findings. */
export const threadFindings = (content: string): readonly SteeringFinding[] =>
  collectThreads(content, parseMarkdown(content), []).findings

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

/** The guard "gtd: add a footnote" refuses itself on, rather than planting a marker inside another marker's name or a definition between an existing label and its body. */
export const isOnExistingFootnote = (
  content: string,
  position: { readonly line: number; readonly character: number },
): boolean => {
  const { markers, definitions } = parseFootnotes(content)
  if (markerAt(markers, position)) return true
  return definitions.some((d) => position.line >= d.line && position.line <= d.endLine)
}

/**
 * Deterministic short id derived from an anchor's own `key` — FNV-1a over the
 * UTF-8 bytes of `key`, base36-encoded — never a counter. Two concurrent
 * attaches at two different anchors (different `key`s) land on two distinct
 * ids without either seeing the other's write; two attaches at the SAME
 * anchor (same `key`) always land on the SAME id, which is exactly what lets
 * the caller reject the second one as a collision rather than double-attach.
 */
const anchorId = (key: string): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `na${(hash >>> 0).toString(36)}`
}

/** Where the server's `annotate` identifies the spot to attach a note: `line`/`endCharacter` are the anchor's own end (where the marker lands), `blockEndLine` is where the definition is planted (mirrors `footnoteAdditionEdits`'s `blockEndLine`), and `key` is a string uniquely identifying the anchor itself (never a cursor position) — the input to `anchorId`. */
export interface FootnoteAnchor {
  readonly line: number
  readonly endCharacter: number
  readonly blockEndLine: number
  readonly key: string
}

/** Entry text with continuation lines indented past the bullet's content column, so they stay inside the entry. */
const entryText = (text: string, eol: string): string => text.split(/\r?\n/).join(`${eol}      `)

export type FootnoteAttachResult =
  | { readonly ok: true; readonly id: string; readonly edits: readonly SteeringEdit[] }
  | { readonly ok: false; readonly reason: "id-collision" }

/**
 * Attaches a note at `anchor`'s end: a marker plus a definition seeded with
 * `text` VERBATIM, never the empty seed `footnoteAdditionEdits` writes — a
 * server-attached note has its real body at attach time, so the document
 * validates clean immediately instead of tripping the empty-body finding.
 * `id` derives from `anchor.key` alone, never a counter, so two concurrent
 * requests need no shared state.
 *
 * A SECOND call at the SAME anchor is an EDIT, not a collision: a marker whose
 * folded name equals `id` AND sits on `anchor.line` — the exact spot this
 * anchor's own marker edit would land — can only be its earlier attach. That
 * replaces the definition's body span in one edit. The same name collision
 * with NO marker there is genuinely ambiguous and still refuses.
 */
export const footnoteAttachEdits = (
  content: string,
  anchor: FootnoteAnchor,
  text: string,
): FootnoteAttachResult => {
  const { markers, definitions } = parseFootnotes(content)
  const id = anchorId(anchor.key)
  const existing = definitions.find((d) => foldName(d.name) === foldName(id))
  if (!existing) return { ok: true, id, edits: newThreadEdits(content, anchor, id, text) }
  const attachedHere = markers.some(
    (m) => foldName(m.name) === foldName(id) && m.line === anchor.line,
  )
  if (!attachedHere) return { ok: false, reason: "id-collision" }
  return { ok: true, id, edits: editExistingEdits(content, existing, id, text) }
}

/** The edit for a second attach at an anchor whose note already exists: reply to / replace into a thread, or replace a one-shot body. */
const editExistingEdits = (
  content: string,
  existing: FootnoteDefinition,
  id: string,
  text: string,
): readonly SteeringEdit[] => {
  const lines = content.split(/\r?\n/)
  const eol = eolOf(content)
  const thread = parseThreads(content).find((t) => foldName(t.name) === foldName(id))
  const last = thread?.entries[thread.entries.length - 1]
  const endOf = (line: number) => ({ line, character: (lines[line] ?? "").length })
  if (thread && last) {
    const entry = `- H: ${entryText(text, eol)}`
    if (thread.waitingOn === "human") {
      // An entry opening on the definition's own line has no bullet column to copy.
      const indent = " ".repeat(last.line === thread.line ? 4 : last.column)
      const at = endOf(last.endLine)
      return [{ range: { start: at, end: at }, newText: `${eol}${indent}${entry}` }]
    }
    return [
      {
        range: {
          start: { line: last.line, character: last.column },
          end: endOf(last.endLine),
        },
        newText: entry,
      },
    ]
  }
  return [
    {
      range: { start: { line: existing.line, character: 0 }, end: endOf(existing.endLine) },
      newText: `[^${id}]: ${text}`,
    },
  ]
}

/** A marker at the anchor's end plus a fresh single-entry `- H:` thread after its block. */
const newThreadEdits = (
  content: string,
  anchor: FootnoteAnchor,
  id: string,
  text: string,
): readonly SteeringEdit[] => {
  const lines = content.split(/\r?\n/)
  // The document's own newline style, preserved in newly-written bytes — a
  // splice into a CRLF file that inserts bare `\n` would leave a mixed-EOL
  // file behind, which is exactly the byte-level corruption this whole
  // package's offset-splice discipline exists to avoid.
  const eol = eolOf(content)
  const markerEdit: SteeringEdit = {
    range: {
      start: { line: anchor.line, character: anchor.endCharacter },
      end: { line: anchor.line, character: anchor.endCharacter },
    },
    newText: `[^${id}]`,
  }

  const insertLine = anchor.blockEndLine + 1
  const start = { line: insertLine, character: 0 }
  const nextContentLine = firstNonBlankFrom(lines, insertLine)
  const atEof = nextContentLine >= lines.length
  const body = `[^${id}]:${eol}    - H: ${entryText(text, eol)}`
  const definitionEdit: SteeringEdit = {
    range: { start, end: atEof ? start : { line: nextContentLine, character: 0 } },
    newText: atEof ? `${eol}${body}${eol}` : `${eol}${body}${eol}${eol}`,
  }
  return [markerEdit, definitionEdit]
}

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
 * The footnote half of `pointerAt`. `review` tries this FIRST because
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
  // caller's fallback (e.g. `review`'s hunk jump) instead of correctly not
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

/** The open threads, shaped for `openThreads` in every format that supports it. */
export const openThreadsOf = (
  content: string,
): readonly { readonly name: string; readonly line: number; readonly firstMe: string }[] =>
  parseThreads(content)
    .filter((t) => t.waitingOn === "human")
    .map((t) => ({
      name: t.name,
      line: t.line,
      firstMe: t.entries.find((e) => e.author === "me")?.text ?? "",
    }))

/** Threads as outline leaves, each paired with the line of its first marker (`undefined` when it has none) so a format can nest it under the block that marker sits in. A one-shot footnote is not a thread and yields nothing. */
export const threadOutlineNodes = (
  content: string,
): readonly { readonly markerLine: number | undefined; readonly node: SteeringOutlineNode }[] => {
  const lines = content.split(/\r?\n/)
  return parseThreads(content).map((t) => ({
    markerLine: t.markers[0]?.line,
    node: {
      name: `[^${t.name}]`,
      detail: t.waitingOn === "human" ? "waiting on you" : "waiting on the agent",
      range: spanRange(lines, t.line, t.endLine),
      selectionRange: lineRange(lines, t.line),
      leaf: true,
    },
  }))
}

/** One `Information` finding per open thread, on its last entry — what an editor flags as "your turn". */
export const openThreadFindings = (content: string): readonly SteeringFinding[] => {
  const lines = content.split(/\r?\n/)
  return parseThreads(content)
    .filter((t) => t.waitingOn === "human")
    .map((t) => {
      const last = t.entries[t.entries.length - 1]!
      return {
        message: `Footnote thread "[^${t.name}]" is waiting on you — reply with an "H:" entry`,
        line: last.line,
        range: spanRange(lines, last.line, last.endLine),
      }
    })
}

/** "gtd: reply" on an open thread when `position` is on one of its markers or anywhere in its definition. Offered only while the agent spoke last — a second `H:` would break strict alternation. */
export const threadReplyActions = (
  content: string,
  position: { readonly line: number; readonly character: number },
): readonly SteeringAction[] => {
  const thread = parseThreads(content).find(
    (t) =>
      t.waitingOn === "human" &&
      ((position.line >= t.line && position.line <= t.endLine) ||
        markerAt(t.markers, position) !== undefined),
  )
  const last = thread?.entries[thread.entries.length - 1]
  if (!thread || !last) return []
  const lines = content.split(/\r?\n/)
  // An entry opening on the definition's own line has no bullet column of its own to copy.
  const indent = " ".repeat(last.line === thread.line ? 4 : last.column)
  const at = { line: last.endLine, character: (lines[last.endLine] ?? "").length }
  return [
    {
      title: THREAD_REPLY_ACTION_TITLE,
      edits: [{ range: { start: at, end: at }, newText: `${eolOf(content)}${indent}- H: ` }],
    },
  ]
}
