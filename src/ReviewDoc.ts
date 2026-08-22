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
  /** 0-based index of the last NON-BLANK line of this pointer's span; equals `sourceLine` when it has no explanation. */
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
 * document: the header, the base comment, and one chunk with one file
 * pointer. Deliberately not authored to survive any particular formatter.
 */
const REVIEW_SAMPLE = `# Review: sample123
<!-- base: 0000000000000000000000000000000000000000 -->

## Sample chunk

- [ ] ./sample.ts#1
what this hunk does
`

const HEADER_RE = /^#\s+Review:\s*(\S+)\s*$/
const BASE_COMMENT_RE = /^<!--\s*base:\s*(\S+)\s*-->$/
const CHUNK_HEADING_RE = /^##\s+(.+)$/
/** One `- [ ]`/`- [x]` pointer line: the box, the whitespace-delimited pointer token, and the inline note segment that trails it. */
const FILE_POINTER_RE = /^-\s*\[([ xX])\]\s*(\S+)(?:\s+(.*))?$/
/** A pointer token's trailing `#<line>` (greedy, so a `#` inside the path stays in it). */
const POINTER_LINE_RE = /^(.*)#(\d+)$/
/** The optional dash that may lead the inline note segment or a continuation line — em dash, en dash, or hyphens. */
const NOTE_SEPARATOR_RE = /^[—–-]+\s*/

/** The `# Review: <hash>` header, required as the document's first non-blank line. */
const parseHeader = (lines: readonly string[]): string | undefined => {
  const firstNonBlank = lines.find((line) => line.trim().length > 0)
  return firstNonBlank ? HEADER_RE.exec(firstNonBlank.trim())?.[1] : undefined
}

/** The `<!-- base: <hash> -->` comment, wherever it appears in the document. */
const parseBaseComment = (lines: readonly string[]): string | undefined => {
  for (const line of lines) {
    const match = BASE_COMMENT_RE.exec(line.trim())
    if (match) return match[1]
  }
  return undefined
}

/** A pointer line's own fields — everything `FILE_POINTER_RE` can tell without looking at surrounding lines. */
interface ParsedPointer {
  readonly path: string
  readonly line?: number
  readonly checked: boolean
  readonly sourceLine: number
  /** Whatever trailed the pointer token on its own line, trimmed — the note's first segment, not an error carrier. Absent when the line is clean. */
  readonly inlineNote?: string
}

/** True when `token` parses as a file pointer's path token — leading `./`, and a path longer than two characters once an optional `#<line>` suffix is stripped. The single source of truth for "is this a pointer token", shared by `parseFilePointer` and the second-pointer finding below so the two can never drift apart. */
const isPointerToken = (token: string): boolean => {
  if (!token.startsWith("./")) return false
  const lineMatch = POINTER_LINE_RE.exec(token)
  const path = lineMatch ? lineMatch[1]! : token
  return path.length > 2 // `./` with nothing after it is not a path
}

/** One `- [ ]` / `- [x]` file-pointer line, or `undefined` if `line` isn't one. Text trailing the pointer token on its own line still parses as the note's inline segment, not an error. */
const parseFilePointer = (line: string, sourceLine: number): ParsedPointer | undefined => {
  const match = FILE_POINTER_RE.exec(line)
  if (!match) return undefined
  const token = match[2]!
  if (!isPointerToken(token)) return undefined
  const lineMatch = POINTER_LINE_RE.exec(token)
  const path = lineMatch ? lineMatch[1]! : token
  const inlineNote = (match[3] ?? "").trim()
  return {
    checked: match[1] !== " ",
    path,
    ...(lineMatch ? { line: Number(lineMatch[2]) } : {}),
    sourceLine,
    ...(inlineNote.length > 0 ? { inlineNote } : {}),
  }
}

/** One raw body line of a chunk, paired with its 0-based line index in the document. */
interface BodyLine {
  readonly text: string
  readonly line: number
}

/**
 * Index (into `body`) of the last NON-BLANK line belonging to the pointer that
 * starts at `index`: every following line up to (but excluding) the next
 * pointer line belongs to this pointer's span. Unlike `OpenQuestions.ts`'s
 * `itemEndIndex`, a blank line does NOT end the span — the review format
 * admits multi-paragraph explanations, so a blank line between two
 * continuation paragraphs stays inside the span; the returned index is just
 * trimmed back to the last non-blank line so a trailing blank run before the
 * next pointer/heading isn't absorbed.
 */
