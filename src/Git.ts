import { Command, CommandExecutor } from "@effect/platform"
import { Context, Effect, Layer, Option } from "effect"

export interface GitOperations {
  readonly statusPorcelain: () => Effect.Effect<string, Error>
  readonly diffHead: () => Effect.Effect<string, Error>
  readonly lastCommitSubject: () => Effect.Effect<string, Error>
  readonly lastCommitFiles: () => Effect.Effect<ReadonlyArray<string>, Error>
  readonly hasCommits: () => Effect.Effect<boolean, Error>
  readonly diffRef: (ref: string) => Effect.Effect<string, Error>
  readonly resolveRef: (ref: string) => Effect.Effect<string, Error>
  readonly diffStatRef: (ref: string) => Effect.Effect<string, Error>
  readonly resolveDefaultBranch: () => Effect.Effect<Option.Option<string>, Error>
  readonly mergeBase: (a: string, b: string) => Effect.Effect<Option.Option<string>, Error>
  readonly lastReviewCommit: () => Effect.Effect<Option.Option<string>, Error>
  readonly lastCloseCommit: () => Effect.Effect<Option.Option<string>, Error>
  readonly commitCount: (base: string) => Effect.Effect<number, Error>
  readonly isAncestor: (a: string, b: string) => Effect.Effect<boolean, Error>
  readonly commitSubjects: (base?: string) => Effect.Effect<ReadonlyArray<string>, Error>
  readonly commitMessages: (base?: string) => Effect.Effect<ReadonlyArray<string>, Error>
  readonly showHead: (path: string) => Effect.Effect<string, Error>
  /**
   * Records the current working tree as a raw feedback commit, captures its
   * diff, reverts the commit, removes REVIEW.md, then creates a close commit.
   * Returns the captured diff and the SHA of the record commit.
   *
   * Sequence:
   *   1. `git add -A` + `git commit -m "docs(review): record raw feedback for <base>"`
   *   2. Capture record SHA via `git rev-parse HEAD` and diff via `git show <sha>`
   *   3. `git revert --no-edit <sha>` — on conflict: `git revert --abort` then fail
   *   4. `git rm REVIEW.md` (if tracked) + `git commit -m "chore(gtd): close approved review for <short-sha>"`
   *   5. Return `{ diff, recordSha }`
   */
  readonly recordAndRevertReview: (
    base: string,
  ) => Effect.Effect<{ readonly diff: string; readonly recordSha: string }, Error>
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

        lastCommitFiles: () =>
          exec("git", "show", "--name-only", "--pretty=", "HEAD").pipe(
            Effect.map((out) =>
              out
                .split("\n")
                .map((s) => s.trim())
                .filter((s) => s !== ""),
            ),
          ),

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

        diffStatRef: (ref: string) => exec("git", "diff", "--stat", ref, "HEAD"),

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

        lastReviewCommit: () =>
          exec(
            "git",
            "log",
            "-1",
            "--format=%H",
            "--grep=^review\\(gtd\\): create review for",
            "--extended-regexp",
          ).pipe(
            Effect.map((s) => s.trim()),
            Effect.map((hash) => (hash !== "" ? Option.some(hash) : Option.none<string>())),
            Effect.catchAll(() => Effect.succeed(Option.none<string>())),
          ),

        lastCloseCommit: () =>
          exec(
            "git",
            "log",
            "-1",
            "--format=%H",
            "--grep=^chore\\(gtd\\): close approved review for",
            "--extended-regexp",
          ).pipe(
            Effect.map((s) => s.trim()),
            Effect.map((hash) => (hash !== "" ? Option.some(hash) : Option.none<string>())),
            Effect.catchAll(() => Effect.succeed(Option.none<string>())),
          ),

        commitCount: (base: string) =>
          exec("git", "rev-list", "--count", `${base}..HEAD`).pipe(
            Effect.map((s) => parseInt(s.trim(), 10)),
          ),

