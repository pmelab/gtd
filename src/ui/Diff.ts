import type { RunInWorktree } from "./Beat.js"
import { resolveWithinRoot } from "./SafePath.js"
import { shellQuote } from "../GitScript.js"

/** One `@@ -a,b +c,d @@` hunk. `newStart`/`newLines` are the 1-based post-image range `lines` cover; `header` stays verbatim even once `lines` has been sliced narrower than it describes. */
export interface DiffHunk {
  readonly header: string
  readonly newStart: number
  readonly newLines: number
  readonly lines: readonly string[]
  /**
   * Per-`lines`-index: `true` for a line in `sliceHunk`'s three-line pad
   * rather than the pointed range. `undefined` — never an all-`false` array —
   * for an unsliced hunk, so a client can tell "no range" from "in range"
   * without a third per-entry state.
   */
  readonly dimmed?: readonly boolean[]
}

/** One path's full parsed diff — `hunks` empty (never absent) for a diff with no changes at all. */
export interface FileDiff {
  readonly path: string
  readonly hunks: readonly DiffHunk[]
}

/**
 * Five ways a pointer resolves. `whole-file` is never returned with empty
 * `diff.hunks` — that paints a banner over a blank body, the "empty screen"
 * the spec forbids; `no-changes` is its own kind for exactly that case.
 */
export type DiffResult =
  | { readonly kind: "hunk"; readonly diff: FileDiff; readonly hunks: readonly DiffHunk[] }
  | {
      readonly kind: "whole-file"
      readonly diff: FileDiff
      readonly reason: "no-line" | "no-hunk-match"
    }
  | { readonly kind: "binary" }
  | { readonly kind: "no-changes" }
  | { readonly kind: "refused"; readonly detail: string }

/** The `@@ -oldStart[,oldLines] +newStart[,newLines] @@` hunk header — `oldLines`/`newLines` default to 1 when omitted, matching unified-diff's own convention for a one-line range. */
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

/** The four prefixes a hunk BODY line can start with — `+`/`-`/` ` plus `\`, the rare "no newline at end of file" marker. */
const isHunkBodyLine = (line: string): boolean =>
  line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line.startsWith("\\")

type OpenHunk = { header: string; newStart: number; newLines: number; lines: string[] }

/** Parses a `@@ -a,b +c,d @@` header into a fresh, empty `OpenHunk`; `undefined` when `line` isn't one. */
const openHunkFrom = (line: string): OpenHunk | undefined => {
  const match = HUNK_HEADER.exec(line)
  if (match === null) return undefined
  return {
    header: line,
    newStart: Number(match[1]),
    newLines: match[2] !== undefined ? Number(match[2]) : 1,
    lines: [],
  }
}

/**
 * Parses `git diff`'s unified output for a SINGLE path into hunks; the
 * preamble carries no post-image line numbers and is dropped.
 *
 * `diff --git ` closes the open hunk even before the next `@@`. It is the one
 * preamble line that can never be confused with hunk content (`--- a/x`/
 * `+++ b/x` are indistinguishable from real `-`/`+` lines by prefix), and a
 * pathspec matching more than one file emits several sections back to back —
 * without this the second file's preamble lands in the first file's last hunk.
 */
export const parseUnifiedDiff = (path: string, text: string): FileDiff => {
  const hunks: DiffHunk[] = []
  let current: OpenHunk | undefined
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current !== undefined) hunks.push(current)
      current = undefined
      continue
    }
    const opened = openHunkFrom(line)
    if (opened !== undefined) {
      if (current !== undefined) hunks.push(current)
      current = opened
      continue
    }
    if (current !== undefined && isHunkBodyLine(line)) {
      current.lines.push(line)
    }
  }
  if (current !== undefined) hunks.push(current)
  return { path, hunks }
}

/**
 * Two cases overlap nothing, ever, and both are guarded before the range test.
 *
 * `newLines === 0` is a pure deletion: `newStart` names the insertion POINT,
 * not a post-image line. Verified against real git, a mid-file deletion emits
 * `@@ -5,2 +4,0 @@`, and line 4 is an untouched line BEFORE the deletion.
 *
 * An INVERTED range (`end < start`, a transposed hand-written pointer) would
 * satisfy `newStart <= end && hunkEnd >= start` for a wide enough hunk, then
 * slice to an inverted window and yield zero lines — an empty screen wearing
 * a non-empty `kind`.
 */
const hunkOverlapsRange = (hunk: DiffHunk, start: number, end: number): boolean => {
  if (hunk.newLines === 0) return false
  if (end < start) return false
  const hunkEnd = hunk.newStart + hunk.newLines - 1
  return hunk.newStart <= end && hunkEnd >= start
}

/** EVERY overlapping hunk, in document order — never just one: a range can span two adjacent git hunks, or start in one and end in untouched context below it. */
export const selectHunks = (diff: FileDiff, start: number, end: number): readonly DiffHunk[] =>
  diff.hunks.filter((hunk) => hunkOverlapsRange(hunk, start, end))

