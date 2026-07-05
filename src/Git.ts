import { Command, CommandExecutor } from "@effect/platform"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { Context, Effect, Layer, Option, Stream } from "effect"
import { renderDiff } from "./Diff.js"
import { Cwd } from "./Cwd.js"

export interface GitReaderOperations {
  readonly statusPorcelain: () => Effect.Effect<string, Error>
  /**
   * `git diff HEAD` including untracked files (via a transient intent-to-add),
   * optionally with `:(exclude)` pathspecs. Exclusions match repo-root-relative
   * paths; a directory path excludes everything under it.
   */
  readonly diffHead: (exclude?: ReadonlyArray<string>) => Effect.Effect<string, Error>
  readonly lastCommitSubject: () => Effect.Effect<string, Error>
  readonly hasCommits: () => Effect.Effect<boolean, Error>
  /**
   * `git diff <ref> HEAD`, optionally with `:(exclude)` pathspecs. Exclusions
   * match repo-root-relative paths; a directory path excludes everything under it.
   */
  readonly diffRef: (ref: string, exclude?: ReadonlyArray<string>) => Effect.Effect<string, Error>
  readonly diffPath: (path: string) => Effect.Effect<string, Error>
  readonly resolveRef: (ref: string) => Effect.Effect<string, Error>
  /** `git rev-parse --show-toplevel` — the working-tree root; fails outside a repository. */
  readonly topLevel: () => Effect.Effect<string, Error>
  readonly resolveDefaultBranch: () => Effect.Effect<Option.Option<string>, Error>
  readonly mergeBase: (a: string, b: string) => Effect.Effect<Option.Option<string>, Error>
  /** `git merge-base --is-ancestor a b` — true iff `a` is an ancestor of `b` (or equal). */
  readonly isAncestor: (a: string, b: string) => Effect.Effect<boolean, Error>
  /**
   * `git log --first-parent --diff-filter=D --format=%H -- <path>` — returns the
   * most recent commit that deleted `path` as `Option.some(sha)`, or `Option.none()`.
   */
  readonly lastDeletionOf: (path: string) => Effect.Effect<Option.Option<string>, Error>
  /**
   * First-parent history from `base..HEAD` (or all commits if no base), oldest→newest.
   * Each entry carries the full commit message and `removedErrors: true` iff that
   * commit's name-status diff contains a deletion (`D`) of `ERRORS.md`.
   * Returns `[]` for an empty repo.
   */
  readonly commitHistory: (base?: string) => Effect.Effect<
    ReadonlyArray<{
      readonly hash: string
      readonly message: string
      readonly removedErrors: boolean
    }>,
    Error
  >
}

export interface GitWriterOperations {
  /**
   * `git add -A` then `git commit --allow-empty -m "<prefix>"`. `--allow-empty`
   * is load-bearing: the machine emits `commitPending` with a fixed prefix even
   * on a clean tree (e.g. `gtd: grilled`), and the uncommitted-FEEDBACK Fixing
   * path can net an empty commit — neither must throw "nothing to commit".
   */
  readonly commitAllWithPrefix: (prefix: string) => Effect.Effect<void, Error>
  readonly softResetTo: (ref: string) => Effect.Effect<void, Error>
  /** `git reset HEAD~1` (mixed) — undoes the last commit, keeping changes in the working tree. */
  readonly mixedResetHead: () => Effect.Effect<void, Error>
  /**
   * `git reset --hard HEAD` — index and tracked working tree back to HEAD;
   * staged-but-new files are dropped, pure untracked (`??`) files survive.
   */
  readonly resetHard: () => Effect.Effect<void, Error>
  /** `git revert --no-commit <ref>` — stages the inverse of ref into the working tree, no commit. */
  readonly revertNoCommit: (ref: string) => Effect.Effect<void, Error>
  /** Removes the `.gtd/` directory idempotently (no error if absent). */
  readonly removeGtdDir: () => Effect.Effect<void, Error>
  /**
   * `git rm -r <dir>` (stage the deletion); then if `.gtd/` is now empty, removes
   * the empty directory too. Idempotent/tolerant if the dir is already absent.
   */
  readonly removePackageDir: (dir: string) => Effect.Effect<void, Error>
}

export interface GitOperations extends GitReaderOperations, GitWriterOperations {}

/**
 * Parse `git diff --name-status` output into `{ path, status }` pairs.
 * Status codes: A (added), D (deleted), M (modified), R (renamed), C (copied), etc.
 * Rename/copy lines have format `R<score>\told-path\tnew-path` — we expand them
 * into a deletion of old-path and an addition of new-path.
 */