const pointerEndIndex = (body: readonly BodyLine[], index: number): number => {
  let end = index
  for (let i = index + 1; i < body.length; i += 1) {
    const trimmed = body[i]!.text.trim()
    if (trimmed.length === 0) continue
    if (parseFilePointer(trimmed, body[i]!.line)) break
    end = i
  }
  return end
}

/** Joins a pointer's gathered explanation: every non-blank line strictly between `startIndex` and `endIndex` (inclusive), each stripped of a leading dash, joined with a single space. */
const gatherNote = (body: readonly BodyLine[], startIndex: number, endIndex: number): string => {
  const noteLines: string[] = []
  for (let j = startIndex + 1; j <= endIndex; j += 1) {
    const t = body[j]!.text.trim()
    if (t.length > 0) noteLines.push(t.replace(NOTE_SEPARATOR_RE, ""))
  }
  return noteLines.join(" ").trim()
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
  pointer: ParsedPointer,
  secondToken: string,
): SteeringFinding => {
  const target = pointer.line !== undefined ? `${pointer.path}#${pointer.line}` : pointer.path
  return {
    message: `Chunk "${title}" hunk ${target}'s note starts with a second pointer (${secondToken}) — give it its own "- [ ]" line`,
    line: pointer.sourceLine,
  }
}

/**
 * One pointer's parsed `ReviewFile` — its note composed from the inline
 * (same-line) segment first, then the lines gathered from below it, joined
 * with a single space — plus the second-pointer finding when the inline
 * segment itself opens with a pointer token, and the body index just past
 * this pointer's span for the caller to resume from.
 *
 * The second-pointer check is scoped to the inline segment ALONE, never the
 * composed note: a below-pointer explanation that legitimately opens with a
 * path (`./src/foo.ts is the caller`) must not be refused — refusing a
 * legitimate explanation is exactly the class of hard stop this format
 * relaxation exists to remove.
 */
const parsePointerSpan = (
  title: string,
  body: readonly BodyLine[],
  index: number,
  pointer: ParsedPointer,
): { readonly file: ReviewFile; readonly error?: SteeringFinding; readonly nextIndex: number } => {
  const endIndex = pointerEndIndex(body, index)
  const inlineSegment = (pointer.inlineNote ?? "").replace(NOTE_SEPARATOR_RE, "")
  const belowNote = gatherNote(body, index, endIndex)
  const note = [inlineSegment, belowNote].filter((segment) => segment.length > 0).join(" ")
  const { inlineNote: _inlineNote, ...pointerFields } = pointer
  const file: ReviewFile = {
    ...pointerFields,
    endLine: body[endIndex]!.line,
    ...(note.length > 0 ? { note } : {}),
  }
  const secondToken = inlineSegment.split(/\s+/)[0] ?? ""
  const error = isPointerToken(secondToken)
    ? secondPointerError(title, pointer, secondToken)
    : undefined
  return {
    file,
    ...(error ? { error } : {}),
    nextIndex: endIndex + 1,
  }
}

/** Splits one chunk's body lines (up to the next `##` heading) into its file pointers (each with its gathered below-the-pointer note and span) and description prose — only the lines before the chunk's FIRST pointer. */
const parseChunkBody = (
  title: string,
  body: readonly BodyLine[],
): {
  readonly description: string
  readonly files: readonly ReviewFile[]
  readonly errors: readonly SteeringFinding[]
} => {
  const files: ReviewFile[] = []
  const errors: SteeringFinding[] = []
  const descriptionLines: string[] = []
  let i = 0
  while (i < body.length) {
    const trimmed = body[i]!.text.trim()
    if (trimmed.length === 0) {
      i += 1
      continue
    }
    const pointer = parseFilePointer(trimmed, body[i]!.line)
    if (!pointer) {
      descriptionLines.push(trimmed)
      i += 1
      continue
    }
    const { file, error, nextIndex } = parsePointerSpan(title, body, i, pointer)
    files.push(file)
    if (error) errors.push(error)
    i = nextIndex
  }
  return { description: descriptionLines.join(" "), files, errors }
}

