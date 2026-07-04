import crypto from "node:crypto"
import { diffLines } from "diff"

/**
 * Compute a git-compatible blob SHA (first 7 hex digits).
 * Matches `git hash-object <file>` for the given string content.
 */
function blobSha7(content: string): string {
  const buf = Buffer.from(content, "utf8")
  const hash = crypto.createHash("sha1")
  hash.update(`blob ${buf.length}\0`)
  hash.update(buf)
  return hash.digest("hex").slice(0, 7)
}

/**
 * Detect binary content: a string is considered binary if it contains
 * a null byte (U+0000), matching git's heuristic.
 */
function isBinary(content: string): boolean {
  return content.includes("\0")
}

/**
 * Format a hunk position: omit the `,count` when count === 1 (git convention).
 * e.g. count=1,start=1 → "1"; count=2,start=1 → "1,2"; count=0,start=0 → "0,0"
 */
function hunkPos(start: number, count: number): string {
  if (count === 1) return String(start)
  return `${start},${count}`
}

/**
 * Split a file string into lines, tracking whether the file ends with a newline.
 * Returns `{ lines, noNewline }` where `noNewline` means the file doesn't end with \n.
 */
function splitLines(content: string): { lines: string[]; noNewline: boolean } {
  if (content === "") return { lines: [], noNewline: false }
  const noNewline = !content.endsWith("\n")
  const raw = content.endsWith("\n") ? content.slice(0, -1) : content
  return { lines: raw.split("\n"), noNewline }
}

interface DiffLine {
  type: "context" | "removed" | "added"
  text: string
  noNewline: boolean
}

/** Convert `diffLines()` chunks into a flat annotated line list. */
function buildAnnotatedLines(chunks: ReturnType<typeof diffLines>): DiffLine[] {
  const lines: DiffLine[] = []
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci]!
    const { lines: chunkLines, noNewline } = splitLines(chunk.value)
    const isLast = ci === chunks.length - 1
    for (let li = 0; li < chunkLines.length; li++) {
      lines.push({
        type: chunk.added ? "added" : chunk.removed ? "removed" : "context",
        text: chunkLines[li]!,
        noNewline: isLast && li === chunkLines.length - 1 && noNewline,
      })
    }
  }
  return lines
}

/** Group changed line indices (±context) into non-overlapping hunk ranges. */
function buildHunkRanges(
  lines: DiffLine[],
  context: number,
): Array<{ start: number; end: number }> {
  const changedIndices = new Set<number>()
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.type !== "context") changedIndices.add(i)
  }
  if (changedIndices.size === 0) return []

  const ranges: Array<{ start: number; end: number }> = []
  let current: { start: number; end: number } | null = null
  for (const idx of [...changedIndices].sort((a, b) => a - b)) {
    const start = Math.max(0, idx - context)
    const end = Math.min(lines.length - 1, idx + context)
    if (current === null) {
      current = { start, end }
    } else if (start <= current.end + 1) {
      current.end = Math.max(current.end, end)
    } else {
      ranges.push(current)
      current = { start, end }
    }
  }
  if (current !== null) ranges.push(current)
  return ranges
}

/** Render one hunk range given the pre-computed old/new line number maps. */
// fallow-ignore-next-line complexity
function renderHunkRange(
  range: { start: number; end: number },
  lines: DiffLine[],
  oldLineOf: number[],
  newLineOf: number[],
): string[] {
  const { start, end } = range
  let oldStart = -1
  let newStart = -1
  let oldCount = 0
  let newCount = 0
  for (let i = start; i <= end; i++) {
    const ol = oldLineOf[i]!
    const nl = newLineOf[i]!
    if (ol !== -1) {
      if (oldStart === -1) oldStart = ol
      oldCount++
    }
    if (nl !== -1) {
      if (newStart === -1) newStart = nl
      newCount++
    }
  }
  if (oldStart === -1) oldStart = 0
  if (newStart === -1) newStart = 0

  const out: string[] = []
  out.push(`@@ -${hunkPos(oldStart, oldCount)} +${hunkPos(newStart, newCount)} @@`)
  for (let i = start; i <= end; i++) {
    const line = lines[i]!
    const prefix = line.type === "context" ? " " : line.type === "removed" ? "-" : "+"
    out.push(`${prefix}${line.text}`)
    if (line.noNewline) out.push("\\ No newline at end of file")
  }
  return out
}

/**
 * Render git-format unified diff hunks for a before→after content pair.
 * Uses 3 context lines (git default). Returns the hunk lines without a final newline.
 */
function renderHunks(before: string, after: string): ReadonlyArray<string> {
  const context = 3
  const allLines = buildAnnotatedLines(diffLines(before, after))
  if (allLines.length === 0) return []

  const hunkRanges = buildHunkRanges(allLines, context)
  if (hunkRanges.length === 0) return []

  const oldLineOf: number[] = []
  const newLineOf: number[] = []
  let oldLineNum = 1
  let newLineNum = 1
  for (const line of allLines) {
    if (line.type === "context") {
      oldLineOf.push(oldLineNum++)
      newLineOf.push(newLineNum++)
    } else if (line.type === "removed") {
      oldLineOf.push(oldLineNum++)
      newLineOf.push(-1)
    } else {
      oldLineOf.push(-1)
      newLineOf.push(newLineNum++)
    }
  }

  const output: string[] = []
  for (const range of hunkRanges) {
    output.push(...renderHunkRange(range, allLines, oldLineOf, newLineOf))
  }
  return output
}

/** Render the diff block for a single file (new, deleted, or modified). */
function renderFileDiff(
  path: string,
  before: string | null,
  after: string | null,
  beforeSha: string,
  afterSha: string,
): string[] {
  const lines: string[] = [`diff --git a/${path} b/${path}`]
  const binary = (before !== null && isBinary(before)) || (after !== null && isBinary(after))

  if (before === null) {
    lines.push("new file mode 100644", `index ${beforeSha}..${afterSha}`)
    if (binary) {
      lines.push(`Binary files /dev/null and b/${path} differ`)
    } else {
      lines.push("--- /dev/null", `+++ b/${path}`, ...renderHunks("", after!))
    }
  } else if (after === null) {
    lines.push("deleted file mode 100644", `index ${beforeSha}..${afterSha}`)
    if (binary) {
      lines.push(`Binary files a/${path} and /dev/null differ`)
    } else {
      lines.push(`--- a/${path}`, "+++ /dev/null", ...renderHunks(before, ""))
    }
  } else {
    lines.push(`index ${beforeSha}..${afterSha} 100644`)
    if (binary) {
      lines.push(`Binary files a/${path} and b/${path} differ`)
    } else {
      lines.push(`--- a/${path}`, `+++ b/${path}`, ...renderHunks(before, after))
    }
  }
  return lines
}

/**
 * Render a git-format unified diff for a set of file changes.
 * Pure function — no IO, no Effect.
 */
export const renderDiff = (
  files: ReadonlyArray<{
    readonly path: string
    readonly before: string | null
    readonly after: string | null
  }>,
): string => {
  const parts: string[] = []
  for (const { path, before, after } of files) {
    if (before === after) continue
    const beforeSha = before !== null ? blobSha7(before) : "0000000"
    const afterSha = after !== null ? blobSha7(after) : "0000000"
    parts.push(renderFileDiff(path, before, after, beforeSha, afterSha).join("\n"))
  }
  if (parts.length === 0) return ""
  return parts.join("\n") + "\n"
}
