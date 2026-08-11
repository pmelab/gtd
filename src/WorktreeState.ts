/**
 * The per-worktree, untracked state directory (the git dir) and the
 * driver-scoped paths gtd keeps in it — IO-shaped, so it sits at the edge
 * alongside `Edge.ts`/`RepoFiles.ts`; `PatternMachine.ts` stays pure and
 * never sees it.
 *
 * `worktreeGitDir` is resolved from the FILESYSTEM, never from a `git`
 * subprocess: `<root>/.git` is either a directory (a plain repo — the git dir
 * IS `.git`) or a `gitdir: <path>` pointer file (a linked worktree, or
 * `--separate-git-dir`). Reading it directly needs no `stat` (a failed read
 * because `.git` is a directory reads the same as a missing `.git` — both
 * fall back to `".git"`) and, unlike `git rev-parse --git-dir`, cannot be
 * diverted by a stray `GIT_DIR`/`GIT_WORK_TREE` in the ambient environment —
 * there is no subprocess for those to divert. `loopLogPath` is the ONE path
 * resolved here: gtd keeps no other per-worktree state (sessions are derived
 * from history, stall is history itself), and gtd never creates or truncates
 * even this file — the driver owns it; gtd only names it.
 */

import { isAbsolute, join } from "node:path"
import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { Cwd } from "./Cwd.js"
import { EnvVars } from "./EnvVars.js"

const GITDIR_POINTER = /^gitdir:\s*(.+)$/m

/**
 * The worktree's own git dir — byte-identical to `git rev-parse --git-dir`
 * for a plain repo, a linked worktree, or `--separate-git-dir`. Never fails:
 * a read failure (no `.git`, or `.git` is a real directory) or a `.git` file
 * with no `gitdir:` line both fall back to the literal `".git"`, which is
 * also the right answer against the in-memory test tier (whose fake
 * filesystem has no `.git` entry at all).
 */
export const worktreeGitDir: Effect.Effect<string, never, Cwd | FileSystem.FileSystem> = Effect.gen(
  function* () {
    const { root } = yield* Cwd
    const fs = yield* FileSystem.FileSystem
    const content = yield* fs
      .readFileString(join(root, ".git"))
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    const pointer = content === undefined ? null : GITDIR_POINTER.exec(content)
    if (pointer === null) return ".git"
    const gitdir = pointer[1]!.trim()
    return isAbsolute(gitdir) ? gitdir : join(root, gitdir)
  },
)

/**
 * The per-worktree loop log path `gtd next --json` reports as `log`.
 * `$GTD_LOOP_LOG` (non-empty) wins verbatim — no join, no normalization — so
 * a `gtd` invoked from inside a check script inherits the enclosing run's
 * log path unchanged. Otherwise `<git-dir>/gtd-loop.log`, isolating two
 * worktrees looping concurrently from each other's log by construction (each
 * has its own git dir). Advisory metadata only — gtd neither creates nor
 * truncates the file.
 */
export const loopLogPath: Effect.Effect<string, never, Cwd | FileSystem.FileSystem | EnvVars> =
  Effect.gen(function* () {
    const { all } = yield* EnvVars
    const override = all.GTD_LOOP_LOG
    if (override !== undefined && override !== "") return override
    const gitDir = yield* worktreeGitDir
    return join(gitDir, "gtd-loop.log")
  })
