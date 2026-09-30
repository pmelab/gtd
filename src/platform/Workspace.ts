import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { dirname, isAbsolute, join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { GitService, type GitOperations } from "./Git.js"
import { Host } from "./Host.js"

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))

// A tree listing, or one committed file, can overflow execFileSync's 1 MB default.
const MAX_BUFFER = 256 * 1024 * 1024
const HASH_CHUNK = 500

/** A full sha1 or sha256 object id — the only refs an immutable, disk-cached read is safe to key on. */
const isObjectHash = (ref: string): boolean => /^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(ref)

const GTD_CACHE_SUBDIR = "gtd-cache"

const treeCachePath = (commonDir: string, hash: string): string =>
  join(commonDir, GTD_CACHE_SUBDIR, "trees", hash)

const blobCachePath = (commonDir: string, id: string): string =>
  join(commonDir, GTD_CACHE_SUBDIR, "blobs", id)

const readTextCache = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

/**
 * Atomic write: a temp name in the SAME directory, `rename`d into place —
 * rename is atomic on POSIX, so a concurrent reader sees either the old file
 * or the whole new one, never a half-written one. Any failure (full disk, a
 * read-only git directory, a raced directory removal) is swallowed: the
 * cache is a best-effort speedup, never a correctness dependency, and the
 * alternative — failing a gtd command over a cache write — is worse.
 */
const writeTextCacheAtomic = (path: string, content: string): void => {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
    writeFileSync(tmp, content, "utf8")
    renameSync(tmp, path)
  } catch {
    // A full disk or read-only git dir silently disables the cache.
  }
}

/** A commit's `path → blob id` map, serialized as JSON. `undefined` on ANY read failure — missing, truncated, unparseable — so the caller falls back to asking git. */
const readTreeCache = (commonDir: string, hash: string): Map<string, string> | undefined => {
  const raw = readTextCache(treeCachePath(commonDir, hash))
  if (raw === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined
    const map = new Map<string, string>()
    for (const [path, id] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof id !== "string") return undefined
      map.set(path, id)
    }
    return map
  } catch {
    return undefined
  }
}

const writeTreeCache = (commonDir: string, hash: string, tree: ReadonlyMap<string, string>): void =>
  writeTextCacheAtomic(treeCachePath(commonDir, hash), JSON.stringify(Object.fromEntries(tree)))

/**
 * One raw `git log --raw` diff entry, already resolved to what it does to a
 * `path → blob id` map — a rename deletes its old path, a copy does not.
 */
interface RawDiffEntry {
  readonly status: string
  readonly oldPath?: string
  readonly path: string
  readonly newId: string
}

/** Parses a `:`-prefixed raw-diff header token into its status letter and new blob id. */
const parseRawDiffHeader = (
  header: string,
): { readonly letter: string; readonly newId: string } => {
  const fields = header
    .slice(1)
    .split(" ")
    .filter((f) => f.length > 0)
  const status = fields[4] ?? ""
  const newId = fields[3] ?? ""
  return { letter: status[0] ?? "", newId }
}

/**
 * Consumes the 1 (or, for rename/copy, 2) NUL-separated path tokens that
 * follow a raw-diff header, starting at `tokens[i]`. Returns the resulting
 * entry (`undefined` if a path token is missing) and the next index.
 */
const consumeRawDiffPaths = (
  tokens: readonly string[],
  i: number,
  letter: string,
  newId: string,
): { readonly entry: RawDiffEntry | undefined; readonly next: number } => {
  if (letter === "R" || letter === "C") {
    const oldPath = tokens[i]
    const path = tokens[i + 1]
    const entry =
      oldPath !== undefined && path !== undefined
        ? { status: letter, oldPath, path, newId }
        : undefined
    return { entry, next: i + 2 }
  }
  const path = tokens[i]
  const entry = path !== undefined ? { status: letter, path, newId } : undefined
  return { entry, next: i + 1 }
}

