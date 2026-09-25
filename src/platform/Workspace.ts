import { execFileSync } from "node:child_process"
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"
import { Context, Effect, Layer } from "effect"
import type { RenderLedger } from "../PatternTemplates.js"
import { GitService, type GitOperations } from "./Git.js"
import { Host } from "./Host.js"

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))

/**
 * `execFileSync`'s default `maxBuffer` (1 MB) throws `ENOBUFS` well below any
 * real review diff (a touched lockfile or generated fixture clears it
 * easily) — `Beat.ts` raises the same default to 16 MB for the same class of
 * problem; `diffSync` goes further (64 MB) since a refused render here stalls
 * any `judge:` field calling `it.diff` outright (`gtd next`/`gtd status`/`gtd
 * judge` all render the same rest). The judgment doc's own Risk note is
 * deliberate: a diff too
 * big for the JUDGE MODEL's context is the driver's problem to hit, not
 * gtd's to pre-empt by truncating or refusing.
 */
const DIFF_MAX_BUFFER = 64 * 1024 * 1024

/**
 * The one port onto repo file content, in four REPO-RELATIVE read shapes:
 * `readSync` (Eta calls `it.read` synchronously mid-render and cannot
 * `yield*`, and `PatternConfig`'s pure compilers are the same kind of caller
 * — see the seam rule in `index.ts`), `read` (the Effect shape everything
 * else uses), `committed` (the async read-at-ref path, `git show
 * <ref>:<path>`), and `readCommittedSync` (the same read-at-ref content, but
 * synchronous — `judge:`'s own Eta render needs evidence bounded to already-
 * committed content, the same "can't `yield*` mid-render" constraint
 * `readSync` exists for, just against `git show` instead of the working
 * tree). `diffSync` is a fifth, separate shape — see its own doc comment —
 * the one deliberate WORKING-TREE read a `judge:` render may make. Absence is
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
 * relative to `root` — never a repo-scoped one Eta/`src/step/Guards.ts` would use.
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
   * `git diff <base>` — tracked AND untracked (non-ignored) working-tree
   * content alike, against `base` — for `judge:`'s Eta render (`it.diff`,
   * `PatternTemplates.ts`). The one deliberate WORKING-TREE read this port
   * exposes to a judge template, unlike every other `judge:`-bound member
   * (`readCommittedSync`), because a `judge:` field calling `it.diff` rules
   * on hunks that are, by definition, not committed yet. A real `git
   * diff <base>` alone would miss a brand-new file entirely (untracked is
   * invisible to it), so this runs `git add -N -A` first — against a
   * THROWAWAY COPY of the real index (`GIT_INDEX_FILE`), deleted after, so
   * rendering a judgment never flips a real `??` entry into `A` and changes
   * which `on:` pattern the very next `gtd next` matches. Throws on ANY
   * failure (bad base, an index copy that fails, an `add -N` error) — never
   * silently falls back to a tracked-only diff, which would read as "no new
   * files" to a judge that trusts it.
   */
  readonly diffSync: (base: string) => string
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

