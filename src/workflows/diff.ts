import type { Change } from "../flows/index.js"

// Pure evidence rendering for `packages.item.spec.pre`: no step, no tree
// access. Everything here works from the `Change` list a flow already holds.

const CONTEXT = 3
const TOO_LARGE_LINES = 1500

// ── The fixed exclusion list — no configuration key ─────────────────────────

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "composer.lock",
  "Gemfile.lock",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "go.sum",
  "flake.lock",
  "mix.lock",
  "pubspec.lock",
  "Podfile.lock",
  "gradle.lockfile",
])

const GENERATED_GLOBS = [
  "dist/**",
  "build/**",
  "out/**",
  "coverage/**",
  "node_modules/**",
  "vendor/**",
  ".turbo/**",
  "**/__snapshots__/**",
  "**/*.snap",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
]

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "pdf",
  "zip",
  "gz",
  "tar",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "mp4",
  "wasm",
  "bin",
  "exe",
  "so",
  "dylib",
])

// A small, self-contained glob match — `*` stays within a segment, `**`
// crosses them — kept local rather than reached through another boundary for
// eighteen fixed patterns.
const globCache = new Map<string, RegExp>()
const compileGlob = (glob: string): RegExp => {
  let pattern = "^"
  let i = 0
  while (i < glob.length) {
    const char = glob[i]!
    if (char !== "*") {
      pattern += char.replace(/[.+^${}()|[\]\\?]/g, "\\$&")
      i += 1
    } else if (glob[i + 1] !== "*") {
      pattern += "[^/]*"
      i += 1
    } else if (glob[i + 2] === "/") {
      pattern += "(?:.*/)?"
      i += 3
    } else {
      pattern += ".*"
      i += 2
    }
  }
  return new RegExp(`${pattern}$`)
}
const matchesGlob = (path: string, glob: string): boolean => {
  let regex = globCache.get(glob)
  if (regex === undefined) {
    regex = compileGlob(glob)
    globCache.set(glob, regex)
  }
  return regex.test(path)
}

const extensionOf = (path: string): string => {
  const base = path.split("/").pop() ?? path
  const dot = base.lastIndexOf(".")
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase()
}

const isBinary = (change: Change): boolean =>
  BINARY_EXTENSIONS.has(extensionOf(change.path)) ||
  (change.before?.includes("\0") ?? false) ||
  (change.after?.includes("\0") ?? false)

const isExcluded = (change: Change): boolean =>
  change.path === ".gtd" ||
  change.path.startsWith(".gtd/") ||
  LOCKFILES.has(change.path.split("/").pop() ?? change.path) ||
  GENERATED_GLOBS.some((glob) => matchesGlob(change.path, glob)) ||
  isBinary(change)

/** `changes` with lockfiles, generated trees and binaries dropped. */
export const filterChanges = (changes: readonly Change[]): readonly Change[] =>
  changes.filter((change) => !isExcluded(change))

// ── Line diff ────────────────────────────────────────────────────────────

interface Op {
  readonly type: "eq" | "add" | "del"
  readonly line: string
}

const linesOf = (content: string | undefined): readonly string[] => {
  if (content === undefined || content === "") return []
  const lines = content.split("\n")
  if (lines[lines.length - 1] === "") lines.pop()
  return lines
}

/** `dp[i][j]` = the LCS length of `a[i:]` and `b[j:]`. */
const lcsTable = (a: readonly string[], b: readonly string[]): number[][] => {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from<number>({ length: m + 1 }).fill(0),
  )
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  return dp
}

/** Walk an LCS table into an edit script, favoring a deletion on a tie. */
const backtrack = (a: readonly string[], b: readonly string[], dp: number[][]): Op[] => {
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: "eq", line: a[i]! })
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: "del", line: a[i]! })
      i++
    } else {
      ops.push({ type: "add", line: b[j]! })
      j++
    }
  }
  while (i < a.length) ops.push({ type: "del", line: a[i++]! })
  while (j < b.length) ops.push({ type: "add", line: b[j++]! })
  return ops
}

/** Longest-common-subsequence edit script between two (already trimmed) line arrays. */
const lcsOps = (a: readonly string[], b: readonly string[]): Op[] => backtrack(a, b, lcsTable(a, b))

