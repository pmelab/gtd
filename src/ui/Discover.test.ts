/**
 * Coverage for `discoverWorktrees`/`worktreeId`: a real-filesystem group,
 * since depth limits, `node_modules`/dotted-directory pruning, and symlink
 * behavior are OS-filesystem-shape properties no in-memory fake can stand in
 * for (mirrors `WorktreeState.test.ts`'s "real git" group).
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { discoverWorktrees, worktreeId } from "./Discover.js"

const dirs: string[] = []

const tmpRoot = (): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "gtd-discover-")))
  dirs.push(dir)
  return dir
}

const mkGitDir = (path: string): void => {
  mkdirSync(join(path, ".git"), { recursive: true })
}

const mkGitFile = (path: string, gitdir: string): void => {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, ".git"), `gitdir: ${gitdir}\n`)
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe("discoverWorktrees", () => {
  it("finds a directory with a .git directory", async () => {
    const root = tmpRoot()
    const wt = join(root, "repo")
    mkGitDir(wt)

    const found = await discoverWorktrees([root])
    expect(found.map((w) => w.path)).toEqual([wt])
  })

  it("finds a directory with a .git file holding a gitdir: pointer, even outside every root", async () => {
    const root = tmpRoot()
    const outside = tmpRoot()
    const wt = join(root, "linked-worktree")
    mkGitFile(wt, join(outside, "actual-gitdir"))

    const found = await discoverWorktrees([root])
    expect(found.map((w) => w.path)).toEqual([wt])
  })

  it("finds a match at depth 4 and not one at depth 5", async () => {
    const root = tmpRoot()
    const atFour = join(root, "a", "b", "c", "d")
    const atFive = join(root, "a", "b", "c", "d", "e")
    mkGitDir(atFour)
    mkGitDir(atFive)

    const found = await discoverWorktrees([root])
    expect(found.map((w) => w.path).sort()).toEqual([atFour])
  })

  it("does not descend into node_modules, dotted directories, or symlinked directories", async () => {
    const root = tmpRoot()
    const inNodeModules = join(root, "node_modules", "pkg")
    const inDotted = join(root, ".cache", "pkg")
    mkGitDir(inNodeModules)
    mkGitDir(inDotted)

    const realTarget = tmpRoot()
    const wtInsideSymlinkTarget = join(realTarget, "repo")
    mkGitDir(wtInsideSymlinkTarget)
    symlinkSync(realTarget, join(root, "linked"), "dir")

    const found = await discoverWorktrees([root])
    expect(found).toEqual([])
  })

  it("dedupes two roots that reach the same absolute path", async () => {
    const root = tmpRoot()
    const wt = join(root, "repo")
    mkGitDir(wt)

    const found = await discoverWorktrees([root, root])
    expect(found.map((w) => w.path)).toEqual([wt])
  })

  it("skips a configured root that does not exist, without failing the scan", async () => {
    const root = tmpRoot()
    const wt = join(root, "repo")
    mkGitDir(wt)
    const missing = join(root, "does-not-exist")

    const found = await discoverWorktrees([missing, root])
    expect(found.map((w) => w.path)).toEqual([wt])
  })

  it("re-runs the scan every call rather than caching it", async () => {
    const root = tmpRoot()
    expect(await discoverWorktrees([root])).toEqual([])

    const wt = join(root, "repo")
    mkGitDir(wt)
    expect((await discoverWorktrees([root])).map((w) => w.path)).toEqual([wt])
  })
})

describe("worktreeId", () => {
  it("is stable across runs and differs for two paths differing by one character", () => {
    const a = worktreeId("/repos/one")
    const b = worktreeId("/repos/one")
    const c = worktreeId("/repos/two")
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})
