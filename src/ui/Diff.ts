import type { RunInWorktree } from "./Beat.js"
import { resolveWithinRoot } from "./SafePath.js"
import { singleQuoted } from "./Shell.js"

/** One `@@ -a,b +c,d @@` hunk: `newStart`/`newLines` are the post-image range this hunk's `lines` cover — line numbers are 1-based, matching the pointer format T3 parses this for. `header` is the raw `@@ ... @@` text, kept verbatim for rendering, even once `lines` has been sliced down to a narrower window than the header's own numbers describe. */
export interface DiffHunk {
  readonly header: string
  readonly newStart: number
  readonly newLines: number
  readonly lines: readonly string[]
  /**
   * Per-`lines`-index: `true` when that line sits in the three-line pad
   * `sliceHunk` widened to rather than inside the pointed `[start, end]`
   * range itself — `undefined` (never a same-length all-`false` array) for a
   * hunk that was never sliced to a range (the whole-file fallback), so a
   * client can tell "nothing is dimmed because there's no range" apart from
   * "sliced, and this line happens to be in range" without a third state on
   * each entry. Computed once here, in the same walk that decides which
   * lines survive slicing, so a client never re-derives the post-image line
   * number to answer the same question — see `Hunk.tsx#DiffRow`.
   */
  readonly dimmed?: readonly boolean[]
}

/** One path's full parsed diff — `hunks` empty (never absent) for a diff with no changes at all. */
export interface FileDiff {
  readonly path: string
  readonly hunks: readonly DiffHunk[]
}

/**
 * T3's five-way result: a `hunk` match (one or more hunks, collected — a
 * range can legitimately span more than one git hunk), a `whole-file`
 * fallback (with the reason a pointer failed to resolve, so the client can
 * render its banner), a `binary` placeholder, `no-changes` when the
 * pointed-at path has NOTHING in the range at all (a stale/renamed/moved
 * pointer — never an uncommitted-only edit, which resolving against the
 * WORKING TREE now surfaces as a real `hunk` instead) — never
 * `whole-file` with an empty `diff.hunks`, which would paint T3's own banner
 * over a blank body, exactly the "empty screen" the spec forbids — or a
 * `refused` when `gtd base` itself couldn't name a review base. Never an
 * empty/undefined result for any of these — the package spec's explicit
 * "never an empty screen" acceptance bullet.
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

/** `true` for the four prefixes a hunk BODY line can start with — `+`/`-`/` ` (added/removed/context) plus `\` (the rare "no newline at end of file" marker, see `Highlight.ts#lineKind`'s own `marker` kind). Pulled out so `parseUnifiedDiff`'s own loop reads as one condition per line kind, not a four-way `||` inline. */
const isHunkBodyLine = (line: string): boolean =>
  line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line.startsWith("\\")

type OpenHunk = { header: string; newStart: number; newLines: number; lines: string[] }