/** Parses the NUL-separated body of ONE commit's `--raw -z` diff (the format string's own separator already stripped). */
const parseRawDiff = (body: string): readonly RawDiffEntry[] => {
  const tokens = body.split("\0").filter((t) => t.length > 0)
  const entries: RawDiffEntry[] = []
  let i = 0
  while (i < tokens.length) {
    const header = tokens[i]!
    i += 1
    if (!header.startsWith(":")) continue
    const { letter, newId } = parseRawDiffHeader(header)
    const { entry, next } = consumeRawDiffPaths(tokens, i, letter, newId)
    i = next
    if (entry !== undefined) entries.push(entry)
  }
  return entries
}

/** Applies one commit's raw-diff entries to a (mutable, working-copy) tree map. */
const applyRawDiff = (tree: Map<string, string>, entries: readonly RawDiffEntry[]): void => {
  for (const entry of entries) {
    if (entry.status === "D") tree.delete(entry.path)
    else {
      if (entry.status === "R") tree.delete(entry.oldPath!)
      tree.set(entry.path, entry.newId)
    }
  }
}

/** `git ls-tree -r -z --full-tree <ref>`'s output, parsed into `path → blob id`. */
const parseLsTree = (out: string): Map<string, string> => {
  const entries = new Map<string, string>()
  for (const record of out.split("\0")) {
    const tab = record.indexOf("\t")
    if (tab === -1) continue
    const id = record.slice(0, tab).split(" ")[2]
    if (id !== undefined) entries.set(record.slice(tab + 1), id)
  }
  return entries
}

/**
 * Runs `git ls-tree` for `ref` and reports whether it actually succeeded —
 * `ok: false` on ANY subprocess failure (a transient `EAGAIN`/`ENOMEM` on
 * fork, a `git gc` race, a signal), never folded into an empty tree here.
 * The disk/memo cache must only ever hold a git-CONFIRMED tree: an immutable
 * key can serve a wrong answer forever if what's stored under it came from a
 * failed read rather than from the key itself, so callers that cache must
 * check `ok` before doing so.
 */
const fetchTree = (
  root: string,
  ref: string,
): { readonly ok: boolean; readonly entries: Map<string, string> } => {
  try {
    return {
      ok: true,
      entries: parseLsTree(
        execFileSync("git", ["ls-tree", "-r", "-z", "--full-tree", ref], {
          cwd: root,
          encoding: "utf8",
          maxBuffer: MAX_BUFFER,
        }),
      ),
    }
  } catch {
    return { ok: false, entries: new Map() }
  }
}

/**
 * The one port onto repo file content, in four REPO-RELATIVE read shapes:
 * `readSync` and `readCommittedSync` (replay reads the tree between two
 * awaits and cannot `yield*` — see the seam rule in `index.ts`), `read` (the
 * Effect shape everything else uses) and `committed` (the async read-at-ref
 * path, `git show <ref>:<path>`). Absence is
 * a VALUE (`undefined`) on every read shape, never an error — a
 * genuine fault (EACCES, EISDIR) still fails/throws for the two working-tree
 * shapes; `committed`/`readCommittedSync` fold EVERY git failure (missing
 * ref, missing path, a real fault) into absence, matching `git show`'s own
 * flat non-zero-exit signal. An ABSOLUTE `path` on any of these four (plus
 * `write`) fails loudly rather than silently escaping the repo — that escape
 * is `atPath`/`writeAtPath`'s job alone, named so it reads as deliberate at
 * each call site: `src/workflow/load.ts`'s cwd→home discovery walk and a
 * `.gtdrc` file-ref resolved against its own, possibly-ancestor, declaring
 * directory (read-only, both); and `program.ts`'s `gtd check`/`gtd uncheck`,
 * whose `<file>` argument is an arbitrary CLI-given path — absolute or
 * relative to `root` — never a repo-scoped one.
 * Keeping the escape on separately-named members is what makes "a
 * repo-relative path reaching `/tmp`" (the failure mode `Host`'s separate
 * scratch port exists to prevent) a loud misuse of the wrong method, not a
 * silent path-shape coincidence.
 */
