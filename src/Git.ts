import { Command, CommandExecutor } from "@effect/platform"
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Cwd } from "./Cwd.js"

export interface GitReaderOperations {
  /** The subject of `ref`'s commit (`ref` defaults to `HEAD`). */
  readonly lastCommitSubject: (ref?: string) => Effect.Effect<string, Error>
  /** `git log -1 --pretty=%B` — the full commit message (subject + body) of HEAD. Mirrors `lastCommitSubject`'s `--pretty=%s`, but keeps the body — needed to read back a `Gtd-History:` trailer (see `RetainedHistory.ts`'s `parseHistoryTrailer`). */
  readonly lastCommitMessage: () => Effect.Effect<string, Error>
  readonly hasCommits: () => Effect.Effect<boolean, Error>
  readonly resolveRef: (ref: string) => Effect.Effect<string, Error>
  /** `git rev-parse --verify --quiet <ref>` — the ref's hash if it resolves, `Option.none` if it doesn't exist (never fails). Used to detect an open review checkout window (`refs/worktree/gtd/review-head`). */
  readonly readRefOption: (ref: string) => Effect.Effect<Option.Option<string>, Error>
  /** `git merge-base --is-ancestor <a> <b>` — true iff `a` is an ancestor of `b`. Never fails: a non-zero exit (or error) reports `false`. Guards the review window's close against a HEAD that has moved off the reviewed branch. */
  readonly isAncestor: (a: string, b: string) => Effect.Effect<boolean, Error>
  /** `git rev-parse --show-toplevel` — the working-tree root; fails outside a repository. */
  readonly topLevel: () => Effect.Effect<string, Error>
  /**
   * First-parent history from `base..HEAD` (or all commits if no base), oldest→newest.
   * Each entry carries the full commit message, `removedErrors: true` iff that
   * commit's name-status diff contains a deletion (`D`) of `.gtd/ERRORS.md`
   * (or legacy root-level `ERRORS.md` from pre-namespaced history), and
   * `touched` — the repo-root-relative paths the commit's name-status diff
   * mentions (added/modified/deleted/renamed-from/renamed-to). Derived from the
   * SAME `--name-status` git invocation already used for `removedErrors` — no
   * additional per-commit subprocess is spawned.
   * Returns `[]` for an empty repo.
   */
  readonly commitHistory: (base?: string) => Effect.Effect<
    ReadonlyArray<{
      readonly hash: string
      readonly message: string
      readonly removedErrors: boolean
      readonly touched: ReadonlyArray<string>
    }>,
    Error
  >
  /**
   * `git show <ref>:<path>` — the verbatim contents of `path` as it stood at
   * `ref`. Fails when the path does not exist at that ref (callers that expect
   * an absent file — e.g. the review sign-off gate comparing a reviewer's edit
   * against the agent's original — handle it with an explicit `catchAll`).
   */
  readonly readFileAtRef: (ref: string, path: string) => Effect.Effect<string, Error>
  /**
   * The pending working-tree changes vs HEAD, as `{path, status}` pairs —
   * tracked modifications (`git diff --name-status HEAD`) unioned with
   * untracked files (reported as `status: "A"`), deduplicated by path. The
   * v3 pattern machine's `step`/`gtd status` only need the status/path shape,
   * never diff content, for pattern matching.
   */
  readonly changedPaths: () => Effect.Effect<
    ReadonlyArray<{ readonly path: string; readonly status: string }>,
    Error
  >
  /**
   * `git diff --name-status <ref> HEAD` — the paths (and their status) changed
   * across the committed range `ref..HEAD`, with no content pass. The
   * paths-only counterpart of `changedPaths`, used to decide whether a process
   * would retain anything (`Edge.ts`'s `retainsNothing`) without rendering a
   * diff.
   */
  readonly changedPathsSince: (
    ref: string,
  ) => Effect.Effect<ReadonlyArray<{ readonly path: string; readonly status: string }>, Error>
}

