/**
 * In-memory git snapshot store for integration test fixtures.
 * Pure TypeScript, no Effect, no real filesystem/git.
 * NOT wired into any layer.
 */

import { createHash } from "node:crypto"

interface Commit {
  hash: string // 40-hex
  message: string
  files: Map<string, string> // full tree snapshot (path → UTF-8 content)
  parent: string | null
}

function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex")
}

function makeHash(message: string, parent: string | null, tree: Map<string, string>): string {
  const treeStr = [...tree.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join("\n")
  return sha1(`${message}\n${parent ?? "null"}\n${treeStr}`)
}

export class InMemRepo {
  private commits: Map<string, Commit> = new Map()
  private branches: Map<string, string> = new Map() // branch name → hash
  private refs: Map<string, string> = new Map() // fully qualified ref (refs/gtd/…) → hash
  private head: string | null = null // current commit hash
  private currentBranch: string = "main"
  private worktree: Map<string, string> = new Map()
  private index: Map<string, string> = new Map()

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private getCommit(hash: string): Commit | null {
    return this.commits.get(hash) ?? null
  }

  private headCommit(): Commit | null {
    if (this.head === null) return null
    return this.getCommit(this.head) ?? null
  }

  private headTree(): Map<string, string> {
    return this.headCommit()?.files ?? new Map()
  }

  private ancestorChain(hash: string): string[] {
    const chain: string[] = []
    let cur: string | null = hash
    while (cur !== null) {
      chain.push(cur)
      const c = this.getCommit(cur)
      cur = c?.parent ?? null
    }
    return chain
  }

  // ---------------------------------------------------------------------------
  // Read methods
  // ---------------------------------------------------------------------------

  // fallow-ignore-next-line complexity
  statusPorcelain(): string {
    const headTree = this.headTree()
    const lines: string[] = []

    // All paths that appear in index, worktree, or headTree
    const allPaths = new Set([...headTree.keys(), ...this.index.keys(), ...this.worktree.keys()])

    for (const path of [...allPaths].sort()) {
      const inHead = headTree.has(path)
      const inIndex = this.index.has(path)
      const inWorktree = this.worktree.has(path)
      const headContent = headTree.get(path)
      const indexContent = this.index.get(path)
      const worktreeContent = this.worktree.get(path)

      // Determine index status (X) vs HEAD
      let X = " "
      if (!inHead && inIndex) {
        X = "A" // staged new
      } else if (inHead && !inIndex) {
        X = "D" // staged deletion
      } else if (inHead && inIndex && headContent !== indexContent) {
        X = "M" // staged modification
      }

      // Determine worktree status (Y) vs index
      let Y = " "
      if (inIndex && !inWorktree) {
        Y = "D" // deleted in worktree
      } else if (!inIndex && inWorktree) {
        Y = "?" // untracked (only if not in index)
      } else if (inIndex && inWorktree && indexContent !== worktreeContent) {
        Y = "M" // modified in worktree
      }

      // Untracked files not in index and not in head
      if (!inHead && !inIndex && inWorktree) {
        lines.push(`?? ${path}`)
        continue
      }

      if (X === " " && Y === " ") continue // clean

      lines.push(`${X}${Y} ${path}`)
    }

    return lines.length > 0 ? lines.join("\n") + "\n" : ""
  }

  hasCommits(): boolean {
    return this.head !== null
  }

  // fallow-ignore-next-line complexity
  resolveRef(ref: string): string | null {
    // 40-hex hash passthrough
    if (/^[0-9a-f]{40}$/.test(ref)) {
      return this.commits.has(ref) ? ref : null
    }

    // HEAD~N or <hash>~N notation
    const tildeMatch = /^(HEAD|[0-9a-f]{40})(~(\d+))?$/.exec(ref)
    if (tildeMatch) {
      const base = tildeMatch[1]!
      const steps = tildeMatch[3] !== undefined ? parseInt(tildeMatch[3], 10) : 0
      let cur: string | null = base === "HEAD" ? this.head : this.commits.has(base) ? base : null
      for (let i = 0; i < steps; i++) {
        if (cur === null) return null
        cur = this.getCommit(cur)?.parent ?? null
      }
      return cur
    }

    // Fully qualified repo-local ref (refs/gtd/…)
    const refHash = this.refs.get(ref)
    if (refHash !== undefined) return refHash

    // Branch name
    return this.branches.get(ref) ?? null
  }

  lastCommitSubject(): string | null {
    const c = this.headCommit()
    if (!c) return null
    return c.message.split("\n")[0] ?? null
  }

  commitHistory(base?: string): Array<{
    hash: string
    message: string
    removedErrors: boolean
    touched: ReadonlyArray<string>
  }> {
    if (this.head === null) return []

    // Collect first-parent chain newest→oldest
    const chain: Commit[] = []
    let cur: string | null = this.head
    while (cur !== null) {
      const c = this.getCommit(cur)
      if (!c) break
      chain.push(c)
      cur = c.parent
    }

    // Reverse to oldest→newest
    chain.reverse()

    // Filter to base..HEAD range if base given
    let filtered = chain
    if (base !== undefined) {
      const baseIdx = chain.findIndex((c) => c.hash === base)
      if (baseIdx === -1) {
        // base not in chain — no commits in range
        return []
      }
      filtered = chain.slice(baseIdx + 1)
    }

    return filtered.map((c) => {
      const parentTree = c.parent ? (this.getCommit(c.parent)?.files ?? new Map()) : new Map()
      // Legacy root-level ERRORS.md kept so pre-namespaced history still
      // classifies (mirrors src/Git.ts).
      const removedErrors = [".gtd/ERRORS.md", "ERRORS.md"].some(
        (p) => parentTree.has(p) && !c.files.has(p),
      )
      const touched = diffTrees(parentTree, c.files).map((e) => e.path)
      return { hash: c.hash, message: c.message, removedErrors, touched }
    })
  }

  /** One-line log ("<short-hash> <subject>", newest→oldest) starting from `ref`. */
  logFrom(ref: string): string {
    const hash = this.resolveRef(ref)
    if (!hash) throw new Error(`Cannot resolve ref: ${ref}`)
    return (
      this.ancestorChain(hash)
        .map((h) => `${h.slice(0, 7)} ${this.getCommit(h)?.message.split("\n")[0] ?? ""}`)
        .join("\n") + "\n"
    )
  }

  fileAtRef(ref: string, path: string): string | null {
    const hash = this.resolveRef(ref)
    if (!hash) return null
    const c = this.getCommit(hash)
    if (!c) return null
    return c.files.get(path) ?? null
  }

  changedPathsBetween(refA: string, refB: string): Array<{ path: string; status: string }> {
    const hashA = this.resolveRef(refA)
    const hashB = this.resolveRef(refB)
    const treeA = hashA ? (this.getCommit(hashA)?.files ?? new Map()) : new Map<string, string>()
    const treeB = hashB ? (this.getCommit(hashB)?.files ?? new Map()) : new Map<string, string>()
    return diffTrees(treeA, treeB)
  }

  changedPathsWorktree(): Array<{ path: string; status: string }> {
    const headTree = this.headTree()
    // Worktree vs HEAD: untracked → "A"
    const allPaths = new Set([...headTree.keys(), ...this.worktree.keys()])
    const result: Array<{ path: string; status: string }> = []
    for (const path of allPaths) {
      const inHead = headTree.has(path)
      const inWorktree = this.worktree.has(path)
      if (!inHead && inWorktree) {
        result.push({ path, status: "A" })
      } else if (inHead && !inWorktree) {
        result.push({ path, status: "D" })
      } else if (inHead && inWorktree && headTree.get(path) !== this.worktree.get(path)) {
        result.push({ path, status: "M" })
      }
    }
    return result.sort((a, b) => a.path.localeCompare(b.path))
  }

  // ---------------------------------------------------------------------------
  // Write methods
  // ---------------------------------------------------------------------------

  /** Commit whatever is currently staged (the index) verbatim, with no implicit staging first — mirrors `git commit --allow-empty -m <message>` after a soft reset. */
  commitAsIs(message: string): void {
    const tree = new Map(this.index)
    const parent = this.head
    const hash = makeHash(message, parent, tree)
    const commit: Commit = { hash, message, files: new Map(tree), parent }
    this.commits.set(hash, commit)
    this.head = hash
    this.branches.set(this.currentBranch, hash)
  }

  /** Discard every pending change, tracked or untracked: stage everything, then hard-reset (which now drops the freshly-staged untracked paths too). */
  discardPending(): void {
    this.index = new Map(this.worktree)
    this.resetHard()
  }

  commitAllWithPrefix(prefix: string): void {
    // Stage worktree → index
    this.index = new Map(this.worktree)

    // Build new tree snapshot from index
    const tree = new Map(this.index)
    const message = prefix
    const parent = this.head
    const hash = makeHash(message, parent, tree)

    const commit: Commit = { hash, message, files: new Map(tree), parent }
    this.commits.set(hash, commit)
    this.head = hash
    this.branches.set(this.currentBranch, hash)
  }

  // Git's empty-tree object SHA: used as squash base when there's no parent commit.
  private static readonly EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

  softResetTo(ref: string): void {
    // Special case: git's empty-tree SHA means "reset to before the first commit"
    if (ref === InMemRepo.EMPTY_TREE) {
      this.head = null
      this.branches.delete(this.currentBranch)
      // worktree and index unchanged (soft reset)
      return
    }
    const hash = this.resolveRef(ref)
    if (!hash) throw new Error(`Cannot resolve ref: ${ref}`)
    this.head = hash
    this.branches.set(this.currentBranch, hash)
    // worktree and index unchanged
  }

  /** Internal helper: `discardPending()` uses this after staging the worktree. */
  resetHard(): void {
    const headTree = this.headTree()
    // Snapshot the old index before resetting it (needed to identify staged-new files)
    const oldIndex = new Map(this.index)

    // Reset index to HEAD
    this.index = new Map(headTree)

    // Rebuild worktree:
    // - pure-untracked files (not in HEAD and not in old index) survive
    // - staged-new files (in old index but not in HEAD) are removed
    // - tracked files are restored to HEAD content
    const newWorktree = new Map<string, string>()

    // Keep pure-untracked files: in worktree but not in HEAD and not in old index
    for (const [path, content] of this.worktree) {
      if (!headTree.has(path) && !oldIndex.has(path)) {
        newWorktree.set(path, content)
      }
    }

    // Restore HEAD tree into worktree
    for (const [path, content] of headTree) {
      newWorktree.set(path, content)
    }

    this.worktree = newWorktree
  }

  /** Returns true if any worktree entry equals or starts with `path/`. */
  worktreeHasPath(path: string): boolean {
    const prefix = path.endsWith("/") ? path : `${path}/`
    for (const key of this.worktree.keys()) {
      if (key === path || key.startsWith(prefix)) return true
    }
    return false
  }

  writeFile(path: string, content: string): void {
    this.worktree.set(path, content)
  }

  deleteFile(path: string): void {
    this.worktree.delete(path)
  }

  renameBranch(newName: string): void {
    const hash = this.branches.get(this.currentBranch)
    if (hash !== undefined) {
      this.branches.delete(this.currentBranch)
      this.branches.set(newName, hash)
    }
    this.currentBranch = newName
  }

  createBranch(newBranch: string): void {
    // Create a new branch at current HEAD and switch to it
    if (this.head !== null) {
      this.branches.set(newBranch, this.head)
    }
    this.currentBranch = newBranch
  }
}

// ---------------------------------------------------------------------------
// Utility: diff two trees
// ---------------------------------------------------------------------------

function diffTrees(
  treeA: Map<string, string>,
  treeB: Map<string, string>,
): Array<{ path: string; status: string }> {
  const result: Array<{ path: string; status: string }> = []
  const allPaths = new Set([...treeA.keys(), ...treeB.keys()])
  for (const path of allPaths) {
    const inA = treeA.has(path)
    const inB = treeB.has(path)
    if (!inA && inB) {
      result.push({ path, status: "A" })
    } else if (inA && !inB) {
      result.push({ path, status: "D" })
    } else if (inA && inB && treeA.get(path) !== treeB.get(path)) {
      result.push({ path, status: "M" })
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path))
}
