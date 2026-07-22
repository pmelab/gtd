/**
 * Pure parser/validator for the review structure `.gtd/REVIEW.md` must
 * follow — formalizing the shape the bundled default v3 workflow's
 * `reviewing` prompt (`src/workflows/default.yaml`) already tells the agent
 * to write:
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
 * **Executable spec ↔ bash validator contract:** this module is the
 * EXECUTABLE SPEC of that format — its own unit tests (`ReviewDoc.test.ts`)
 * are the format's spec tests. `src/workflows/default.yaml`'s
 * `review-validating` state independently re-implements the SAME rules as a
 * pragmatic bash/awk port (mechanics-only, not a full markdown parser) — see
 * that state's script for the sibling half of this contract. There is no
 * shared code path between the two on purpose: the engine (`PatternMachine`/
 * `Edge`/the bundled workflow) stays git/filesystem/Effect-dependency-free of
 * this module, and this module (and the LSP built on it, `src/Lsp.ts`) stays
 * independent of any particular workflow's shape. Keep both in sync by hand
 * when the format changes.
 *
 * No git, no filesystem, no Effect — trivially unit-testable and safe to call
 * from both the LSP's protocol edge (`src/Lsp.ts`) and any other IO layer that
 * wants to read/validate `.gtd/REVIEW.md`.
 */

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
export const FILE_POINTER_RE = /^-\s*\[([ xX])\]\s*(\.\/\S+?)(?:#(\d+))?(?:\s*[—-]+\s*(.*))?$/

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
 * required structure — the caller decides what to do with that (the machine
 * refuses the agent's turn capture; the `gtd changesets` CLI command just
 * reports it alongside whatever parsed).
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