export interface WorkspaceOps {
  readonly readSync: (path: string) => string | undefined
  readonly read: (path: string) => Effect.Effect<string | undefined, Error>
  readonly write: (path: string, content: string) => Effect.Effect<void, Error>
  readonly committed: (path: string, ref?: string) => Effect.Effect<string | undefined, Error>
  /** `committed`, synchronous — see the interface doc comment. */
  readonly readCommittedSync: (path: string, ref?: string) => string | undefined
  /**
   * Every path committed at `ref`, with its blob id — sync for the same
   * reason `readCommittedSync` is: flow code reads a commit's tree between
   * two awaits and cannot wait on IO.
   */
  readonly treeSync: (ref: string) => ReadonlyMap<string, string>
  /**
   * Every path `git add -A` would commit from the working tree, with the blob
   * id it would get — `undefined` where no id could be worked out, so a
   * reader compares contents instead.
   */
  readonly worktreeSync: () => ReadonlyMap<string, string | undefined>
  /**
   * `hash → (path → blob id)` for `base` (when given) and every one of
   * `commits`, in ONE call regardless of how many commits that is: a single
   * `git ls-tree` for `base` plus a single `git log --raw` walking
   * `base..last` (or all of `last`'s first-parent history when `base` is
   * `undefined` — the repository-root episode), each commit's delta applied
   * to the previous map in memory. Every resulting map is also cached (in
   * process and on disk, keyed by commit hash — see `treeSync`), so a
   * commit already known from a prior call, or a prior `gtd` invocation,
   * costs no subprocess at all.
   */
  readonly episodeTrees: (
    base: string | undefined,
    commits: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, ReadonlyMap<string, string>>, Error>
  /**
   * Reads an ARBITRARY path — repo-relative or already-absolute, inside the
   * repo, above it, or anywhere else on disk — with the same absence-is-a-
   * value/fault-still-throws contract as `readSync`. The deliberate escape
   * from the repo-relative contract above.
   */
  readonly atPath: (path: string) => string | undefined
  /** `atPath`'s write counterpart — `gtd uncheck`'s one caller needing it. */
  readonly writeAtPath: (path: string, content: string) => Effect.Effect<void, Error>
}

const assertRepoRelative = (path: string): string => {
  if (isAbsolute(path)) {
    throw new Error(
      `Workspace: "${path}" is an absolute path — this member takes repo-relative paths only (use "atPath"/"writeAtPath" to read/write outside the repo)`,
    )
  }
  return path
}

const readFileOrAbsent = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8")
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw e
  }
}

const lstatOrAbsent = (path: string): ReturnType<typeof lstatSync> | undefined => {
  try {
    return lstatSync(path)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw e
  }
}

/** One replayed commit: its hash and the (already-`\n`-stripped) `--raw -z` body `parseRawDiff` consumes. */
interface RawLogEntry {
  readonly hash: string
  readonly tail: string
}

/**
 * Runs `git log --raw` for `base..head` (or all of `head`'s first-parent
 * history when `base` is `undefined`) and splits the output into one
 * `RawLogEntry` per commit, validating the result against `commits` — same
 * count, same hashes, in order — since the two disagreeing means the episode
 * bounds no longer match git's own history.
 */