const makeWorkspaceOps = (root: string, git: GitOperations): WorkspaceOps => {
  const resolveAny = (path: string): string => (isAbsolute(path) ? path : join(root, path))

  const readSync = (path: string): string | undefined =>
    readFileOrAbsent(join(root, assertRepoRelative(path)))

  // A raw, synchronous `git show <ref>:<path>` — the sync counterpart to
  // `committed`, for the one caller (`templateReadCommitted`) that can't
  // `yield*` mid-Eta-render. Bypasses the Effect-based `GitOperations`
  // entirely, the same escape `readSync` already takes around the Effect
  // `FileSystem` — both are raw Node calls, not a second git abstraction.
  // ANY failure (missing ref, missing path at that ref, git not on PATH)
  // folds to `undefined`, matching `committed`'s own catch-all-as-absence.
  const readCommittedSync = (path: string, ref = "HEAD"): string | undefined => {
    const relPath = assertRepoRelative(path)
    try {
      return execFileSync("git", ["show", `${ref}:${relPath}`], { cwd: root, encoding: "utf8" })
    } catch {
      return undefined
    }
  }

  // `--absolute-git-dir` (not a hardcoded ".git") so a linked worktree's own
  // per-worktree index is copied — never the common gitdir's, which a
  // worktree doesn't share for its index.
  const diffSync = (base: string): string => {
    const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: DIFF_MAX_BUFFER,
    }).trim()
    const tmpDir = mkdtempSync(join(tmpdir(), "gtd-diff-"))
    const tmpIndex = join(tmpDir, "index")
    try {
      const realIndex = join(gitDir, "index")
      copyFileSync(realIndex, tmpIndex)
      // `copyFileSync` gives the copy a FRESH mtime (now) — later than the
      // real index's own. Git treats an entry as "racily clean" whenever
      // `entry.mtime >= index_file.mtime`; a fresh copy mtime un-races
      // entries that WERE racy against the real index, so git trusts stale
      // cached stat data instead of re-reading content and a same-second,
      // same-size edit silently vanishes from the diff. Preserving the real
      // index's own mtime (not "now") keeps that racy-index protection
      // intact on the copy.
      const { atime, mtime } = statSync(realIndex)
      utimesSync(tmpIndex, atime, mtime)
      const env = { ...process.env, GIT_INDEX_FILE: tmpIndex }
      execFileSync("git", ["add", "-N", "-A"], { cwd: root, env, maxBuffer: DIFF_MAX_BUFFER })
      return execFileSync("git", ["diff", base], {
        cwd: root,
        env,
        encoding: "utf8",
        maxBuffer: DIFF_MAX_BUFFER,
      })
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  return {
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
    diffSync,
    atPath: (path) => readFileOrAbsent(resolveAny(path)),
    writeAtPath: (path, content) =>
      Effect.try({ try: () => writeFileSync(resolveAny(path), content, "utf8"), catch: toError }),
  }
}

/**
 * Re-adds the ENOENT throw `Workspace.readSync` drops: a template's
 * `it.read(missing)` throwing IS the commit-refusal mechanism
 * (`PatternTemplates.ts`'s render-failure contract).
 */
export const templateRead =
  (workspace: Pick<WorkspaceOps, "readSync">) =>
  (path: string): string => {
    const content = workspace.readSync(path)
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`)
    }
    return content
  }

/**
 * `templateRead`'s evidence-rule counterpart for `judge:` — reads only
 * already-COMMITTED content (`workspace.readCommittedSync`, `git show
 * <ref>:<path>`), so a judge template's `it.read(...)` can never reach a
 * freshly-gathered or `.gitignore`d working-tree artifact the way
 * `templateRead` (bound to `prompt:`/`message:`/`script:`) legitimately can.
 * Throwing on absence is the same commit-refusal mechanism `templateRead`
 * uses: an uncommitted (or missing) path is simply not resolvable evidence.
 */
export const templateReadCommitted =
  (workspace: Pick<WorkspaceOps, "readCommittedSync">, ref = "HEAD") =>
  (path: string): string => {
    const content = workspace.readCommittedSync(path, ref)
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory, open '${path}' at ${ref} — not committed`)
    }
    return content
  }

/**
 * `it.diff`'s binding (`PatternTemplates.ts`'s `TemplateContext.diff`) —
 * thin proxy over `workspace.diffSync`, kept as its own named export so a
 * render site wires it the same "`Pick<WorkspaceOps, ...>`" way
 * `templateRead`/`templateReadCommitted` do, rather than reaching into
 * `WorkspaceOps` directly.
 */
export const templateDiff =
  (workspace: Pick<WorkspaceOps, "diffSync">) =>
  (base: string): string =>
    workspace.diffSync(base)

/**
 * `it.tail`'s binding (`PatternTemplates.ts`'s `TemplateContext.tail`) —
 * bounds `read`'s content through `ledger.tail`, so a caller wires this with
 * `templateRead(workspace)` for the ordinary context or
 * `templateReadCommitted(workspace)` for `judgeContext`, inheriting whichever
 * evidence rule that `read` binding already enforces (same pattern
 * `it.sections` uses in `Edge.ts`'s `buildTemplateContext`). `it.diffTail`
 * shares the same `ledger.tail` accounting directly against `diff`'s output
 * (`Edge.ts`), needing no separate binding here.
 */
export const templateTail =
  (read: (path: string) => string, ledger: Pick<RenderLedger, "tail">) =>
  (path: string, share: number): string =>
    ledger.tail(read(path), share)

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
