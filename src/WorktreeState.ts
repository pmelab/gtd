import { isAbsolute, join } from "node:path"
import { Effect } from "effect"
import { Host, Workspace } from "./platform/index.js"

const GITDIR_POINTER = /^gitdir:\s*(.+)$/m

/**
 * The worktree's own git dir, resolved via the filesystem rather than a `git`
 * subprocess — byte-identical to `git rev-parse --git-dir`. Never fails: a
 * read failure or a `.git` file with no `gitdir:` line both fall back to
 * `".git"`, which is also correct for the in-memory test tier.
 */
export const worktreeGitDir: Effect.Effect<string, never, Host | Workspace> = Effect.gen(
  function* () {
    const { root } = yield* Host
    const workspace = yield* Workspace
    const content = yield* workspace
      .read(".git")
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    const pointer = content === undefined ? null : GITDIR_POINTER.exec(content)
    if (pointer === null) return ".git"
    const gitdir = pointer[1]!.trim()
    return isAbsolute(gitdir) ? gitdir : join(root, gitdir)
  },
)

/**
 * The per-worktree loop log path `gtd next --json` reports as `log`.
 * Precedence: `$GTD_LOOP_LOG` verbatim, then `$GIT_DIR` (so the log follows
 * wherever git subprocesses actually write), else `worktreeGitDir`. `$GIT_DIR`
 * is honored rather than guarded against on purpose — an inherited (not
 * deliberately set) `GIT_DIR` will move the log path too, so a caller that
 * doesn't want that (e.g. the e2e suite) must scrub it before invoking gtd.
 * Advisory only — gtd neither creates nor truncates the file.
 */
export const loopLogPath: Effect.Effect<string, never, Host | Workspace> = Effect.gen(function* () {
  const { root, env } = yield* Host
  const override = env.GTD_LOOP_LOG
  if (override !== undefined && override !== "") return override

  const gitDirEnv = env.GIT_DIR
  if (gitDirEnv !== undefined && gitDirEnv !== "") {
    const gitDir = isAbsolute(gitDirEnv) ? gitDirEnv : join(root, gitDirEnv)
    return join(gitDir, "gtd-loop.log")
  }

  const gitDir = yield* worktreeGitDir
  return join(gitDir, "gtd-loop.log")
})
