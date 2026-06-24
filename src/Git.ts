import { Command, CommandExecutor } from "@effect/platform"
import { Context, Effect, Layer, Option } from "effect"
import type { PendingCommitIntent } from "./Machine.js"

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
  /** Removes the `.gtd/` directory idempotently (no error if absent). */
  readonly removeGtdDir: () => Effect.Effect<void, Error>
  /**
   * Discards working-tree REVIEW.md edits (tolerates untracked), removes it
   * via `git rm` if tracked, then creates a close commit.
   */
  readonly closeReview: (base: string) => Effect.Effect<void, Error>
  /**
   * Stages all changes, unstages `restorePaths` (default ["TODO.md","REVIEW.md"]),
   * also stages the deletion of the commit-intent sentinel and — when
   * `removeLastPackage` is set — `git rm -r` the lowest-numbered remaining
   * `.gtd/NN-…` package dir, then commits with `message` (default
   * `chore(gtd): commit pending changes`). Skips the commit when nothing remains
   * staged after the restores.
   */
  readonly commitPending: (opts?: CommitPendingOptions) => Effect.Effect<void, Error>
}

/**
 * Inputs the edge gathers to derive the content-derived commit message for an
 * intent (see `deriveCommitMessage`). All reads happen in the edge; this struct
 * just carries the already-read facts so the derivation itself stays pure.
 */
export interface CommitMessageInputs {
  /** Selected package's `COMMIT_MSG.md` content (execute). */
  readonly packageCommitMsg?: string
  /** Remaining package count (decompose → N). */
  readonly packageCount?: number
  /** Review base ref (human-review → short sha). */
  readonly base?: string
  /** `TODO.md` content (execute-simple → first heading). */
  readonly todoContent?: string
  /** Current verify attempt number (fix-tests → `Gtd-Test-Fix: <n>` trailer). */
  readonly verifyIteration?: number
}

const firstHeading = (markdown: string): string | undefined => {
  for (const line of markdown.split("\n")) {
    const m = line.match(/^#+\s+(.+?)\s*$/)
    if (m) return m[1]
  }
  return undefined
}

/**
 * Deterministic, edge-side message derivation for the content-derived intents.
 * The machine leaves `message` undefined for these and the edge fills it here:
 *
 *   - `execute`        → the selected package's `COMMIT_MSG.md` verbatim.
 *   - `decompose`      → `plan(gtd): decompose TODO.md into N work packages`.
 *   - `human-review`   → `review(gtd): create review for <short>` (7-char base).
 *   - `execute-simple` → `feat(gtd): <TODO.md first heading>` (deterministic).
 *   - `fix-tests`      → `fix(gtd): apply test fix` PLUS a `Gtd-Test-Fix: <n>`
 *     trailer (load-bearing — the verify/escalate gate counts the trailer).
 *   - `new-todo` / `modified-todo` carry a FIXED message from the machine and
 *     never reach this helper; included for totality.
 */
export const deriveCommitMessage = (
  intent: PendingCommitIntent,
  inputs: CommitMessageInputs,
): string => {
  switch (intent) {
    case "execute": {
      const msg = (inputs.packageCommitMsg ?? "").trim()
      return msg.length > 0 ? msg : "chore(gtd): commit work package"
    }
    case "decompose": {
      const n = inputs.packageCount ?? 0
      return `plan(gtd): decompose TODO.md into ${n} work packages`
    }
    case "human-review": {
      const short = (inputs.base ?? "").slice(0, 7)
      return `review(gtd): create review for ${short}`
    }
    case "execute-simple": {
      const heading = firstHeading(inputs.todoContent ?? "")
      return heading !== undefined ? `feat(gtd): ${heading}` : "feat(gtd): execute simple task"
    }
    case "fix-tests": {
      const n = inputs.verifyIteration ?? 1
      return `fix(gtd): apply test fix\n\nGtd-Test-Fix: ${n}`
    }
    case "new-todo":
    case "modified-todo":
      return "docs(plan): record TODO.md"
  }
}

/** Options for the generalized `commitPending` edge action (see Machine.ts). */
export interface CommitPendingOptions {
  /** Commit subject/body; default `chore(gtd): commit pending changes`. */
  readonly message?: string
  /** Paths to keep uncommitted; default `["TODO.md", "REVIEW.md"]`. */
  readonly restorePaths?: ReadonlyArray<string>
  /** Also remove the lowest-numbered remaining `.gtd/NN-…` package dir. */
  readonly removeLastPackage?: boolean
}

const run = (
  ...args: [string, ...Array<string>]
): Effect.Effect<string, Error, CommandExecutor.CommandExecutor> =>
  Command.make(...args).pipe(
    Command.string,
    Effect.mapError((e) => new Error(String(e))),
  )

/**
 * Commit-intent sentinel path — MUST match `Events.ts` (`COMMIT_INTENT_FILE`).
 * The edge deletes it as part of the disambiguated commit so the dirty tree
 * clears and the loop advances. Top-level (not inside `.gtd/`) so it works for
 * every intent regardless of whether `.gtd/` exists.
 */
const COMMIT_INTENT_FILE = ".gtd-commit-intent"

/**
 * Lowest-numbered remaining `.gtd/NN-…` package directory, or undefined. This is
 * the package `execute` just consumed (packages execute in ordinal order). Pure
 * `ls`-based lookup so it works whether or not the dir is tracked.
 */
const lowestPackageDir = (
  exec: (...args: [string, ...Array<string>]) => Effect.Effect<string, Error>,
): Effect.Effect<string | undefined, Error> =>
  exec("ls", "-1", ".gtd").pipe(
    Effect.map((out) =>
      out
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => /^\d+-/.test(s))
        .sort(),
    ),
    Effect.map((dirs) => (dirs.length > 0 ? `.gtd/${dirs[0]}` : undefined)),
    // No `.gtd/` (ls fails) → nothing to remove.
    Effect.catchAll(() => Effect.succeed<string | undefined>(undefined)),
  )

