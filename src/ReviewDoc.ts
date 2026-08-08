/**
 * Pure parser/validator for the review structure `.gtd/REVIEW.md` must
 * follow — formalizing the shape the unified template's `reviewing` prompt
 * (`src/workflows/unified.yaml`) already tells the agent to write:
 *
 * ```markdown
 * # Review: <short-hash>
 *
 * <!-- base: <full-hash> -->
 *
 * ## <Chunk Title>
 *
 * <What this chunk changes and why>
 *
 * - [ ] ./path/to/file.ts#42
 * - [ ] ./path/to/file.ts#99
 * ```
 *
 * Required: the `# Review: <hash>` header (as the document's first non-blank
 * line), the `<!-- base: <hash> -->` comment, and at least one `##` chunk
 * with a non-empty title and at least one `- [ ]` / `- [x]` file pointer.
 *
 * **The format's single source of truth.** This module is the EXECUTABLE SPEC
 * of that format — its own unit tests (`ReviewDoc.test.ts`) are the format's
 * spec tests. Both consumers of the format run THIS parser, so there is no
 * second implementation to keep in sync: the `gtd validate` CLI command
 * (`src/program.ts`) parses the resolved state's `review`-mode file and exits
 * non-zero with the `errors` below, and the LSP (`src/Lsp.ts`) publishes the
 * same `errors` as live diagnostics. The engine (`PatternMachine`/`Edge`/the
 * bundled workflow) itself stays git/filesystem/Effect-dependency-free of this
 * module, and this module stays independent of any particular workflow's shape.
 *
 * No git, no filesystem, no Effect — trivially unit-testable and safe to call
 * from both the LSP's protocol edge (`src/Lsp.ts`) and any other IO layer that
 * wants to read/validate `.gtd/REVIEW.md`.
 */

import type { SteeringEdit, SteeringFormat, SteeringOutlineNode } from "./SteeringFormat.js"

export interface ReviewFile {
  readonly path: string
  readonly line?: number
  readonly checked: boolean
  readonly note?: string
  /** 0-based line index of this file pointer's own `- [ ]`/`- [x]` line in REVIEW.md, for editor tooling. */
  readonly sourceLine: number
}

export interface Changeset {
  readonly title: string
  readonly description: string
  readonly files: readonly ReviewFile[]
  /** 0-based line index of this chunk's `##` heading, for editor tooling. */
  readonly headingLine: number
}

export interface ReviewDoc {
  readonly shortHash?: string
  readonly fullHash?: string
  readonly changesets: readonly Changeset[]
  readonly errors: readonly string[]
}