// fallow-ignore-next-line complexity
const parseNameStatus = (out: string): Array<{ path: string; status: string }> => {
  const result: Array<{ path: string; status: string }> = []
  for (const line of out.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [status, ...rest] = trimmed.split("\t")
    if (!status || rest.length === 0) continue
    if (status.startsWith("R") || status.startsWith("C")) {
      // old-path → deleted, new-path → added
      const [oldPath, newPath] = rest
      if (oldPath) result.push({ path: oldPath, status: "D" })
      if (newPath) result.push({ path: newPath, status: "A" })
    } else {
      const path = rest[0]
      if (path) result.push({ path, status: status[0]! })
    }
  }
  return result
}

/**
 * Filter paths by exclude list. A directory path `dir` excludes anything under
 * `dir/` or exactly `dir`. Applied in JS so we don't pass `:(exclude)` pathspecs
 * to git (which can break on special path characters or certain git versions).
 */
const applyExcludes = <T extends { path: string }>(
  paths: ReadonlyArray<T>,
  exclude: ReadonlyArray<string>,
): Array<T> => {
  if (exclude.length === 0) return [...paths]
  return paths.filter(({ path }) => {
    for (const ex of exclude) {
      if (path === ex || path.startsWith(`${ex}/`)) return false
    }
    return true
  })
}

/**
 * Read a file from the worktree root (`root`).
 * Returns `null` if the file does not exist or is a directory (e.g. a submodule
 * gitlink whose worktree entry is a directory, not a regular file).
 */
const readWorktreeFile = (root: string, path: string): string | null => {
  const resolved = join(root, path)
  if (!existsSync(resolved)) return null
  try {
    return readFileSync(resolved, "utf8")
  } catch (e) {
    // EISDIR: submodule pointer — treated as a non-text entry
    if (e instanceof Error && "code" in e && e.code === "EISDIR") return null
    throw e
  }
}

/**
 * Run a command and return its stdout — FAILING on a non-zero exit code with
 * the command line and stderr in the error message. `Command.string` alone
 * only collects stdout and silently ignores exit codes, which used to make
 * gtd report success on rejected commits (hooks, gpg), resolve Idle outside a
 * repository, and lose files whose quoted paths broke a swallowed `git add`.
 * Callers that expect a probe to fail (missing refs, empty repos) handle it
 * with an explicit `catchAll`.
 */
const run = (
  root: string,
  ...args: [string, ...Array<string>]
): Effect.Effect<string, Error, CommandExecutor.CommandExecutor> =>
  Effect.scoped(
    Effect.gen(function* () {
      const executor = yield* CommandExecutor.CommandExecutor
      const process = yield* executor.start(
        Command.make(...args).pipe(
          Command.workingDirectory(root),
          Command.stdout("pipe"),
          Command.stderr("pipe"),
        ),
      )
      const collect = (stream: typeof process.stdout) =>
        stream.pipe(Stream.decodeText(), Stream.mkString)
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [collect(process.stdout), collect(process.stderr), process.exitCode],
        { concurrency: "unbounded" },
      )
      if (exitCode !== 0) {
        return yield* Effect.fail(
          new Error(`${args.join(" ")} failed (exit ${exitCode}): ${stderr.trim()}`),
        )
      }
      return stdout
    }),
  ).pipe(Effect.mapError((e) => (e instanceof Error ? e : new Error(String(e)))))

