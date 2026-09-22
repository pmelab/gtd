import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { GitService, type GitOperations } from "./Git.js"
import { Host } from "./Host.js"

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))

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
 * tree). Absence is a VALUE (`undefined`) on every shape, never an error — a
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