const splitChunks = (
  lines: readonly string[],
): ReadonlyArray<{ title: string; headingLine: number; body: BodyLine[] }> => {
  const chunks: Array<{ title: string; headingLine: number; body: BodyLine[] }> = []
  let i = 0
  while (i < lines.length) {
    const chunkMatch = CHUNK_HEADING_RE.exec(lines[i]!.trim())
    if (!chunkMatch) {
      i += 1
      continue
    }
    const title = chunkMatch[1]!.trim()
    const headingLine = i
    i += 1
    const body: BodyLine[] = []
    while (i < lines.length && !CHUNK_HEADING_RE.test(lines[i]!.trim())) {
      body.push({ text: lines[i]!, line: i })
      i += 1
    }
    chunks.push({ title, headingLine, body })
  }
  return chunks
}

const parseChangesets = (
  lines: readonly string[],
): { readonly changesets: readonly Changeset[]; readonly errors: readonly SteeringFinding[] } => {
  const changesets: Changeset[] = []
  const errors: SteeringFinding[] = []
  for (const { title, headingLine, body } of splitChunks(lines)) {
    const { description, files, errors: bodyErrors } = parseChunkBody(title, body)
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
  const lines = content.split(/\r?\n/)
  const shortHash = parseHeader(lines)
  const fullHash = parseBaseComment(lines)
  const { changesets, errors: chunkFindings } = parseChangesets(lines)

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
 * never throws. `errors` is non-empty exactly when the document violates the
 * required structure — the caller decides what to do with that (`gtd validate`
 * exits non-zero with them; the LSP publishes them as diagnostics).
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

/** Flips the `[ ]`/`[x]` box of the hunk line at `line`, preserving path/note text exactly. */
export const toggleFilePointer = (content: string, line: number): SteeringEdit | undefined => {
  const raw = content.split(/\r?\n/)[line]
  if (raw === undefined) return undefined
  const leading = raw.length - raw.trimStart().length
  const trimmed = raw.slice(leading)
  const pointer = parseFilePointer(trimmed, line)
  if (pointer === undefined) return undefined
  const character = leading + trimmed.indexOf("[") + 1
  return {
    range: { start: { line, character }, end: { line, character: character + 1 } },
    newText: pointer.checked ? " " : "x",
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

/** Document outline for `.gtd/REVIEW.md`: only the headlines of chunks (the user-facing "work packages") that still carry at least one unchecked hunk — the outline is the list of packages left to review, nothing else. No children — a chunk headline is the whole node. */
const reviewOutline = (content: string): readonly SteeringOutlineNode[] => {
  const { changesets } = parseReviewDoc(content)
  const lines = content.split(/\r?\n/)
  return changesets
    .map((chunk, i) => {
      const start = chunk.headingLine
      const end = Math.max(start, (changesets[i + 1]?.headingLine ?? lines.length) - 1)
      const checkedCount = chunk.files.filter((file) => file.checked).length
      return {
        name: `${chunk.title} (${checkedCount}/${chunk.files.length})`,
        range: spanRange(lines, start, end),
        selectionRange: lineRange(lines, start),
        unchecked: checkedCount < chunk.files.length,
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

/** Toggles every hunk in the chunk headed at `headingLine` to a single target state (`chunkToggleTarget`). Only hunks not already at the target state produce an edit. */
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

/** Actions for `.gtd/REVIEW.md`: "check/uncheck this hunk" when `range` sits on a hunk line, "check/uncheck all hunks" when `range` sits anywhere in a chunk (heading or body). */
const reviewActions: SteeringFormat["actions"] = (content, range) => {
  const { changesets } = parseReviewDoc(content)
  const lines = content.split(/\r?\n/)
  const cursorLine = range.start.line
  const actions: Array<{ readonly title: string; readonly edits: readonly SteeringEdit[] }> = []

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
const reviewPointerAt = (
  content: string,
  line: number,
): { path: string; line: number } | undefined => {
  const { changesets } = parseReviewDoc(content)
  const hunk = changesets.flatMap((chunk) => chunk.files).find((file) => file.sourceLine === line)
  if (!hunk) return undefined
  return { path: hunk.path, line: hunk.line !== undefined ? hunk.line - 1 : 0 }
}

export const REVIEW_FORMAT: SteeringFormat = {
  sample: REVIEW_SAMPLE,
  validate: (content) => parseReviewFindings(content).findings,
  outline: reviewOutline,
  actions: reviewActions,
  pointerAt: reviewPointerAt,
}
