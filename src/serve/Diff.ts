import type { RunInWorktree } from "./Beat.js"

/** One `@@ -a,b +c,d @@` hunk: `newStart`/`newLines` are the post-image range this hunk's `lines` cover — line numbers are 1-based, matching the pointer format T3 parses this for. `header` is the raw `@@ ... @@` text, kept verbatim for rendering. */
export interface DiffHunk {
  readonly header: string
  readonly newStart: number
  readonly newLines: number
  readonly lines: readonly string[]
}

/** One path's full parsed diff — `hunks` empty (never absent) for a diff with no changes at all. */
export interface FileDiff {
  readonly path: string
  readonly hunks: readonly DiffHunk[]
}

/**
 * T3's four-way result: a `hunk` match, a `whole-file` fallback (with the
 * reason a pointer failed to resolve, so the client can render its banner), a
 * `binary` placeholder, or a `refused` when `gtd base` itself couldn't name a
 * review base. Never an empty/undefined result for any of these — the
 * package spec's explicit "never an empty screen" acceptance bullet.
 */
export type DiffResult =
  | { readonly kind: "hunk"; readonly diff: FileDiff; readonly hunk: DiffHunk }
  | {
      readonly kind: "whole-file"
      readonly diff: FileDiff
      readonly reason: "no-line" | "no-hunk-match"
    }
  | { readonly kind: "binary" }
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

/** A hunk with `newLines === 0` (a pure deletion) still occupies exactly the line right before `newStart` in the post-image, mirroring `git`'s own convention of naming the insertion POINT as `newStart` when nothing survives. Selection treats that single point as the hunk's whole range. */
const hunkContainsLine = (hunk: DiffHunk, line: number): boolean => {
  if (hunk.newLines === 0) return line === hunk.newStart
  return line >= hunk.newStart && line <= hunk.newStart + hunk.newLines - 1
}

/** Selects the hunk whose post-image range contains `line` — `undefined` for no line, or a line that falls in context between hunks (stale pointer, moved line), never a nearest-match guess. */
export const selectHunk = (diff: FileDiff, line: number | undefined): DiffHunk | undefined => {
  if (line === undefined) return undefined
  return diff.hunks.find((hunk) => hunkContainsLine(hunk, line))
}

/** `git diff`'s own binary-file line, anchored to a LINE START (`^`/`$` with the multiline flag) — never a bare substring search, which would also match a TEXT diff whose own added/removed content happens to contain this exact sentence (every real diff line is `+`/`-`/` `/`\`-prefixed, so the anchored form can never match one). */
const BINARY_LINE_RE = /^Binary files .+ differ$/m

/** Dependencies `resolveDiff` needs, injected so tests never spawn real git/gtd — mirrors `Beat.ts`'s `BeatDeps`/`Write.ts`'s `WriteDeps` split of a pure function over injected deps plus a `live*` implementation. */
export interface DiffDeps {
  readonly run: RunInWorktree
}

/**
 * Resolves a review hunk pointer: runs `gtd base` to find the review anchor,
 * diffs it against `HEAD` — never the working tree — for exactly one path
 * (shell-quoted, with `--` so a path containing `#` or leading `-` is never
 * misread as an option), and selects the pointed-at hunk. Falls back to the
 * whole-file diff whenever the pointer doesn't land on a hunk — never an
 * empty result.
 *
 * `base..HEAD`, not `base..working-tree`: a review doc's pointers are
 * 1-based against the post-image AS COMMITTED at `HEAD` (that's the only
 * post-image a human reviewing the round actually agreed to), so if this
 * diffed the working tree instead, any uncommitted edit sitting on top —
 * a stray save, `oxfmt --write` mid-round — would shift post-image line
 * numbers and make a pointer silently select the WRONG hunk while still
 * returning `kind: "hunk"`, with no banner to say so.
 */
export const resolveDiff = async (
  worktreePath: string,
  path: string,
  line: number | undefined,
  deps: DiffDeps,
): Promise<DiffResult> => {
  const baseOutcome = await deps.run(worktreePath, "gtd base")
  if (baseOutcome.status !== 0) {
    return {
      kind: "refused",
      detail: baseOutcome.spawnError ?? (baseOutcome.stderr.trim() || "gtd base refused"),
    }
  }
  const base = baseOutcome.stdout.trim()

  const quotedPath = `'${path.replace(/'/g, "'\\''")}'`
  const diffOutcome = await deps.run(worktreePath, `git diff ${base} HEAD -- ${quotedPath}`)
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

  // `line === 0` means the SAME thing as `line === undefined` here: a bare
  // `./path` pointer with no `#N` suffix parses to line 0 (T3's own "a bare
  // path with no number means line 0"), and 0 is never a valid 1-based
  // post-image line — `selectHunk`/`hunkContainsLine` would otherwise treat
  // it as landing on a pure-deletion hunk's own `newStart` when that hunk's
  // `newStart` (by construction) is 0, selecting a hunk where the spec
  // mandates the whole-file fallback.
  if (line === undefined || line === 0) {
    return { kind: "whole-file", diff, reason: "no-line" }
  }

  const hunk = selectHunk(diff, line)
  if (hunk === undefined) {
    return { kind: "whole-file", diff, reason: "no-hunk-match" }
  }

  return { kind: "hunk", diff, hunk }
}
