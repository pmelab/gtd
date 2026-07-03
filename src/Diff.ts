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

/**
 * Render git-format unified diff hunks for a before→after content pair.
 * Uses 3 context lines (git default). Returns the hunk lines without a final newline.
 */
function renderHunks(before: string, after: string): ReadonlyArray<string> {
  const context = 3

  // Build a flat list of diff operations
  const chunks = diffLines(before, after)

  // Convert chunks into a line-by-line annotated list
  interface Line {
    type: "context" | "removed" | "added"
    text: string
    noNewline: boolean
  }
  const allLines: Line[] = []

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci]!
    const { lines, noNewline } = splitLines(chunk.value)
    const isLast = ci === chunks.length - 1

    for (let li = 0; li < lines.length; li++) {
      const isLastLine = isLast && li === lines.length - 1
      const line: Line = {
        type: chunk.added ? "added" : chunk.removed ? "removed" : "context",
        text: lines[li]!,
        noNewline: isLastLine && noNewline,
      }
      allLines.push(line)
    }
  }

  if (allLines.length === 0) return []

  // Find which lines are changed (removed or added)
  const changedIndices = new Set<number>()
  for (let i = 0; i < allLines.length; i++) {
    if (allLines[i]!.type !== "context") changedIndices.add(i)
  }

  if (changedIndices.size === 0) return []

  // Determine hunk ranges: groups of changed lines with context
  const hunkRanges: Array<{ start: number; end: number }> = []
  let currentRange: { start: number; end: number } | null = null

  for (const idx of [...changedIndices].sort((a, b) => a - b)) {
    const start = Math.max(0, idx - context)
    const end = Math.min(allLines.length - 1, idx + context)

    if (currentRange === null) {
      currentRange = { start, end }
    } else if (start <= currentRange.end + 1) {
      // Overlapping or adjacent — extend
      currentRange.end = Math.max(currentRange.end, end)
    } else {
      hunkRanges.push(currentRange)
      currentRange = { start, end }
    }
  }
  if (currentRange !== null) hunkRanges.push(currentRange)

  // For each hunk range, compute old/new line numbers and render
  // We need to map allLines indices back to old/new line numbers.
  // allLines contains both removed and added lines interleaved.
  // Old line numbers count context + removed lines; new line numbers count context + added lines.
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
      newLineOf.push(-1) // no new line
    } else {
      // added
      oldLineOf.push(-1) // no old line
      newLineOf.push(newLineNum++)
    }
  }

  const outputLines: string[] = []

  for (const { start, end } of hunkRanges) {
    // Count old and new lines in this range
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

    outputLines.push(`@@ -${hunkPos(oldStart, oldCount)} +${hunkPos(newStart, newCount)} @@`)

    for (let i = start; i <= end; i++) {
      const line = allLines[i]!
      const prefix = line.type === "context" ? " " : line.type === "removed" ? "-" : "+"
      outputLines.push(`${prefix}${line.text}`)
      if (line.noNewline) {
        outputLines.push("\\ No newline at end of file")
      }
    }
  }

  return outputLines
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
    if (before === after) continue // no change (both null, or identical content)

    const beforeSha = before !== null ? blobSha7(before) : "0000000"
    const afterSha = after !== null ? blobSha7(after) : "0000000"

    const lines: string[] = []
    lines.push(`diff --git a/${path} b/${path}`)

    const binary = (before !== null && isBinary(before)) || (after !== null && isBinary(after))

    if (before === null) {
      // New file
      lines.push("new file mode 100644")
      lines.push(`index ${beforeSha}..${afterSha}`)
      if (binary) {
        lines.push(`Binary files /dev/null and b/${path} differ`)
      } else {
        lines.push("--- /dev/null")
        lines.push(`+++ b/${path}`)
        const hunks = renderHunks("", after!)
        lines.push(...hunks)
      }
    } else if (after === null) {
      // Deleted file
      lines.push("deleted file mode 100644")
      lines.push(`index ${beforeSha}..${afterSha}`)
      if (binary) {
        lines.push(`Binary files a/${path} and /dev/null differ`)
      } else {
        lines.push(`--- a/${path}`)
        lines.push("+++ /dev/null")
        const hunks = renderHunks(before, "")
        lines.push(...hunks)
      }
    } else {
      // Modification
      lines.push(`index ${beforeSha}..${afterSha} 100644`)
      if (binary) {
        lines.push(`Binary files a/${path} and b/${path} differ`)
      } else {
        lines.push(`--- a/${path}`)
        lines.push(`+++ b/${path}`)
        const hunks = renderHunks(before, after)
        lines.push(...hunks)
      }
    }

    parts.push(lines.join("\n"))
  }

  if (parts.length === 0) return ""
  return parts.join("\n") + "\n"
}