export class GitService extends Context.Tag("GitService")<GitService, GitOperations>() {
  static Live = Layer.effect(
    GitService,
    Effect.gen(function* () {
      const executor = yield* CommandExecutor.CommandExecutor
      const exec = (...args: [string, ...Array<string>]) =>
        run(...args).pipe(Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)))

      // Shared implementation used by both closeReview and recordAndRevertReview
      const closeReviewImpl = (base: string): Effect.Effect<void, Error> =>
        Effect.gen(function* () {
          // Discard working-tree REVIEW.md edits (tolerate failure if untracked)
          yield* Command.make("git", "checkout", "--", "REVIEW.md").pipe(
            Command.exitCode,
            Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
            Effect.mapError((e) => new Error(String(e))),
            Effect.catchAll(() => Effect.void),
          )
          // Remove REVIEW.md if still tracked, then close commit
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
        })

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

        closeReview: closeReviewImpl,

        removeGtdDir: () => exec("rm", "-rf", ".gtd").pipe(Effect.asVoid),

        commitPending: (opts?: CommitPendingOptions) =>
          Effect.gen(function* () {
            const message = opts?.message ?? "chore(gtd): commit pending changes"
            const restorePaths = opts?.restorePaths ?? ["TODO.md", "REVIEW.md"]

            // When removing the consumed package, find the lowest-numbered
            // remaining `.gtd/NN-…` dir and stage its deletion in this commit.
            if (opts?.removeLastPackage) {
              const dir = yield* lowestPackageDir(exec)
              if (dir !== undefined) {
                // Remove from disk; the `git add -A` below stages the deletion
                // (tracked) or simply records the absence (untracked). Works
                // uniformly without depending on `git rm`'s tracked-only behavior.
                yield* exec("rm", "-rf", "--", dir).pipe(
                  Effect.asVoid,
                  Effect.catchAll(() => Effect.void),
                )
              }
            }

            // Delete the intent sentinel from disk FIRST so the subsequent
            // `git add -A` stages its removal as part of this same commit
            // (works whether the sentinel was tracked or untracked).
            yield* exec("rm", "-f", "--", COMMIT_INTENT_FILE).pipe(
              Effect.asVoid,
              Effect.catchAll(() => Effect.void),
            )
            // Stage all changes (including the sentinel deletion above).
            yield* exec("git", "add", "-A")
            // Unstage the restore paths individually (tolerate failure when not staged)
            for (const path of restorePaths) {
              yield* exec("git", "restore", "--staged", "--", path).pipe(
                Effect.catchAll(() => Effect.void),
              )
            }
            // Check if anything remains staged
            const cachedExitCode = yield* Command.make("git", "diff", "--cached", "--quiet").pipe(
              Command.exitCode,
              Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
              Effect.mapError((e) => new Error(String(e))),
            )
            // exit 0 means nothing staged — skip commit
            if (cachedExitCode === 0) return
            yield* exec("git", "commit", "-m", message)
          }),

        recordAndRevertReview: (base: string) =>
          Effect.gen(function* () {
            // 1. Stage everything and create the record commit
            yield* exec("git", "add", "-A")
            yield* exec("git", "commit", "-m", `docs(review): record raw feedback for ${base}`)

            // 2. Capture record SHA and diff
            const recordSha = yield* exec("git", "rev-parse", "HEAD").pipe(
              Effect.map((s) => s.trim()),
            )
            const diff = yield* exec("git", "show", recordSha)

            // 3. Attempt revert — use exitCode to detect conflicts without throwing
            const revertCode = yield* Command.make("git", "revert", "--no-edit", recordSha).pipe(
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

            // 4. Remove REVIEW.md if still tracked, then close commit (delegated)
            yield* closeReviewImpl(base)

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
