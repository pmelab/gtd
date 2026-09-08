import { createHash } from "node:crypto"
import { readdir, lstat } from "node:fs/promises"
import { join, resolve } from "node:path"

/** One worktree the scan found: its stable id and its absolute path. */
export interface DiscoveredWorktree {
  readonly id: string
  readonly path: string
}

/** Depth 4 below a configured root — a match at depth 5 is not reported (see `walk`). */
const MAX_DEPTH = 4

/**
 * The worktree's URL identity: the first 12 hex characters of a SHA-256 of
 * its absolute path — stable across runs (pure function of the path), no
 * database or counter needed.
 */
export const worktreeId = (absolutePath: string): string =>
  createHash("sha256").update(absolutePath).digest("hex").slice(0, 12)

/**
 * A directory counts as a worktree the moment it has a `.git` entry, file or
 * directory — `src/WorktreeState.ts`'s `worktreeGitDir` parses that same
 * entry to find the git dir it points at, but always succeeds (it falls back
 * to the literal `.git`), so it can't answer "is there one at all". Presence
 * alone is enough here: T1 only has to FIND the worktree, not resolve where
 * its git dir lives — that resolution happens later, inside the spawned `gtd
 * next --json` itself.
 */
const hasGitEntry = async (dir: string): Promise<boolean> => {
  try {
    await lstat(join(dir, ".git"))
    return true
  } catch {
    return false
  }
}

/**
 * Depth-limited walk of one directory, filesystem-only (no `git`
 * subprocess). `node_modules`, dotted directories, and symlinked
 * directories are never descended into — `readdir`'s `Dirent` reflects the
 * entry itself (not what it resolves to), so a symlinked directory reports
 * `isDirectory() === false` and is skipped without a second syscall.
 */
const walk = async (dir: string, depth: number, found: Map<string, string>): Promise<void> => {
  if (await hasGitEntry(dir)) {
    const absolute = resolve(dir)
    found.set(absolute, absolute)
  }
  if (depth >= MAX_DEPTH) return

  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === "node_modules") continue
    if (entry.name.startsWith(".")) continue
    await walk(join(dir, entry.name), depth + 1, found)
  }
}

/**
 * Scans every configured root to depth 4 for worktrees, deduplicated by
 * absolute path (two roots reaching the same directory yield one entry). A
 * root that does not exist (or isn't readable) is skipped, not a failure —
 * `walk`'s own `readdir` catch already covers it. Rescanned on every call;
 * nothing here is memoized (that's `Beat.ts`'s job, and only for the beat
 * read, never this walk).
 */
export const discoverWorktrees = async (
  roots: readonly string[],
): Promise<DiscoveredWorktree[]> => {
  const found = new Map<string, string>()
  for (const root of roots) {
    await walk(root, 0, found)
  }
  return [...found.keys()].sort().map((path) => ({ id: worktreeId(path), path }))
}