export interface GitWriterOperations {
  /**
   * `git add -A` then `git commit --allow-empty -m "<message>"`. `--allow-empty`
   * is load-bearing: the machine emits `commitPending` with a fixed subject even
   * on a clean tree (e.g. `gtd: grilled`), and the uncommitted-FEEDBACK Fixing
   * path can net an empty commit — neither must throw "nothing to commit".
   * `message` is normally the bare `gtd(<actor>): <state>` subject, but may
   * carry a trailing body (a blank line then a `Gtd-Cost: <n>` trailer when
   * `gtd step --cost=<n>` recorded one) — `-m` preserves embedded newlines
   * verbatim, and the subject line is untouched.
   */
  readonly commitAllWithPrefix: (message: string) => Effect.Effect<void, Error>
  readonly softResetTo: (ref: string) => Effect.Effect<void, Error>
  /**
   * `git commit --allow-empty -m <message>` — commits whatever is CURRENTLY
   * STAGED, verbatim, without an implicit `git add` first (unlike
   * `commitAllWithPrefix`). This is the second half of the v3 pattern
   * machine's squash mechanics: after `softResetTo` moves HEAD back without touching the
   * index, a plain commit here re-commits the index exactly as it stood at
   * the pre-reset HEAD — so an UNTRACKED message-template file (never
   * staged) is automatically excluded from the squashed commit's tree.
   * Retries once without the pre-commit hook on the same "empty git commit"
   * hook rejection `commitAllWithPrefix` guards against.
   */
  readonly commitAsIs: (message: string) => Effect.Effect<void, Error>
  /**
   * Discards EVERY pending change, tracked or untracked (`git add -A` then
   * `git reset --hard HEAD`). Instead of leaving untracked survivors like
   * `resetHard`, staging first makes every untracked path "staged-but-new"
   * so the hard reset drops it too. Used to discard a squash's leftover
   * message-template file (and anything else pending) after `commitAsIs`
   * lands the squash commit.
   */
  readonly discardPending: () => Effect.Effect<void, Error>
  /** `git update-ref <ref> <hash>` — point a repo-local ref (e.g. the per-worktree `refs/worktree/gtd/review-head`) at a commit. */
  readonly updateRef: (ref: string, hash: string) => Effect.Effect<void, Error>
  /** `git update-ref -d <ref>` — idempotent: deleting a missing ref is a no-op. */
  readonly deleteRef: (ref: string) => Effect.Effect<void, Error>
  /** `git reset --mixed <ref>` — HEAD and index move to `ref`, the working tree is untouched (so committed work re-surfaces as pending changes). The open/close primitive of the review checkout window. */
  readonly mixedResetTo: (ref: string) => Effect.Effect<void, Error>
  /** `git reset --hard <ref>` — HEAD, the index, AND the working tree all move to `ref` (unlike `softResetTo`/`mixedResetTo`, which leave the working tree — and for `softResetTo` the index too — untouched). */
  readonly hardResetTo: (ref: string) => Effect.Effect<void, Error>
  /**
   * `git restore --staged --source=<source> -- <paths…>` — set the index
   * entries under each path to their state at `source` (including removals),
   * leaving HEAD and the working tree untouched. Tolerant when no path matches.
   * Pins `.gtd/` plumbing back to the real head while the review window is open
   * so it stays out of the surfaced diff.
   */
  readonly restoreStagedFrom: (
    source: string,
    paths: ReadonlyArray<string>,
  ) => Effect.Effect<void, Error>
  /**
   * `git add --intent-to-add .` — register untracked files in the index with
   * an empty placeholder so they render as additions (with content hunks) in
   * `git diff` and editor SCM views, without staging their content.
   */
  readonly addIntentToAdd: () => Effect.Effect<void, Error>
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
    lastCommitSubject: (ref = "HEAD") =>
      exec("git", "log", "-1", "--pretty=%s", ref).pipe(Effect.map((s) => s.trim())),

    lastCommitMessage: () =>
      exec("git", "log", "-1", "--pretty=%B").pipe(Effect.map((s) => s.trim())),

    hasCommits: () =>
      exec("git", "rev-parse", "--verify", "HEAD").pipe(
        Effect.map(() => true),
        Effect.catchAll(() => Effect.succeed(false)),
      ),

    readFileAtRef: (ref: string, path: string) => exec("git", "show", `${ref}:${path}`),

    changedPathsSince: (ref: string) =>
      exec("git", "diff", "--name-status", ref, "HEAD").pipe(Effect.map(parseNameStatus)),