const runRawLogReplay = (
  root: string,
  base: string | undefined,
  head: string,
  commits: readonly string[],
): readonly RawLogEntry[] => {
  const range = base !== undefined ? `${base}..${head}` : head
  const out = execFileSync(
    "git",
    [
      "log",
      "--first-parent",
      "--reverse",
      "-z",
      "--raw",
      "-r",
      "--no-abbrev",
      "--format=%x01%H",
      range,
    ],
    { cwd: root, encoding: "utf8", maxBuffer: MAX_BUFFER },
  )
  const chunks = out.split("\x01").filter((c) => c.length > 0)
  if (chunks.length !== commits.length) {
    throw new Error(
      `gtd: episode reconstruction expected ${commits.length} commit(s) from git log, got ${chunks.length} — the episode bounds disagree with git's own history`,
    )
  }
  return chunks.map((chunk, i) => {
    const nul = chunk.indexOf("\0")
    const hash = nul === -1 ? chunk : chunk.slice(0, nul)
    if (hash !== commits[i]) {
      throw new Error(
        `gtd: episode reconstruction hash mismatch at position ${i}: expected ${commits[i]}, got ${hash}`,
      )
    }
    const tail = nul === -1 ? "" : chunk.slice(nul + 1)
    return { hash, tail: tail.startsWith("\n") ? tail.slice(1) : tail }
  })
}

/** Applies each `RawLogEntry`'s diff in order onto `baseTree`, caching (and returning) every resulting tree. */
const foldRawDiffs = (
  baseTree: ReadonlyMap<string, string>,
  replay: readonly RawLogEntry[],
  rememberTree: (hash: string, tree: ReadonlyMap<string, string>) => void,
): Map<string, ReadonlyMap<string, string>> => {
  const result = new Map<string, ReadonlyMap<string, string>>()
  let current = new Map(baseTree)
  for (const { hash, tail } of replay) {
    const next = new Map(current)
    applyRawDiff(next, parseRawDiff(tail))
    current = next
    result.set(hash, current)
    rememberTree(hash, current)
  }
  return result
}