/**
 * Slices a hunk body to `[start - 3, end + 3]`, clamped to the hunk's own
 * post-image range. `+`/` ` lines advance the counter; `-` and the `\ No
 * newline` marker do not, and are kept at the number they sit BEFORE —
 * dropping them would make a deletion vanish from the review screen. Context
 * comes from the diff body only, never the file on disk, which sits in a
 * different coordinate space.
 */
export const sliceHunk = (hunk: DiffHunk, start: number, end: number): DiffHunk => {
  const hunkEnd = hunk.newStart + hunk.newLines - 1
  const lo = Math.max(hunk.newStart, start - 3)
  const hi = Math.min(hunkEnd, end + 3)

  const lines: string[] = []
  const dimmed: boolean[] = []
  let postImageLine = hunk.newStart
  for (const line of hunk.lines) {
    const advances = line.startsWith("+") || line.startsWith(" ")
    if (advances) {
      if (postImageLine >= lo && postImageLine <= hi) {
        lines.push(line)
        dimmed.push(postImageLine < start || postImageLine > end)
      }
      postImageLine++
    } else {
      // A trailing run of `-` lines has already run `postImageLine` one past
      // `hunkEnd`, so it is clamped back — without this a deletion at the very
      // end of a hunk sits past every window's clamp and silently vanishes.
      const position = Math.min(postImageLine, hunkEnd)
      if (position >= lo && position <= hi) {
        lines.push(line)
        dimmed.push(position < start || position > end)
      }
    }
  }

  return { header: hunk.header, newStart: hunk.newStart, newLines: hunk.newLines, lines, dimmed }
}

/** `git diff`'s binary-file line, anchored to a line start — a bare substring search would also match a TEXT diff whose own content contains this sentence. */
const BINARY_LINE_RE = /^Binary files .+ differ$/m

/** Dependencies `resolveDiff` needs, injected so tests never spawn real git/gtd. */
export interface DiffDeps {
  readonly run: RunInWorktree
}

/**
 * Resolves a review hunk pointer against `gtd base`, falling back to the
 * whole-file diff when the range lands on no hunk — never an empty result.
 *
 * The diff runs base-against-WORKING-TREE, never `base..HEAD`: the review
 * prompt puts the range in working-tree coordinates, and `base..HEAD` drifts
 * the moment anything is uncommitted on top of HEAD (a stray save, or
 * lint-staged's `oxfmt --write` during the very step commit that captures the
 * review), shifting line numbers under a pointer with no banner. The accepted
 * cost is the narrower window: an edit made AFTER the review was written can
 * still shift the screen silently.
 */
export const resolveDiff = async (
  worktreePath: string,
  path: string,
  line: number | undefined,
  endLine: number | undefined,
  deps: DiffDeps,
): Promise<DiffResult> => {
  // `path` is a client string: refused at the SAME boundary `writeNote`/
  // `readSteeringFile` refuse at, before any subprocess runs, rather than
  // leaning on git's own pathspec resolution as the only defense.
  if (resolveWithinRoot(worktreePath, path) === undefined) {
    return { kind: "refused", detail: "path escapes the served worktree" }
  }

  const baseOutcome = await deps.run(worktreePath, "gtd base")
  if (baseOutcome.status !== 0) {
    return {
      kind: "refused",
      detail: baseOutcome.spawnError ?? (baseOutcome.stderr.trim() || "gtd base refused"),
    }
  }
  const base = baseOutcome.stdout.trim()

  const diffOutcome = await deps.run(
    worktreePath,
    `git diff ${shellQuote(base)} -- ${shellQuote(path)}`,
  )
  if (diffOutcome.status !== 0) {
    return {
      kind: "refused",
      detail: diffOutcome.spawnError ?? (diffOutcome.stderr.trim() || "git diff refused"),
    }
  }

  const diff = parseUnifiedDiff(path, diffOutcome.stdout)

  // Corroborated with "no hunk headers parsed", so this can never misfire on
  // a text file whose diff both contains the sentence and has real hunks.
  if (diff.hunks.length === 0 && BINARY_LINE_RE.test(diffOutcome.stdout)) {
    return { kind: "binary" }
  }

  // Its own kind, never `whole-file`: there is no whole diff to show behind
  // that banner, and a banner over an empty body is the forbidden empty screen.
  if (diff.hunks.length === 0) {
    return { kind: "no-changes" }
  }

  // No line, or a line with no `endLine`: half a range is nothing for
  // `selectHunks` to slice against, so both take the same fallback.
  if (line === undefined || line === 0 || endLine === undefined) {
    return { kind: "whole-file", diff, reason: "no-line" }
  }

  const hunks = selectHunks(diff, line, endLine)
  if (hunks.length === 0) {
    return { kind: "whole-file", diff, reason: "no-hunk-match" }
  }

  return { kind: "hunk", diff, hunks: hunks.map((hunk) => sliceHunk(hunk, line, endLine)) }
}