/** Parses one `@@ -a,b +c,d @@` header line into a fresh, empty `OpenHunk` — `undefined` when `line` isn't a hunk header at all. Pulled out of `parseUnifiedDiff`'s own loop so that function's own job reads as "dispatch on what kind of line this is", not also the header's own regex-group arithmetic. */
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
 * Parses `git diff`'s unified output for a SINGLE path into hunks. Only lines
 * inside a hunk body are kept (`+`/`-`/` ` prefixed, plus the rare `\ No
 * newline at end of file` marker) — the `diff --git`/`index`/`---`/`+++`
 * preamble carries no post-image line numbers and is dropped.
 *
 * A `diff --git ` line (the ONLY preamble line that can never be confused
 * with real hunk content — unlike `--- a/x`/`+++ b/x`, which are
 * indistinguishable from a `-`/`+`-prefixed diff LINE by prefix alone) always
 * ends whatever hunk is currently open, even before the next `@@` header: a
 * pointer that resolves to more than one file (a stale pointer naming a
 * directory, or a path git's own pathspec matches loosely) emits MULTIPLE
 * `diff --git` sections back to back, and without this, the second file's
 * own `---`/`+++` preamble would otherwise get appended into the FIRST
 * file's last hunk as fake `+`/`-` content.
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
 * `true` when a hunk with `newLines === 0` (a pure deletion — nothing
 * survives into the post-image) has an EMPTY post-image range and overlaps
 * no range at all, ever — never `line === hunk.newStart` as an earlier
 * version of this function claimed. `newStart` for such a hunk names the
 * insertion POINT (git's own convention for "nothing survives here"), not a
 * real post-image line a pointer could legitimately point AT: verified
 * against real git, a mid-file deletion emits `@@ -5,2 +4,0 @@`, and
 * post-image line 4 is an UNTOUCHED line that sits BEFORE the deletion, not
 * part of it — treating it as a match would silently select a hunk whose
 * range doesn't actually contain the pointed-at range, where T3 mandates the
 * whole-file fallback.
 *
 * An INVERTED range (`end < start`, e.g. a hand-written pointer with its two
 * numbers transposed) also overlaps nothing, ever — never true by the raw
 * `newStart <= end && hunkEnd >= start` test below, which a wide enough hunk
 * satisfies for any two numbers regardless of order. Without this, an
 * inverted range lands on `kind: "hunk"` with a hunk whose `sliceHunk`
 * window (`[start - 3, end + 3]`) is itself inverted and yields ZERO lines —
 * exactly the empty screen T3 forbids, just wearing a non-empty `kind`.
 */
const hunkOverlapsRange = (hunk: DiffHunk, start: number, end: number): boolean => {
  if (hunk.newLines === 0) return false
  if (end < start) return false
  const hunkEnd = hunk.newStart + hunk.newLines - 1
  return hunk.newStart <= end && hunkEnd >= start
}

/** Collects EVERY hunk whose post-image range `[newStart, newStart + newLines - 1]` overlaps `[start, end]`, in document order — never picks just one: a range can legitimately span two adjacent git hunks, or start inside one hunk and end in untouched context below it. A `newLines === 0` (pure-deletion) hunk overlaps no range, ever. */
export const selectHunks = (diff: FileDiff, start: number, end: number): readonly DiffHunk[] =>
  diff.hunks.filter((hunk) => hunkOverlapsRange(hunk, start, end))

/**
 * Slices one hunk's body down to `[start - 3, end + 3]` in post-image
 * coordinates, clamped to the hunk's own `[newStart, newStart + newLines -
 * 1]` — never negative, never past the hunk's own last line. Walks the body
 * tracking the post-image line number: `+`/` ` lines advance the counter
 * (they survive into the post-image), `-` lines and the `\ No newline`
 * marker do not. A kept line is either an in-window `+`/` ` line, at the
 * post-image number it advances TO, or an in-window `-`/marker line, at the
 * post-image number it sits BEFORE (the number it does not advance past) —
 * dropping the latter would make a deletion vanish from the review screen
 * entirely. Context lines come from the diff body only, never read from the
 * file on disk, which sits in a different coordinate space and would splice
 * unrelated text into the middle of a hunk. `header` is returned verbatim,
 * even though its own `@@` numbers now describe a wider range than the
 * sliced lines — the header names the git hunk this slice came from.
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
      // `-` line or the `\ No newline at end of file` marker: neither
      // advances the counter, so its position is the number it sits
      // BEFORE — the next `+`/` ` line's own number, or the hunk's end
      // when nothing follows. A run of trailing `-` lines has already run
      // `postImageLine` past `hunkEnd` (one past the last advancing line),
      // so it's clamped back to `hunkEnd` here — without this, a deletion
      // at the very end of a hunk always sits one past the window's own
      // clamp and silently vanishes from every range, including one
      // spanning the whole hunk.
      const position = Math.min(postImageLine, hunkEnd)
      if (position >= lo && position <= hi) {
        lines.push(line)
        dimmed.push(position < start || position > end)
      }
    }
  }

  return { header: hunk.header, newStart: hunk.newStart, newLines: hunk.newLines, lines, dimmed }
}

/** `git diff`'s own binary-file line, anchored to a LINE START (`^`/`$` with the multiline flag) — never a bare substring search, which would also match a TEXT diff whose own added/removed content happens to contain this exact sentence (every real diff line is `+`/`-`/` `/`\`-prefixed, so the anchored form can never match one). */
const BINARY_LINE_RE = /^Binary files .+ differ$/m

/** Dependencies `resolveDiff` needs, injected so tests never spawn real git/gtd — mirrors `Beat.ts`'s `BeatDeps`/`Write.ts`'s `WriteDeps` split of a pure function over injected deps plus a `live*` implementation. */
export interface DiffDeps {
  readonly run: RunInWorktree
}

/**
 * Resolves a review hunk pointer: runs `gtd base` to find the review anchor,
 * diffs it against the WORKING TREE — never `HEAD` — for exactly one path
 * (shell-quoted, with `--` so a path containing `#` or leading `-` is never
 * misread as an option), collects every hunk the `[line, endLine]` range
 * overlaps, and slices each to the widened window. Falls back to the
 * whole-file diff whenever the range doesn't land on any hunk — never an
 * empty result.
 *
 * `base` against the WORKING TREE, not `base..HEAD`: the review prompt tells
 * the agent the range runs from the review base to the working tree, and
 * that is the coordinate space this resolver must match — `base..HEAD`
 * would silently drift out of step the moment anything is uncommitted on top
 * of `HEAD` (a stray save, or husky → lint-staged's own `oxfmt --write`
 * reformatting staged files during the very step commit that captures the
 * review), shifting post-image line numbers under a pointer with no banner
 * to say so. The accepted cost runs the other way now: an uncommitted edit
 * made AFTER the review was written can still shift the screen with no
 * banner, but that is the narrower window of the two, since the agent and
 * the reviewer both read the working tree.
 */
export const resolveDiff = async (
  worktreePath: string,
  path: string,
  line: number | undefined,
  endLine: number | undefined,
  deps: DiffDeps,
): Promise<DiffResult> => {
  // `path` is a client string like `filePath` on `writeNote`/`readSteeringFile`
  // — git itself would likely refuse a pathspec that walks outside the
  // worktree too, but this refuses at the SAME boundary those two do,
  // before a single subprocess runs, rather than leaning on git's own
  // pathspec resolution as the only defense.
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
    `git diff ${singleQuoted(base)} -- ${singleQuoted(path)}`,
  )
  if (diffOutcome.status !== 0) {
    return {
      kind: "refused",
      detail: diffOutcome.spawnError ?? (diffOutcome.stderr.trim() || "git diff refused"),
    }
  }

  const diff = parseUnifiedDiff(path, diffOutcome.stdout)

  // Corroborated with "no hunk headers parsed": a real binary-file diff has
  // no `@@` hunks at all, so this can never misfire on a text file whose
  // diff both contains the sentence AND has real hunks of its own.
  if (diff.hunks.length === 0 && BINARY_LINE_RE.test(diffOutcome.stdout)) {
    return { kind: "binary" }
  }

  // A path with NOTHING in the range at all (a stale/renamed/moved pointer,
  // or a path with no diff against the working tree) is its own stated
  // result, never `whole-file`: `whole-file` promises "the screen shows
  // that path's whole diff behind a banner" (T3), and there is no whole
  // diff to show here — painting that banner over an empty body would be
  // exactly the "empty screen" the spec forbids, just with an extra banner
  // glued on top.
  if (diff.hunks.length === 0) {
    return { kind: "no-changes" }
  }

  // A bare pointer with no line at all, or with a line but no range (T3's
  // "a pointer with `line` but no `endLine`"), gets the SAME `"no-line"`
  // whole-file fallback: a range is the contract this resolver slices to,
  // and a pointer that names no range — or only half of one — has nothing
  // for `selectHunks` to slice against.
  if (line === undefined || line === 0 || endLine === undefined) {
    return { kind: "whole-file", diff, reason: "no-line" }
  }

  const hunks = selectHunks(diff, line, endLine)
  if (hunks.length === 0) {
    return { kind: "whole-file", diff, reason: "no-hunk-match" }
  }

  return { kind: "hunk", diff, hunks: hunks.map((hunk) => sliceHunk(hunk, line, endLine)) }
}
