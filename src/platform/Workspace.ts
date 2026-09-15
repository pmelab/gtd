import { readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { GitService, type GitOperations } from "./Git.js"
import { Host } from "./Host.js"

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))

/**
 * The one port onto repo file content, in three REPO-RELATIVE read shapes:
 * `readSync` (Eta calls `it.read` synchronously mid-render and cannot
 * `yield*`, and `PatternConfig`'s pure compilers are the same kind of caller
 * — see the seam rule in `index.ts`), `read` (the Effect shape everything
 * else uses), and `committed` (the read-at-ref path, `git show <ref>:<path>`).
 * Absence is a VALUE (`undefined`) on every shape, never an error — a genuine
 * fault (EACCES, EISDIR) still fails/throws. An ABSOLUTE `path` on any of
 * these three (plus `write`) fails loudly rather than silently escaping the
 * repo — that escape is `atPath`/`writeAtPath`'s job alone, named so it reads
 * as deliberate at each call site: `src/workflow/load.ts`'s cwd→home discovery walk and
 * a `.gtdrc` file-ref resolved against its own, possibly-ancestor, declaring
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
