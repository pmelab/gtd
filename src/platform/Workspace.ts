import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { lstatSync, readFileSync, readlinkSync, writeFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { GitService, type GitOperations } from "./Git.js"
import { Host } from "./Host.js"

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))

// A tree listing, or one committed file, can overflow execFileSync's 1 MB default.
const MAX_BUFFER = 256 * 1024 * 1024
const HASH_CHUNK = 500

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

const makeWorkspaceOps = (root: string, git: GitOperations): WorkspaceOps => {
  const resolveAny = (path: string): string => (isAbsolute(path) ? path : join(root, path))

  const readSync = (path: string): string | undefined =>
    readFileOrAbsent(join(root, assertRepoRelative(path)))

  // A raw, synchronous `git show <ref>:<path>` — the sync counterpart to
  // `committed`, for replay, which can't `yield*` mid-flow. Bypasses the Effect-based `GitOperations`
  // entirely, the same escape `readSync` already takes around the Effect
  // `FileSystem` — both are raw Node calls, not a second git abstraction.
  // ANY failure (missing ref, missing path at that ref, git not on PATH)
  // folds to `undefined`, matching `committed`'s own catch-all-as-absence.
  const readCommittedSync = (path: string, ref = "HEAD"): string | undefined => {
    const relPath = assertRepoRelative(path)
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

  const treeSync = (ref: string): ReadonlyMap<string, string> => {
    const entries = new Map<string, string>()
    let out: string
    try {
      out = execFileSync("git", ["ls-tree", "-r", "-z", "--full-tree", ref], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: MAX_BUFFER,
      })
    } catch {
      return entries
    }
    for (const record of out.split("\0")) {
      const tab = record.indexOf("\t")
      if (tab === -1) continue
      const id = record.slice(0, tab).split(" ")[2]
      if (id !== undefined) entries.set(record.slice(tab + 1), id)
    }
    return entries
  }

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
      return makeWorkspaceOps(root, git)
    }),
  )
}
