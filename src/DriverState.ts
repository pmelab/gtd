import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { Cwd } from "./Cwd.js"

/**
 * The driver-scoped state port: small files a driver reads/writes across
 * `gtd` invocations (the session table, and later #167's beat marker/#169's
 * log path) that must live OFF the worktree — `src/testing/InMemRepo.ts`'s
 * `FileSystem` fake writes into the worktree map, which would put this state
 * into the pending diff and `gtd status`. This port keeps it in the git dir
 * in both tiers.
 */
export interface DriverStateOps {
  /** `name`'s contents in the driver state directory, `undefined` when absent OR unreadable — a cache, never a source of truth a missing/corrupt read should fail a turn over. */
  readonly read: (name: string) => Effect.Effect<string | undefined>
  /** Writes `name` via a sibling tmp file + rename, so a crash never leaves a half-written file. Swallows any failure (e.g. a read-only git dir) — losing the write degrades callers to "always fresh", never fails the turn. */
  readonly write: (name: string, content: string) => Effect.Effect<void>
  /** The absolute path `name` would be read from/written to. */
  readonly path: (name: string) => Effect.Effect<string>
}

export class DriverState extends Context.Tag("DriverState")<DriverState, DriverStateOps>() {
  static Live = Layer.effect(
    DriverState,
    Effect.gen(function* () {
      const { root } = yield* Cwd
      // Deferred, not resolved here at layer BUILD time: `Cli.ts`'s `layers()`
      // builds this layer for every command, including `gtd init` run outside
      // any git repository at all (`assertInitLocation` explicitly allows
      // that) — resolving eagerly would throw before that command-specific
      // check ever runs. Every op below is reached only from a state command
      // already past `assertRunningFromRepoRoot`, so resolving lazily (and
      // memoizing — one repo root never changes git dir mid-process) costs
      // nothing in practice while keeping layer construction itself total.
      let cachedGitDir: string | undefined
      const gitDir = (): string => (cachedGitDir ??= resolveGitDir(root))
      return {
        read: (name: string) =>
          Effect.sync(() => {
            try {
              return readFileSync(join(gitDir(), name), "utf8")
            } catch {
              return undefined
            }
          }),
        write: (name: string, content: string) =>
          Effect.sync(() => {
            try {
              const filePath = join(gitDir(), name)
              const tmp = `${filePath}.${process.pid}.${process.hrtime.bigint()}.tmp`
              writeFileSync(tmp, content, "utf8")
              renameSync(tmp, filePath)
            } catch {
              // A cache: a read-only git dir degrades callers to "always fresh".
            }
          }),
        path: (name: string) => Effect.sync(() => join(gitDir(), name)),
      }
    }),
  )
}

/**
 * `<root>/.git` is either a directory (a normal, non-linked repo — that's the
 * git dir) or a file whose `gitdir: <path>` line names a linked worktree's
 * private dir (relative paths are resolved against `root`, matching git's own
 * rule). No `git rev-parse` call, so this is immune to an inherited `GIT_DIR`
 * by construction — the only reason bash's equivalent needed its own
 * env-scrubbing `worktree_git_dir` helper.
 */
const resolveGitDir = (root: string): string => {
  const dotGit = join(root, ".git")
  if (statSync(dotGit).isDirectory()) return dotGit
  const content = readFileSync(dotGit, "utf8")
  const match = /^gitdir:\s*(.+)$/m.exec(content)
  if (!match) throw new Error(`gtd: malformed .git file at ${dotGit}`)
  const linked = match[1]!.trim()
  return isAbsolute(linked) ? linked : join(root, linked)
}
