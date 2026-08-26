// Pure TypeScript, no Effect, no real filesystem/git.
import { createHash } from "node:crypto"

/** Embedded in every value this fake reaches (see also `strictGitOperations`'s default message) so `scripts/assert-no-test-doubles.mjs` can catch a leak into the shipped bundle by string search. */
export const TEST_DOUBLE_SENTINEL = "gtd:test-double:never-ship"

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
  // fallow-ignore-next-line unused-class-member -- data-only marker read by no code path; embeds the sentinel in every instance so a leaked object still carries it
  readonly testDouble = TEST_DOUBLE_SENTINEL

  private commits: Map<string, Commit> = new Map()
  private branches: Map<string, string> = new Map() // branch name → hash
  private refs: Map<string, string> = new Map() // fully qualified ref (refs/gtd/…) → hash
  private head: string | null = null
  private currentBranch: string = "main"
  private worktree: Map<string, string> = new Map()
  private index: Map<string, string> = new Map()
  private pendingFaults: Array<() => Error> = []

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

  /** The tree at `ref` (HEAD's own when `ref` is omitted), empty when it resolves to nothing. */
  private treeAt(ref: string | undefined): Map<string, string> {
    if (ref === undefined) return this.headTree()
    const hash = this.resolveRef(ref)
    return hash === null ? new Map() : (this.getCommit(hash)?.files ?? new Map())
  }

  // fallow-ignore-next-line complexity
  statusPorcelain(): string {
    const headTree = this.headTree()
    const lines: string[] = []

    const allPaths = new Set([...headTree.keys(), ...this.index.keys(), ...this.worktree.keys()])

    for (const path of [...allPaths].sort()) {
      const inHead = headTree.has(path)
      const inIndex = this.index.has(path)
      const inWorktree = this.worktree.has(path)
      const headContent = headTree.get(path)
      const indexContent = this.index.get(path)
      const worktreeContent = this.worktree.get(path)

      let X = " "
      if (!inHead && inIndex) {
        X = "A"
      } else if (inHead && !inIndex) {
        X = "D"
      } else if (inHead && inIndex && headContent !== indexContent) {
        X = "M"
      }

      let Y = " "
      if (inIndex && !inWorktree) {
        Y = "D"
      } else if (!inIndex && inWorktree) {
        Y = "?"
      } else if (inIndex && inWorktree && indexContent !== worktreeContent) {
        Y = "M"
      }

      if (!inHead && !inIndex && inWorktree) {
        lines.push(`?? ${path}`)
        continue
      }

      if (X === " " && Y === " ") continue

      lines.push(`${X}${Y} ${path}`)
    }

    return lines.length > 0 ? lines.join("\n") + "\n" : ""
  }

  hasCommits(): boolean {
    return this.head !== null
  }

  // fallow-ignore-next-line complexity
  resolveRef(ref: string): string | null {
    if (/^[0-9a-f]{40}$/.test(ref)) {
      return this.commits.has(ref) ? ref : null
    }

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

    const refHash = this.refs.get(ref)
    if (refHash !== undefined) return refHash

    return this.branches.get(ref) ?? null
  }

  lastCommitSubject(ref = "HEAD"): string | null {
    const hash = this.resolveRef(ref)
    const c = hash !== null ? this.getCommit(hash) : null
    if (!c) return null
    return c.message.split("\n")[0] ?? null
  }

  lastCommitMessage(): string | null {
    const c = this.headCommit()
    if (!c) return null
    return c.message
  }

  /**
   * `head` (default `this.head`, mirroring production's `"HEAD"` default) is
   * resolved through the SAME `resolveRef` logic as any other ref — so a
   * symbolic name, a hash, or a `~N` expression all work exactly as they
   * would for `head === undefined`. `Edge.ts`'s `restAt` passes the review
   * checkout window's saved-head hash here while the window is open.
   */
  commitHistory(
    base?: string,
    head?: string,
  ): Array<{
    hash: string
    message: string
    removedErrors: boolean
    touched: ReadonlyArray<string>
  }> {
    const headHash = head !== undefined ? this.resolveRef(head) : this.head
    if (headHash === null) return []

    const chain: Commit[] = []
    let cur: string | null = headHash
    while (cur !== null) {
      const c = this.getCommit(cur)
      if (!c) break
      chain.push(c)
      cur = c.parent
    }

    chain.reverse()

    // Filter to base..HEAD range if base given — resolved through `resolveRef`
    // so a `<hash>~N`/`HEAD~N` base (not just an already-resolved hash) walks
    // the same range a real `git log <base>..<head>` would.
    let filtered = chain
    if (base !== undefined) {
      const resolvedBase = this.resolveRef(base)
      const baseIdx = resolvedBase === null ? -1 : chain.findIndex((c) => c.hash === resolvedBase)
      if (baseIdx === -1) {
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

  fileAtRef(ref: string, path: string): string | null {
    const hash = this.resolveRef(ref)
    if (!hash) return null
    const c = this.getCommit(hash)
    if (!c) return null
    return c.files.get(path) ?? null
  }

  /**
   * `base` (default HEAD) mirrors the port's own optional base. Tree-vs-worktree
   * comparison already subsumes production's untracked-file filtering: a path
   * present at `base` with identical content is simply not a difference.
   */
  changedPathsWorktree(base?: string): Array<{ path: string; status: string }> {
    const baseTree = this.treeAt(base)
    const worktreeTree = new Map(this.worktree)
    return diffTrees(baseTree, worktreeTree)
  }

  /** The worktree content of `path`, or `undefined` when absent. A LIVE read — never a snapshot. */
  readFile(path: string): string | undefined {
    return this.worktree.get(path)
  }

  /** True when `path` is exactly a worktree file, or a directory prefix of one (any worktree key starts with `path/`). */
  hasPath(path: string): boolean {
    if (this.worktree.has(path)) return true
    const prefix = path.endsWith("/") ? path : `${path}/`
    for (const key of this.worktree.keys()) {
      if (key.startsWith(prefix)) return true
    }
    return false
  }

  /** Every worktree path under `prefix`, sorted. `prefix === ""` returns the whole worktree. */
  pathsUnder(prefix: string): ReadonlyArray<string> {
    if (prefix === "") return [...this.worktree.keys()].sort()
    const dirPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`
    return [...this.worktree.keys()]
      .filter((key) => key === prefix || key.startsWith(dirPrefix))
      .sort()
  }

  /** The immediate child names (files or subdirectories) of `dir` in the worktree, sorted. */
  childNames(dir: string): ReadonlyArray<string> {
    const prefix = dir.endsWith("/") ? dir : `${dir}/`
    const names = new Set<string>()
    for (const key of this.worktree.keys()) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      const slash = rest.indexOf("/")
      const name = slash === -1 ? rest : rest.slice(0, slash)
      if (name.length > 0) names.add(name)
    }
    return [...names].sort()
  }

  /** `git add -A` — the index becomes exactly the current worktree. */
  stageAll(): void {
    this.index = new Map(this.worktree)
  }

  /**
   * Arrange for the NEXT `count` write operations dispatched through
   * `fakeGitOperations`'s writer wrapper to fail with `make()` (a fresh error
   * per failure) — the fault queue `failNextOperations`/`takeInjectedFault`
   * pair simulates an `index.lock` contention window. Only writers consume the
   * queue: readers never take git's index lock, so injecting a lock fault into
   * one would be a lie.
   */
  failNextOperations(count: number, make: () => Error): void {
    for (let i = 0; i < count; i++) this.pendingFaults.push(make)
  }

  /** Pop and return the next queued fault, or `undefined` when the queue is empty. Consumed by `fakeGitOperations`'s writer wrapper. */
  takeInjectedFault(): Error | undefined {
    const make = this.pendingFaults.shift()
    return make?.()
  }

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

  /** Discard every pending change, tracked or untracked: stage everything, then hard-reset (which drops the freshly-staged untracked paths too). */
  discardPending(): void {
    this.index = new Map(this.worktree)
    this.resetHard()
  }

  commitAllWithPrefix(prefix: string): void {
    this.index = new Map(this.worktree)

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
    if (ref === InMemRepo.EMPTY_TREE) {
      this.head = null
      this.branches.delete(this.currentBranch)
      return
    }
    const hash = this.resolveRef(ref)
    if (!hash) throw new Error(`Cannot resolve ref: ${ref}`)
    this.head = hash
    this.branches.set(this.currentBranch, hash)
  }

  /**
   * `git reset --hard <ref>` — move HEAD, the index, AND the worktree to
   * `ref`'s commit. Doubles as test-setup (a scenario simulating checking out
   * a DIFFERENT point in history — e.g. to build two diverging tips off one
   * shared base, so one of them is provably NOT an ancestor of the other,
   * `gtd review <commitish>`'s ancestor guard) and as this repo's backing for
   * the production `GitOperations.hardResetTo` (wired in `GitDoubles.ts`).
   */
  hardResetTo(ref: string): void {
    const hash = this.resolveRef(ref)
    if (!hash) throw new Error(`Cannot resolve ref: ${ref}`)
    this.head = hash
    this.branches.set(this.currentBranch, hash)
    const tree = this.getCommit(hash)?.files ?? new Map()
    this.index = new Map(tree)
    this.worktree = new Map(tree)
  }

  resetHard(): void {
    const headTree = this.headTree()
    // Snapshot the old index before resetting it (needed to identify staged-new files).
    const oldIndex = new Map(this.index)

    this.index = new Map(headTree)

    // Rebuild worktree: pure-untracked files (not in HEAD and not in old
    // index) survive; staged-new files (in old index but not in HEAD) are
    // removed; tracked files are restored to HEAD content.
    const newWorktree = new Map<string, string>()

    for (const [path, content] of this.worktree) {
      if (!headTree.has(path) && !oldIndex.has(path)) {
        newWorktree.set(path, content)
      }
    }

    for (const [path, content] of headTree) {
      newWorktree.set(path, content)
    }

    this.worktree = newWorktree
  }

  writeFile(path: string, content: string): void {
    this.worktree.set(path, content)
  }

  deleteFile(path: string): void {
    this.worktree.delete(path)
  }

  /** `git update-ref <ref> <hash>` — point a repo-local ref at a commit (resolves symbolic inputs first). */
  updateRef(ref: string, hash: string): void {
    this.refs.set(ref, this.resolveRef(hash) ?? hash)
  }

  /** `git update-ref -d <ref>` — idempotent removal of a repo-local ref. */
  deleteRef(ref: string): void {
    this.refs.delete(ref)
  }

  /**
   * `git reset --mixed <ref>` — move HEAD and the index to `ref`'s commit,
   * leaving the working tree untouched (so committed work re-surfaces as
   * pending changes).
   */
  mixedResetTo(ref: string): void {
    if (ref === InMemRepo.EMPTY_TREE) {
      this.head = null
      this.branches.delete(this.currentBranch)
      this.index = new Map()
      return
    }
    const hash = this.resolveRef(ref)
    if (!hash) throw new Error(`Cannot resolve ref: ${ref}`)
    this.head = hash
    this.branches.set(this.currentBranch, hash)
    this.index = new Map(this.getCommit(hash)?.files ?? new Map())
  }

  /** True iff `a` is an ancestor of (or equal to) `b` on the first-parent chain. */
  isAncestor(a: string, b: string): boolean {
    const ha = this.resolveRef(a)
    const hb = this.resolveRef(b)
    if (!ha || !hb) return false
    let cur: string | null = hb
    while (cur !== null) {
      if (cur === ha) return true
      cur = this.getCommit(cur)?.parent ?? null
    }
    return false
  }
}

/**
 * Unlike production's `parseNameStatus` (`src/Git.ts`), this never reports a
 * rename/copy (`R`/`C`) — every change is a plain add/delete/modify. A path
 * that git would show as a rename therefore surfaces here as a delete-of-old
 * plus an add-of-new, never as a rename, in either tier's contract tests.
 */
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