    changedPaths: () =>
      Effect.gen(function* () {
        const nameStatusOut = yield* exec("git", "diff", "--name-status", "HEAD").pipe(
          Effect.catchAll(() => Effect.succeed("")),
        )
        const trackedPaths = parseNameStatus(nameStatusOut)

        const untrackedRaw = yield* exec("git", "ls-files", "--others", "--exclude-standard", "-z")
        const untracked = untrackedRaw
          .split("\0")
          .filter((s) => s.length > 0)
          .map((path) => ({ path, status: "A" }))

        const seen = new Set<string>()
        const all: Array<{ path: string; status: string }> = []
        for (const entry of [...trackedPaths, ...untracked]) {
          if (!seen.has(entry.path)) {
            seen.add(entry.path)
            all.push(entry)
          }
        }
        return all
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

    readRefOption: (ref: string) =>
      exec("git", "rev-parse", "--verify", "--quiet", ref).pipe(
        Effect.map((s) => Option.some(s.trim())),
        Effect.catchAll(() => Effect.succeed(Option.none<string>())),
      ),

    isAncestor: (a: string, b: string) =>
      run(root, "git", "merge-base", "--is-ancestor", a, b).pipe(
        Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
        Effect.map(() => true),
        Effect.catchAll(() => Effect.succeed(false)),
      ),

    topLevel: () => exec("git", "rev-parse", "--show-toplevel").pipe(Effect.map((s) => s.trim())),

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
              // Legacy root-level ERRORS.md kept so pre-namespaced history
              // still classifies (budget resets survive the .gtd/ migration).
              const removedErrors = /^D\t(\.gtd\/)?ERRORS\.md$/m.test(nameStatusBlock)
              const touched = parseNameStatus(nameStatusBlock).map((e) => e.path)
              return { hash, message, removedErrors, touched }
            }),
        ),
        // Empty repo (no HEAD) makes `git log` fail; treat as no commits.
        Effect.catchAll(() =>
          Effect.succeed(
            [] as ReadonlyArray<{
              readonly hash: string
              readonly message: string
              readonly removedErrors: boolean
              readonly touched: ReadonlyArray<string>
            }>,
          ),
        ),
      )
    },

    commitAllWithPrefix: (prefix: string) =>
      Effect.gen(function* () {
        yield* exec("git", "add", "-A")
        yield* exec("git", "commit", "--allow-empty", "-m", prefix).pipe(
          Effect.catchAll((error) =>
            // Hooks like lint-staged block empty commits even with --allow-empty.
            // gtd's workflow commits have nothing for code-quality hooks to validate,
            // so retry without the pre-commit hook when that guard fires.
            error.message.includes("empty git commit")
              ? exec("git", "commit", "--allow-empty", "--no-verify", "-m", prefix)
              : Effect.fail(error),
          ),
        )
      }).pipe(Effect.asVoid),

    softResetTo: (ref: string) => exec("git", "reset", "--soft", ref).pipe(Effect.asVoid),

    commitAsIs: (message: string) =>
      exec("git", "commit", "--allow-empty", "-m", message)
        .pipe(
          Effect.catchAll((error) =>
            error.message.includes("empty git commit")
              ? exec("git", "commit", "--allow-empty", "--no-verify", "-m", message)
              : Effect.fail(error),
          ),
        )
        .pipe(Effect.asVoid),

    discardPending: () =>
      Effect.gen(function* () {
        yield* exec("git", "add", "-A")
        yield* exec("git", "reset", "--hard", "HEAD")
      }).pipe(Effect.asVoid),

    updateRef: (ref: string, hash: string) =>
      exec("git", "update-ref", ref, hash).pipe(Effect.asVoid),

    deleteRef: (ref: string) => exec("git", "update-ref", "-d", ref).pipe(Effect.asVoid),

    mixedResetTo: (ref: string) => exec("git", "reset", "--mixed", ref).pipe(Effect.asVoid),

    hardResetTo: (ref: string) => exec("git", "reset", "--hard", ref).pipe(Effect.asVoid),

    restoreStagedFrom: (source: string, paths: ReadonlyArray<string>) =>
      paths.length === 0
        ? Effect.void
        : exec("git", "restore", "--staged", `--source=${source}`, "--", ...paths).pipe(
            // Tolerant: a path that never existed at `source` (or in the index)
            // makes `git restore` complain — the pin is best-effort plumbing.
            Effect.catchAll(() => Effect.void),
          ),

    addIntentToAdd: () => exec("git", "add", "--intent-to-add", ".").pipe(Effect.asVoid),
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