        isAncestor: (a: string, b: string) =>
          Command.make("git", "merge-base", "--is-ancestor", a, b).pipe(
            Command.exitCode,
            Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
            Effect.mapError((e) => new Error(String(e))),
            Effect.map((code) => code === 0),
          ),

        showHead: (path: string) =>
          Effect.gen(function* () {
            const exitCode = yield* Command.make("git", "show", `HEAD:${path}`).pipe(
              Command.exitCode,
              Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
              Effect.mapError((e) => new Error(String(e))),
            )
            if (exitCode !== 0) {
              return yield* Effect.fail(new Error(`git show HEAD:${path} exited with ${exitCode}`))
            }
            return yield* exec("git", "show", `HEAD:${path}`)
          }),

        recordAndRevertReview: (base: string) =>
          Effect.gen(function* () {
            // 1. Stage everything and create the record commit
            yield* exec("git", "add", "-A")
            yield* exec(
              "git",
              "commit",
              "-m",
              `docs(review): record raw feedback for ${base}`,
            )

            // 2. Capture record SHA and diff
            const recordSha = yield* exec("git", "rev-parse", "HEAD").pipe(
              Effect.map((s) => s.trim()),
            )
            const diff = yield* exec("git", "show", recordSha)

            // 3. Attempt revert — use exitCode to detect conflicts without throwing
            const revertCode = yield* Command.make(
              "git",
              "revert",
              "--no-edit",
              recordSha,
            ).pipe(
              Command.exitCode,
              Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
              Effect.mapError((e) => new Error(String(e))),
            )

            if (revertCode !== 0) {
              // Abort the in-progress revert and fail
              yield* Command.make("git", "revert", "--abort").pipe(
                Command.exitCode,
                Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
                Effect.mapError((e) => new Error(String(e))),
              )
              return yield* Effect.fail(
                new Error(
                  `review-process: revert conflict reverting ${recordSha}; aborted. ` +
                    `Resolve conflicts manually or re-run after cleaning the working tree.`,
                ),
              )
            }

            // 4. Remove REVIEW.md if still tracked, then close commit
            const rmCode = yield* Command.make("git", "rm", "REVIEW.md").pipe(
              Command.exitCode,
              Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
              Effect.mapError((e) => new Error(String(e))),
            )
            if (rmCode === 0) {
              yield* exec(
                "git",
                "commit",
                "-m",
                `chore(gtd): close approved review for ${base.slice(0, 7)}`,
              )
            } else {
              // REVIEW.md not tracked — still create close commit (nothing extra to stage)
              yield* exec(
                "git",
                "commit",
                "--allow-empty",
                "-m",
                `chore(gtd): close approved review for ${base.slice(0, 7)}`,
              )
            }

            return { diff, recordSha }
          }),

        commitSubjects: (base?: string) => {
          const args: [string, ...Array<string>] =
            base !== undefined
              ? ["git", "log", "--first-parent", "--reverse", "--format=%s", `${base}..HEAD`]
              : ["git", "log", "--first-parent", "--reverse", "--format=%s"]
          return exec(...args).pipe(
            Effect.map(
              (out) =>
                out
                  .split("\n")
                  .map((l) => l.trim())
                  .filter((l) => l.length) as ReadonlyArray<string>,
            ),
            // Empty repo (no HEAD) makes `git log` fail; treat as no commits.
            Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<string>)),
          )
        },

        commitMessages: (base?: string) => {
          const args: [string, ...Array<string>] =
            base !== undefined
              ? ["git", "log", "--first-parent", "--reverse", "--format=%B%x00", `${base}..HEAD`]
              : ["git", "log", "--first-parent", "--reverse", "--format=%B%x00"]
          return exec(...args).pipe(
            Effect.map(
              (out) =>
                out
                  .split("\0")
                  .map((m) => m.trim())
                  .filter((m) => m.length > 0) as ReadonlyArray<string>,
            ),
            // Empty repo (no HEAD) makes `git log` fail; treat as no commits.
            Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<string>)),
          )
        },
      }
    }),
  )
}