const HEADER_RE = /^#\s+Review:\s*(\S+)\s*$/
const BASE_COMMENT_RE = /^<!--\s*base:\s*(\S+)\s*-->$/
const CHUNK_HEADING_RE = /^##\s+(.+)$/
const FILE_POINTER_RE = /^-\s*\[([ xX])\]\s*(\.\/\S+?)(?:#(\d+))?(?:\s*[—-]+\s*(.*))?$/

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

/** One `- [ ]` / `- [x]` file-pointer line, or `undefined` if `line` isn't one. */
const parseFilePointer = (line: string, sourceLine: number): ReviewFile | undefined => {
  const match = FILE_POINTER_RE.exec(line)
  if (!match) return undefined
  return {
    checked: match[1] !== " ",
    path: match[2]!,
    ...(match[3] !== undefined ? { line: Number(match[3]) } : {}),
    ...(match[4] && match[4].trim().length > 0 ? { note: match[4].trim() } : {}),
    sourceLine,
  }
}

/** One raw body line of a chunk, paired with its 0-based line index in the document. */
interface BodyLine {
  readonly text: string
  readonly line: number
}

/** Splits one chunk's body lines (up to the next `##` heading) into its file pointers and description prose. */
const parseChunkBody = (
  body: readonly BodyLine[],
): { readonly description: string; readonly files: readonly ReviewFile[] } => {
  const files: ReviewFile[] = []
  const descriptionLines: string[] = []
  for (const raw of body) {
    const trimmed = raw.text.trim()
    if (trimmed.length === 0) continue
    const file = parseFilePointer(trimmed, raw.line)
    if (file) {
      files.push(file)
    } else {
      descriptionLines.push(trimmed)
    }
  }
  return { description: descriptionLines.join(" "), files }
}

/** Splits the document into `##` chunks, each with its title, heading line, and body lines. */
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

/** Parses every `##` chunk into a `Changeset`, collecting one error per chunk with no file pointers. */
const parseChangesets = (
  lines: readonly string[],
): { readonly changesets: readonly Changeset[]; readonly errors: readonly string[] } => {
  const changesets: Changeset[] = []
  const errors: string[] = []
  for (const { title, headingLine, body } of splitChunks(lines)) {
    const { description, files } = parseChunkBody(body)
    if (files.length === 0) errors.push(`Chunk "${title}" has no file pointers`)
    changesets.push({ title, description, files, headingLine })
  }
  if (changesets.length === 0) errors.push("REVIEW.md has no '##' chunks")
  return { changesets, errors }
}

/**
 * Parses the review structure out of `content` (the raw text of
 * `.gtd/REVIEW.md`). Total and side-effect-free: always returns a result,
 * never throws. `errors` is non-empty exactly when the document violates the
 * required structure — the caller decides what to do with that (`gtd validate`
 * exits non-zero with them; the LSP publishes them as diagnostics).
 */
export const parseReviewDoc = (content: string): ReviewDoc => {
  const lines = content.split(/\r?\n/)
  const shortHash = parseHeader(lines)
  const fullHash = parseBaseComment(lines)
  const { changesets, errors: chunkErrors } = parseChangesets(lines)

  const errors = [
    ...(shortHash
      ? []
      : ["Missing or malformed '# Review: <hash>' header as the document's first line"]),
    ...(fullHash ? [] : ["Missing '<!-- base: <hash> -->' comment"]),
    ...chunkErrors,
  ]

  return {
    ...(shortHash ? { shortHash } : {}),
    ...(fullHash ? { fullHash } : {}),
    changesets,
    errors,
  }
}

/**
 * Every file pointer in every chunk that is not ticked, over a freshly-parsed
 * document — the structured narrowing the review sign-off guard
 * (`src/StepGuards.ts`) counts instead of a raw `- [ ]` regex over the whole
 * document: a bare `- []`, an indented note, or a non-`./` path outside a
 * chunk's file pointers no longer counts.
 */
export const untickedFiles = (content: string): readonly ReviewFile[] =>
  parseReviewDoc(content)
    .changesets.flatMap((chunk) => chunk.files)
    .filter((file) => !file.checked)

/** Flips the `[ ]`/`[x]` box of the hunk line at `line`, preserving path/note text exactly. */
export const toggleFilePointer = (content: string, line: number): SteeringEdit | undefined => {
  const raw = content.split(/\r?\n/)[line]
  if (raw === undefined) return undefined
  const leading = raw.length - raw.trimStart().length
  const trimmed = raw.slice(leading)
  const match = FILE_POINTER_RE.exec(trimmed)
  if (!match) return undefined
  const bracketContent = match[0].indexOf("[") + 1
  const character = leading + bracketContent
  return {
    range: { start: { line, character }, end: { line, character: character + 1 } },
    newText: match[1] === " " ? "x" : " ",
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
    const hunk = chunk.files.find((file) => file.sourceLine === cursorLine)
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

/** The `review` steering format: gtd's own in-process review-checkbox format — validation, outline, code actions, and `pointerAt` (a hunk pointer's go-to-definition target). */
export const REVIEW_FORMAT: SteeringFormat = {
  validate: (content) => parseReviewDoc(content).errors,
  outline: reviewOutline,
  actions: reviewActions,
  pointerAt: reviewPointerAt,
}
