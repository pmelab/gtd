import { Command, CommandExecutor } from "@effect/platform"
import { Context, Effect, Layer, Option } from "effect"

export interface GitOperations {
  readonly statusPorcelain: () => Effect.Effect<string, Error>
  readonly diffHead: () => Effect.Effect<string, Error>
  readonly lastCommitSubject: () => Effect.Effect<string, Error>
  readonly hasCommits: () => Effect.Effect<boolean, Error>
  readonly diffRef: (ref: string) => Effect.Effect<string, Error>
  readonly resolveRef: (ref: string) => Effect.Effect<string, Error>
  readonly resolveDefaultBranch: () => Effect.Effect<Option.Option<string>, Error>
  readonly mergeBase: (a: string, b: string) => Effect.Effect<Option.Option<string>, Error>
  /** `git merge-base --is-ancestor a b` — true iff `a` is an ancestor of `b` (or equal). */
  readonly isAncestor: (a: string, b: string) => Effect.Effect<boolean, Error>
  /** Removes the `.gtd/` directory idempotently (no error if absent). */
  readonly removeGtdDir: () => Effect.Effect<void, Error>
  /** `git revert --no-commit <ref>` — stages the inverse of ref into the working tree, no commit. */
  readonly revertNoCommit: (ref: string) => Effect.Effect<void, Error>
  /** `git reset HEAD~1` (mixed) — undoes the last commit, keeping changes in the working tree. */
  readonly mixedResetHead: () => Effect.Effect<void, Error>
  /** `git checkout -- .` — discards tracked working-tree edits back to HEAD. */
  readonly checkoutAll: () => Effect.Effect<void, Error>
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
  readonly commitHistory: (
    base?: string,
  ) => Effect.Effect<ReadonlyArray<{ readonly message: string; readonly removedErrors: boolean }>, Error>
  /**
   * `git rm -r <dir>` (stage the deletion); then if `.gtd/` is now empty, removes
   * the empty directory too. Idempotent/tolerant if the dir is already absent.
   */
  readonly removePackageDir: (dir: string) => Effect.Effect<void, Error>
  /**
   * `git add -A` then `git commit --allow-empty -m "<prefix>"`. `--allow-empty`
   * is load-bearing: the machine emits `commitPending` with a fixed prefix even
   * on a clean tree (e.g. `gtd: grilled`), and the uncommitted-FEEDBACK Fixing
   * path can net an empty commit — neither must throw "nothing to commit".
   */
  readonly commitAllWithPrefix: (prefix: string) => Effect.Effect<void, Error>
}

const run = (
  ...args: [string, ...Array<string>]
): Effect.Effect<string, Error, CommandExecutor.CommandExecutor> =>
  Command.make(...args).pipe(
    Command.string,
    Effect.mapError((e) => new Error(String(e))),
  )

export class GitService extends Context.Tag("GitService")<GitService, GitOperations>() {
  static Live = Layer.effect(
    GitService,
    Effect.gen(function* () {
      const executor = yield* CommandExecutor.CommandExecutor
      const exec = (...args: [string, ...Array<string>]) =>
        run(...args).pipe(Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)))

      return {
        statusPorcelain: () => exec("git", "status", "--porcelain"),

        diffHead: () =>
          Effect.gen(function* () {
            const untrackedRaw = yield* exec("git", "ls-files", "--others", "--exclude-standard")
            const untracked = untrackedRaw
              .split("\n")
              .map((s) => s.trim())
              .filter((s) => s !== "")
            if (untracked.length === 0) return yield* exec("git", "diff", "HEAD")
            yield* exec("git", "add", "--intent-to-add", "--", ...untracked)
            const diff = yield* exec("git", "diff", "HEAD")
            yield* exec("git", "reset", "--", ...untracked).pipe(Effect.catchAll(() => Effect.void))
            return diff
          }),

        lastCommitSubject: () =>
          exec("git", "log", "-1", "--pretty=%s").pipe(Effect.map((s) => s.trim())),

        hasCommits: () =>
          exec("git", "rev-parse", "--verify", "HEAD").pipe(
            Effect.map(() => true),
            Effect.catchAll(() => Effect.succeed(false)),
          ),

        diffRef: (ref: string) => exec("git", "diff", ref, "HEAD"),

        resolveRef: (ref: string) =>
          exec("git", "rev-parse", "--verify", ref).pipe(
            Effect.map((s) => s.trim()),
            Effect.flatMap((hash) =>
              /^[0-9a-f]{40}$/.test(hash)
                ? Effect.succeed(hash)
                : Effect.fail(new Error(`Invalid ref: ${ref}`)),
            ),
          ),

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
            Command.exitCode,
            Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
            Effect.map((code) => code === 0),
            Effect.catchAll(() => Effect.succeed(false)),
          ),

        removeGtdDir: () => exec("rm", "-rf", ".gtd").pipe(Effect.asVoid),

        revertNoCommit: (ref: string) =>
          exec("git", "revert", "--no-commit", ref).pipe(Effect.asVoid),

        mixedResetHead: () => exec("git", "reset", "HEAD~1").pipe(Effect.asVoid),

        checkoutAll: () => exec("git", "checkout", "--", ".").pipe(Effect.asVoid),

        lastDeletionOf: (path: string) =>
          exec(
            "git",
            "log",
            "--first-parent",
            "--diff-filter=D",
            "--format=%H",
            "--",
            path,
          ).pipe(
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
                  const message = (parts[1] ?? "").trim()
                  const nameStatusBlock = parts.slice(2).join("")
                  const removedErrors = /^D\tERRORS\.md$/m.test(nameStatusBlock)
                  return { message, removedErrors }
                }),
            ),
            // Empty repo (no HEAD) makes `git log` fail; treat as no commits.
            Effect.catchAll(() =>
              Effect.succeed(
                [] as ReadonlyArray<{ readonly message: string; readonly removedErrors: boolean }>,
              ),
            ),
          )
        },

        removePackageDir: (dir: string) =>
          Effect.gen(function* () {
            // Stage deletion; tolerate failure if already absent or untracked
            yield* Command.make("git", "rm", "-r", "--", dir).pipe(
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
      }
    }),
  )
}