const commonAffixes = (
  before: readonly string[],
  after: readonly string[],
): { readonly prefix: number; readonly suffix: number } => {
  const maxPrefix = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix++
  const maxSuffix = maxPrefix - prefix
  let suffix = 0
  while (
    suffix < maxSuffix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++
  return { prefix, suffix }
}

interface Hunk {
  readonly beforeStart: number
  readonly beforeCount: number
  readonly afterStart: number
  readonly afterCount: number
  readonly lines: readonly string[]
}

const buildHunks = (ops: readonly Op[]): readonly Hunk[] => {
  const beforeLineAt: number[] = []
  const afterLineAt: number[] = []
  let bl = 1
  let al = 1
  for (const op of ops) {
    beforeLineAt.push(bl)
    afterLineAt.push(al)
    if (op.type !== "add") bl++
    if (op.type !== "del") al++
  }
  const ranges: [number, number][] = []
  ops.forEach((op, idx) => {
    if (op.type === "eq") return
    const start = Math.max(0, idx - CONTEXT)
    const end = Math.min(ops.length - 1, idx + CONTEXT)
    const last = ranges[ranges.length - 1]
    if (last !== undefined && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end)
    } else {
      ranges.push([start, end])
    }
  })
  return ranges.map(([start, end]) => {
    const slice = ops.slice(start, end + 1)
    return {
      beforeStart: beforeLineAt[start]!,
      beforeCount: slice.filter((op) => op.type !== "add").length,
      afterStart: afterLineAt[start]!,
      afterCount: slice.filter((op) => op.type !== "del").length,
      lines: slice.map(
        (op) => `${op.type === "add" ? "+" : op.type === "del" ? "-" : " "}${op.line}`,
      ),
    }
  })
}

const renderHunk = (hunk: Hunk): readonly string[] => [
  `@@ -${hunk.beforeStart},${hunk.beforeCount} +${hunk.afterStart},${hunk.afterCount} @@`,
  ...hunk.lines,
]

/** One file's unified diff, or a summary line when its changed region is too large to inline. */
const renderFileDiff = (change: Change): string => {
  const before = linesOf(change.before)
  const after = linesOf(change.after)
  const { prefix, suffix } = commonAffixes(before, after)
  const beforeMiddle = before.slice(prefix, before.length - suffix)
  const afterMiddle = after.slice(prefix, after.length - suffix)
  if (beforeMiddle.length > TOO_LARGE_LINES || afterMiddle.length > TOO_LARGE_LINES) {
    return `${change.path}: +${afterMiddle.length}/-${beforeMiddle.length} lines, too large to inline`
  }
  const prefixOps: Op[] = before.slice(0, prefix).map((line) => ({ type: "eq", line }))
  const suffixOps: Op[] = before.slice(before.length - suffix).map((line) => ({ type: "eq", line }))
  const ops = [...prefixOps, ...lcsOps(beforeMiddle, afterMiddle), ...suffixOps]
  const beforePath = change.status === "added" ? "/dev/null" : `a/${change.path}`
  const afterPath = change.status === "deleted" ? "/dev/null" : `b/${change.path}`
  return [`--- ${beforePath}`, `+++ ${afterPath}`, ...buildHunks(ops).flatMap(renderHunk)].join(
    "\n",
  )
}

const omissionTrailer = (paths: readonly string[]): string =>
  `${paths.length} file(s) omitted for the judge's byte budget: ${paths.join(", ")}`

interface RenderedFile {
  readonly path: string
  readonly text: string
}

/** The byte size of keeping `files`' first `keepCount` entries plus the trailer the rest would need — the trailer counts against the cap too, not just the kept text. */
const sizeWithTrailer = (files: readonly RenderedFile[], keepCount: number): number => {
  let used = 0
  for (let i = 0; i < keepCount; i++) {
    used += Buffer.byteLength(files[i]!.text, "utf8") + (i > 0 ? 1 : 0)
  }
  const droppedCount = files.length - keepCount
  if (droppedCount === 0) return used
  const trailer = omissionTrailer(files.slice(keepCount).map((f) => f.path))
  return used + (keepCount > 0 ? 1 : 0) + Buffer.byteLength(trailer, "utf8")
}

/**
 * The filtered `changes`, rendered as one unified diff (files in path order)
 * and bounded to `capBytes`: over the cap, whole files are dropped from the
 * end — never bytes off a hunk — and named in a trailer line, so the
 * judge is told what it did not see rather than handed a silently short diff.
 * The trailer itself is sized against the cap along with the files it keeps,
 * so a package with many touched files can never push the total past it.
 */
export const packageDiff = (changes: readonly Change[], capBytes: number): string => {
  const files = filterChanges(changes)
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((change) => ({ path: change.path, text: renderFileDiff(change) }))
  let keepCount = files.length
  while (keepCount > 0 && sizeWithTrailer(files, keepCount) > capBytes) keepCount--
  const dropped = files.slice(keepCount).map((f) => f.path)
  const kept = files.slice(0, keepCount).map((f) => f.text)
  return [...kept, ...(dropped.length > 0 ? [omissionTrailer(dropped)] : [])].join("\n")
}