const makeWorkspaceOps = (
  root: string,
  git: GitOperations,
  commonDir: string | undefined,
): WorkspaceOps => {
  const resolveAny = (path: string): string => (isAbsolute(path) ? path : join(root, path))

  // Per-PROCESS memo, on the workspace instance rather than any one replay's
  // `TreeView` — an immutable key (a commit hash, a blob id) can never serve
  // a wrong answer, so the two replays one `gtd` command runs (and every
  // `treeSync`/`readCommittedSync` call in between) share it for free.
  const treeMemo = new Map<string, ReadonlyMap<string, string>>()
  const blobMemo = new Map<string, string>()

  /** A commit's tree, from the in-process memo or the on-disk cache — no subprocess. `undefined` on a cold miss. */
  const peekTree = (hash: string): ReadonlyMap<string, string> | undefined => {
    const memoHit = treeMemo.get(hash)
    if (memoHit !== undefined) return memoHit
    if (commonDir === undefined) return undefined
    const cached = readTreeCache(commonDir, hash)
    if (cached !== undefined) treeMemo.set(hash, cached)
    return cached
  }

  const rememberTree = (hash: string, tree: ReadonlyMap<string, string>): void => {
    treeMemo.set(hash, tree)
    if (commonDir !== undefined) writeTreeCache(commonDir, hash, tree)
  }

  const readSync = (path: string): string | undefined =>
    readFileOrAbsent(join(root, assertRepoRelative(path)))

  /**
   * A blob's content, keyed on its OWN id rather than a (path, ref) pair —
   * the same content read from two different commits costs one read, not
   * two. `git cat-file -p` reads any object by id directly, no pathspec
   * needed. Any failure folds to `undefined`, matching `readCommittedSync`'s
   * own catch-all-as-absence.
   */
  const readBlobSync = (id: string): string | undefined => {
    const memoHit = blobMemo.get(id)
    if (memoHit !== undefined) return memoHit
    if (commonDir !== undefined) {
      const cached = readTextCache(blobCachePath(commonDir, id))
      if (cached !== undefined) {
        blobMemo.set(id, cached)
        return cached
      }
    }
    let content: string
    try {
      content = execFileSync("git", ["cat-file", "-p", id], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: MAX_BUFFER,
      })
    } catch {
      return undefined
    }
    blobMemo.set(id, content)
    if (commonDir !== undefined) writeTextCacheAtomic(blobCachePath(commonDir, id), content)
    return content
  }

  // A raw, synchronous `git show <ref>:<path>` — the sync counterpart to
  // `committed`, for replay, which can't `yield*` mid-flow. Bypasses the Effect-based `GitOperations`
  // entirely, the same escape `readSync` already takes around the Effect
  // `FileSystem` — both are raw Node calls, not a second git abstraction.
  // ANY failure (missing ref, missing path at that ref, git not on PATH)
  // folds to `undefined`, matching `committed`'s own catch-all-as-absence.
  //
  // A full object-hash `ref` routes through the tree + blob caches (the
  // path's blob id is looked up in the already-cached tree, then its
  // content through `readBlobSync`) — a symbolic ref (`HEAD`, a branch name)
  // is never cached here, since it can move mid-process (a landing commit),
  // and goes straight to `git show` as before.
  const readCommittedSync = (path: string, ref = "HEAD"): string | undefined => {
    const relPath = assertRepoRelative(path)
    if (isObjectHash(ref)) {
      const id = treeSync(ref).get(relPath)
      return id === undefined ? undefined : readBlobSync(id)
    }
    try {
      return execFileSync("git", ["show", `${ref}:${relPath}`], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: MAX_BUFFER,
      })
    } catch {
      return undefined
    }
  }

  // `entries` is git-confirmed (`ok`) exactly when `fetchTree`'s subprocess
  // actually succeeded — only that result is ever cached; a transient
  // failure folds to an empty tree for THIS call only, never written to the
  // memo or disk (see `fetchTree`'s doc comment).
  const readTree = (ref: string, onFailure: "empty" | "throw"): ReadonlyMap<string, string> => {
    if (isObjectHash(ref)) {
      const cached = peekTree(ref)
      if (cached !== undefined) return cached
    }
    const { ok, entries } = fetchTree(root, ref)
    if (!ok) {
      if (onFailure === "throw") {
        throw new Error(`gtd: failed to read the tree at "${ref}" — git ls-tree did not succeed`)
      }
      return entries
    }
    if (isObjectHash(ref)) rememberTree(ref, entries)
    return entries
  }

  const treeSync = (ref: string): ReadonlyMap<string, string> => readTree(ref, "empty")

  /**
   * `treeSync`'s starting point when a failed read must not silently
   * proceed: a cache hit or a git-confirmed `ls-tree` succeeds; any
   * subprocess failure THROWS rather than folding to an empty tree, because
   * `episodeTrees` folds every subsequent commit's diff on top of this one —
   * a wrong empty base would poison every commit's cached tree in the
   * episode, not just this one's.
   */
  const confirmedTree = (ref: string): ReadonlyMap<string, string> => readTree(ref, "throw")

  /**
   * The delta-stream reconstruction (package 4's Requirement A): one
   * `ls-tree` for `base`, one `--raw` `git log` for every commit, applied in
   * order. Skipped entirely when every requested hash is already known
   * (memo or on-disk cache) — then this issues NO subprocess at all.
   */
  const episodeTrees = (
    base: string | undefined,
    commits: readonly string[],
  ): Effect.Effect<ReadonlyMap<string, ReadonlyMap<string, string>>, Error> =>
    Effect.try({
      try: () => {
        const result = new Map<string, ReadonlyMap<string, string>>()
        const baseTree = base !== undefined ? confirmedTree(base) : new Map<string, string>()
        if (base !== undefined) result.set(base, baseTree)
        if (commits.length === 0) return result

        if (commits.every((hash) => peekTree(hash) !== undefined)) {
          for (const hash of commits) result.set(hash, treeSync(hash))
          return result
        }

        const head = commits[commits.length - 1]!
        const replay = runRawLogReplay(root, base, head, commits)
        for (const [hash, tree] of foldRawDiffs(baseTree, replay, rememberTree))
          result.set(hash, tree)
        return result
      },
      catch: toError,
    })

  const gitSync = (args: readonly string[], input?: string): string =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      ...(input !== undefined ? { input } : {}),
    })

  // A path git status reports is re-hashed the way `git add` would store it;
  // every other path keeps HEAD's blob id, so an untouched file is never
  // read, and never compared by working-tree bytes that eol or smudge
  // filters, or a symlink, make differ from the blob.
  const worktreeSync = (): ReadonlyMap<string, string | undefined> => {
    const entries = new Map<string, string | undefined>(treeSync("HEAD"))
    const status = gitSync([
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--no-renames",
      "--ignore-submodules=none",
    ])
    const files: string[] = []
    for (const record of status.split("\0")) {
      if (record.length < 4) continue
      const path = record.slice(3).replace(/\/$/, "")
      const stat = lstatOrAbsent(join(root, path))
      if (stat === undefined) entries.delete(path)
      else if (stat.isSymbolicLink()) {
        entries.set(path, blobId(readlinkSync(join(root, path), "utf8")))
      } else if (stat.isDirectory()) {
        // Only a directory holding its own repository is committed, as a gitlink.
        if (lstatOrAbsent(join(root, path, ".git")) === undefined) entries.delete(path)
        else entries.set(path, gitlinkOf(path))
      } else files.push(path)
    }
    // Paths go as arguments, never newline-separated on stdin: a path may
    // hold a newline. Chunked to stay under the argument-list limit.
    for (let i = 0; i < files.length; i += HASH_CHUNK) {
      const chunk = files.slice(i, i + HASH_CHUNK)
      const ids = gitSync(["hash-object", "--", ...chunk]).split("\n")
      chunk.forEach((path, j) => entries.set(path, ids[j] || undefined))
    }
    return new Map([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  }

  /** A submodule's (or embedded repository's) checked-out commit — what `git add` records for it. */
  const gitlinkOf = (path: string): string | undefined => {
    try {
      return execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: join(root, path),
        encoding: "utf8",
      }).trim()
    } catch {
      return undefined
    }
  }

  let objectFormat: string | undefined
  const blobId = (content: string): string => {
    objectFormat ??= gitSync(["rev-parse", "--show-object-format"]).trim()
    const bytes = Buffer.from(content, "utf8")
    return createHash(objectFormat === "sha256" ? "sha256" : "sha1")
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest("hex")
  }

  return {
    treeSync,
    worktreeSync,
    episodeTrees,
    readSync,
    read: (path) => Effect.try({ try: () => readSync(path), catch: toError }),
    write: (path, content) =>
      Effect.try({
        try: () => writeFileSync(join(root, assertRepoRelative(path)), content, "utf8"),
        catch: toError,
      }),
    committed: (path, ref = "HEAD") =>
      Effect.try({ try: () => assertRepoRelative(path), catch: toError }).pipe(
        Effect.flatMap((relPath) =>
          git.readFileAtRef(ref, relPath).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
        ),
      ),
    readCommittedSync,
    atPath: (path) => readFileOrAbsent(resolveAny(path)),
    writeAtPath: (path, content) =>
      Effect.try({ try: () => writeFileSync(resolveAny(path), content, "utf8"), catch: toError }),
  }
}

export class Workspace extends Context.Tag("Workspace")<Workspace, WorkspaceOps>() {
  static Live = Layer.effect(
    Workspace,
    Effect.gen(function* () {
      const { root } = yield* Host
      const git = yield* GitService
      // Resolved once per process, not lazily inside a sync method: the
      // common dir is git's own concern to answer, and every cache read/
      // write below is synchronous. A repo whose common dir can't be
      // resolved (git missing, a corrupted `.git`) still constructs a
      // working `Workspace` — it just runs without the disk cache, exactly
      // like a full-disk failure does.
      const commonDir = yield* git
        .gitCommonDir()
        .pipe(Effect.catchAll(() => Effect.succeed(undefined)))
      return makeWorkspaceOps(root, git, commonDir)
    }),
  )
}