const makeGitImpl = (executor: CommandExecutor.CommandExecutor, root: string): GitOperations => {
  const exec = (...args: [string, ...Array<string>]) =>
    run(root, ...args).pipe(
      Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
    )

  return {
    statusPorcelain: () => exec("git", "status", "--porcelain"),

    diffHead: (exclude: ReadonlyArray<string> = []) =>
      Effect.gen(function* () {
        // Collect tracked changes (name-status relative to HEAD)
        const nameStatusOut = yield* exec("git", "diff", "--name-status", "HEAD").pipe(
          Effect.catchAll(() => Effect.succeed("")),
        )
        const trackedPaths = parseNameStatus(nameStatusOut)

        // Collect untracked files (-z: NUL-separated, unquoted)
        const untrackedRaw = yield* exec("git", "ls-files", "--others", "--exclude-standard", "-z")
        const untracked = untrackedRaw
          .split("\0")
          .filter((s) => s.length > 0)
          .map((path) => ({ path, status: "A" as const }))

        // Union of tracked + untracked, deduplicated by path
        const seen = new Set<string>()
        const allPaths: Array<{ path: string; status: string }> = []
        for (const entry of [...trackedPaths, ...untracked]) {
          if (!seen.has(entry.path)) {
            seen.add(entry.path)
            allPaths.push(entry)
          }
        }

        // Apply exclude filtering (JS-side, directory prefix matching)
        const filtered = applyExcludes(allPaths, exclude)
        if (filtered.length === 0) return ""

        // Gather before/after content for each path
        const files = yield* Effect.all(
          filtered.map(({ path, status }) =>
            Effect.gen(function* () {
              const before =
                status === "A"
                  ? null
                  : yield* exec("git", "show", `HEAD:${path}`).pipe(
                      Effect.map((s) => s),
                      Effect.catchAll(() => Effect.succeed<string | null>(null)),
                    )
              const after = status === "D" ? null : readWorktreeFile(root, path)
              return { path, before, after }
            }),
          ),
          { concurrency: "unbounded" },
        )

        return renderDiff(files)
      }),

    lastCommitSubject: () =>
      exec("git", "log", "-1", "--pretty=%s").pipe(Effect.map((s) => s.trim())),

    hasCommits: () =>
      exec("git", "rev-parse", "--verify", "HEAD").pipe(
        Effect.map(() => true),
        Effect.catchAll(() => Effect.succeed(false)),
      ),

    diffRef: (ref: string, exclude: ReadonlyArray<string> = []) =>
      Effect.gen(function* () {
        const nameStatusOut = yield* exec("git", "diff", "--name-status", ref, "HEAD").pipe(
          Effect.catchAll(() => Effect.succeed("")),
        )
        const allPaths = parseNameStatus(nameStatusOut)
        const filtered = applyExcludes(allPaths, exclude)
        if (filtered.length === 0) return ""

        const files = yield* Effect.all(
          filtered.map(({ path, status }) =>
            Effect.gen(function* () {
              const before =
                status === "A"
                  ? null
                  : yield* exec("git", "show", `${ref}:${path}`).pipe(
                      Effect.catchAll(() => Effect.succeed<string | null>(null)),
                    )
              const after =
                status === "D"
                  ? null
                  : yield* exec("git", "show", `HEAD:${path}`).pipe(
                      Effect.catchAll(() => Effect.succeed<string | null>(null)),
                    )
              return { path, before, after }
            }),
          ),
          { concurrency: "unbounded" },
        )

        return renderDiff(files)
      }),

    diffPath: (path: string) =>
      Effect.gen(function* () {
        // Check if the file exists in HEAD
        const beforeOrNull = yield* exec("git", "show", `HEAD:${path}`).pipe(
          Effect.catchAll(() => Effect.succeed<string | null>(null)),
        )
        const after = readWorktreeFile(root, path)

        if (beforeOrNull === null && after === null) return ""
        if (beforeOrNull === after) return ""

        return renderDiff([{ path, before: beforeOrNull, after }])
      }),

    resolveRef: (ref: string) =>
      exec("git", "rev-parse", "--verify", ref).pipe(
        Effect.map((s) => s.trim()),
        Effect.flatMap((hash) =>
          /^[0-9a-f]{40}$/.test(hash)
            ? Effect.succeed(hash)
            : Effect.fail(new Error(`Invalid ref: ${ref}`)),
        ),
      ),

    topLevel: () => exec("git", "rev-parse", "--show-toplevel").pipe(Effect.map((s) => s.trim())),

    resolveDefaultBranch: () =>
      exec("git", "rev-parse", "--abbrev-ref", "origin/HEAD").pipe(
        Effect.map((s) => s.trim()),
        Effect.flatMap((s) =>
          s !== "" && s !== "origin/HEAD"
            ? Effect.succeed(Option.some(s.replace(/^origin\//, "")))
            : Effect.fail(new Error("no remote HEAD")),
        ),
        Effect.catchAll(() =>
          exec("git", "rev-parse", "--verify", "--quiet", "refs/heads/main").pipe(
            Effect.map(() => Option.some("main")),
            Effect.catchAll(() =>
              exec("git", "rev-parse", "--verify", "--quiet", "refs/heads/master").pipe(
                Effect.map(() => Option.some("master")),
                Effect.catchAll(() => Effect.succeed(Option.none<string>())),
              ),
            ),
          ),
        ),
      ),

    mergeBase: (a: string, b: string) =>
      exec("git", "merge-base", a, b).pipe(
        Effect.map((s) => Option.some(s.trim())),
        Effect.catchAll(() => Effect.succeed(Option.none<string>())),
      ),

    isAncestor: (a: string, b: string) =>
      Command.make("git", "merge-base", "--is-ancestor", a, b).pipe(
        Command.workingDirectory(root),
        Command.exitCode,
        Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
        Effect.map((code) => code === 0),
        Effect.catchAll(() => Effect.succeed(false)),
      ),

    lastDeletionOf: (path: string) =>
      exec("git", "log", "--first-parent", "--diff-filter=D", "--format=%H", "--", path).pipe(
        Effect.map((out) => {
          const hash = out
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 0)[0]
          return hash !== undefined ? Option.some(hash) : Option.none<string>()
        }),
        Effect.catchAll(() => Effect.succeed(Option.none<string>())),
      ),

    commitHistory: (base?: string) => {
      const range = base !== undefined ? `${base}..HEAD` : undefined
      const args: [string, ...Array<string>] = [
        "git",
        "log",
        "--first-parent",
        "--reverse",
        "--format=%x01%H%x00%B%x00",
        "--name-status",
        ...(range !== undefined ? [range] : []),
      ]
      return exec(...args).pipe(
        Effect.map((out) =>
          out
            .split("\x01")
            .filter((chunk) => chunk.trim().length > 0)
            .map((chunk) => {
              const parts = chunk.split("\x00")
              const hash = (parts[0] ?? "").trim()
              const message = (parts[1] ?? "").trim()
              const nameStatusBlock = parts.slice(2).join("")
              const removedErrors = /^D\tERRORS\.md$/m.test(nameStatusBlock)
              return { hash, message, removedErrors }
            }),
        ),
        // Empty repo (no HEAD) makes `git log` fail; treat as no commits.
        Effect.catchAll(() =>
          Effect.succeed(
            [] as ReadonlyArray<{
              readonly hash: string
              readonly message: string
              readonly removedErrors: boolean
            }>,
          ),
        ),
      )
    },

    removeGtdDir: () => exec("rm", "-rf", ".gtd").pipe(Effect.asVoid),

    revertNoCommit: (ref: string) => exec("git", "revert", "--no-commit", ref).pipe(Effect.asVoid),

    mixedResetHead: () =>
      Effect.gen(function* () {
        const parentCode = yield* Command.make(
          "git",
          "rev-parse",
          "--verify",
          "--quiet",
          "HEAD~1",
        ).pipe(
          Command.workingDirectory(root),
          Command.exitCode,
          Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
          Effect.mapError((e) => new Error(String(e))),
        )
        if (parentCode !== 0) {
          return yield* Effect.fail(
            new Error(
              "cannot reset transport commit: it is the repository root commit (no parent to reset to)",
            ),
          )
        }
        const resetCode = yield* Command.make("git", "reset", "HEAD~1").pipe(
          Command.workingDirectory(root),
          Command.exitCode,
          Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
          Effect.mapError((e) => new Error(String(e))),
        )
        if (resetCode !== 0) {
          return yield* Effect.fail(new Error(`git reset HEAD~1 failed (exit ${resetCode})`))
        }
      }),

    resetHard: () => exec("git", "reset", "--hard", "HEAD").pipe(Effect.asVoid),

    removePackageDir: (dir: string) =>
      Effect.gen(function* () {
        // Stage deletion; tolerate failure if already absent or untracked
        yield* Command.make("git", "rm", "-r", "--", dir).pipe(
          Command.workingDirectory(root),
          Command.exitCode,
          Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
          Effect.mapError((e) => new Error(String(e))),
        )
        // If .gtd/ is now empty, remove the empty directory too
        const gtdEntries = yield* exec("ls", "-1", ".gtd").pipe(
          Effect.map((out) =>
            out
              .split("\n")
              .map((s) => s.trim())
              .filter((s) => s.length > 0),
          ),
          Effect.catchAll(() => Effect.succeed<string[]>([])),
        )
        if (gtdEntries.length === 0) {
          yield* exec("rm", "-rf", ".gtd").pipe(
            Effect.asVoid,
            Effect.catchAll(() => Effect.void),
          )
        }
      }),

    commitAllWithPrefix: (prefix: string) =>
      Effect.gen(function* () {
        yield* exec("git", "add", "-A")
        yield* exec("git", "commit", "--allow-empty", "-m", prefix)
      }).pipe(Effect.asVoid),

    softResetTo: (ref: string) => exec("git", "reset", "--soft", ref).pipe(Effect.asVoid),
  }
}

const makeLiveEffect = Effect.gen(function* () {
  const executor = yield* CommandExecutor.CommandExecutor
  const { root } = yield* Cwd
  return makeGitImpl(executor, root)
})

export class GitService extends Context.Tag("GitService")<GitService, GitOperations>() {
  static Live = Layer.effect(GitService, makeLiveEffect)
}
