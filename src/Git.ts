import { Command, CommandExecutor } from "@effect/platform"
import { Context, Effect, Layer, Option, Stream } from "effect"
import { GtdError } from "./Commentary.js"
import { Cwd } from "./Cwd.js"

export interface GitReaderOperations {
  readonly lastCommitSubject: (ref?: string) => Effect.Effect<string, Error>
  /**
   * Full commit message (subject + body) of HEAD — keeps the body, unlike
   * `lastCommitSubject`. No current caller: it read back a `Gtd-History:`
   * trailer for the now-removed squash finale's `restorability` check; kept
   * deliberately rather than deleted, as a plain, reusable git primitive a
   * future edge concern may need again.
   */
  readonly lastCommitMessage: () => Effect.Effect<string, Error>
  readonly hasCommits: () => Effect.Effect<boolean, Error>
  readonly resolveRef: (ref: string) => Effect.Effect<string, Error>
  /** The ref's hash if it resolves, `Option.none` if it doesn't exist (never fails). Used to read the retained-history ref. */
  readonly readRefOption: (ref: string) => Effect.Effect<Option.Option<string>, Error>
  /** Never fails (a non-zero exit reports `false`). */
  readonly isAncestor: (a: string, b: string) => Effect.Effect<boolean, Error>
  readonly topLevel: () => Effect.Effect<string, Error>
  /**
   * The absolute, per-worktree git directory — not derived from
   * `Cwd.root + "/.git"`, since a linked worktree's `.git` is a FILE pointing
   * elsewhere, and two worktrees looping concurrently must never collide on
   * one file.
   */
  readonly gitDir: () => Effect.Effect<string, Error>
  /**
   * First-parent history from `base..head` (or through `head` if no base),
   * oldest→newest; `head` defaults to `"HEAD"`. Pass a resolved hash to walk a
   * head other than the literal `HEAD`.
   * `removedErrors` is true iff the commit's name-status diff deletes
   * `.gtd/ERRORS.md` (or the legacy root-level path); `touched` lists the
   * paths that diff mentions, from the same git invocation.
   */
  readonly commitHistory: (
    base?: string,
    head?: string,
  ) => Effect.Effect<
    ReadonlyArray<{
      readonly hash: string
      readonly message: string
      readonly removedErrors: boolean
      readonly touched: ReadonlyArray<string>
    }>,
    Error
  >
  /** Fails when the path doesn't exist at `ref` — a caller expecting that (e.g. the review sign-off gate) handles it with an explicit `catchAll`. */
  readonly readFileAtRef: (ref: string, path: string) => Effect.Effect<string, Error>
  /**
   * Pending working-tree changes vs `base` (default `HEAD`), as
   * `{path, status}` pairs: tracked diff unioned with untracked files.
   *
   * `base` exists for one caller — `StepGuards.ts`'s `requireRevertGuard`,
   * which compares the current tree against `reviewBase~1`. An untracked path
   * is classified by CONTENT against `base`, not the index (see
   * `classifyUntracked`): reporting the index's view instead would call a
   * present-but-untracked file `D` (deleted) whenever the index doesn't match
   * the working tree. A REAL deletion still reports `D`: it's absent from the
   * untracked list, so the tracked diff's own `D` stands.
   */
  readonly changedPaths: (
    base?: string,
  ) => Effect.Effect<ReadonlyArray<{ readonly path: string; readonly status: string }>, Error>
}

export interface GitWriterOperations {
  /**
   * `git add -A` then commit. `--allow-empty` is load-bearing: the machine
   * emits a fixed subject even on a clean tree, and neither that nor an
   * empty feedback-fixing commit must throw "nothing to commit". `message`
   * may carry a trailing `Gtd-Cost:` trailer body — `-m` preserves embedded
   * newlines verbatim.
   */
  readonly commitAllWithPrefix: (message: string) => Effect.Effect<void, Error>
  /**
   * `git reset --soft <ref>` — moves HEAD (and only HEAD; index/worktree stay
   * put). No current caller: it was the first half of the now-removed squash
   * finale, kept on the port deliberately rather than deleted, since it's a
   * plain, reusable git primitive a future edge concern may need again.
   */
  readonly softResetTo: (ref: string) => Effect.Effect<void, Error>
  /**
   * Commits whatever is CURRENTLY STAGED, without an implicit `git add` first
   * (unlike `commitAllWithPrefix`). No current caller: it paired with
   * `softResetTo` as the squash finale's second half (re-committing the
   * pre-reset index verbatim); kept for the same reason `softResetTo` is.
   * Retries once without the pre-commit hook, same as `commitAllWithPrefix`.
   */
  readonly commitAsIs: (message: string) => Effect.Effect<void, Error>
  /**
   * Discards every pending change, tracked or untracked, by staging first
   * (`git add -A`) so the hard reset also drops untracked survivors. No
   * current caller: it discarded the squash finale's leftover
   * message-template file after `commitAsIs` landed; kept for the same
   * reason `softResetTo` is.
   */
  readonly discardPending: () => Effect.Effect<void, Error>
  readonly updateRef: (ref: string, hash: string) => Effect.Effect<void, Error>
  /** Idempotent: deleting a missing ref is a no-op. */
  readonly deleteRef: (ref: string) => Effect.Effect<void, Error>
  /** Used by `gtd abandon`'s reset. */
  readonly mixedResetTo: (ref: string) => Effect.Effect<void, Error>
  readonly hardResetTo: (ref: string) => Effect.Effect<void, Error>
}

export interface GitOperations extends GitReaderOperations, GitWriterOperations {}

const splitNul = (out: string): Array<string> => out.split("\0").filter((s) => s.length > 0)

/**
 * Parse a `git diff --name-status -z` token stream into `{ path, status }`
 * pairs. Statuses are identified by POSITION, never shape, so a file legally
 * named e.g. `M` is never misread as a status token. A rename/copy status is
 * followed by two paths; expanded into a deletion of the old one and an
 * addition of the new one.
 */
const parseNameStatus = (
  tokens: ReadonlyArray<string>,
): Array<{ path: string; status: string }> => {
  const result: Array<{ path: string; status: string }> = []
  let i = 0
  while (i < tokens.length) {
    const status = tokens[i]!
    i += 1
    if (status.startsWith("R") || status.startsWith("C")) {
      const oldPath = tokens[i]
      const newPath = tokens[i + 1]
      i += 2
      if (oldPath !== undefined) result.push({ path: oldPath, status: "D" })
      if (newPath !== undefined) result.push({ path: newPath, status: "A" })
    } else {
      const path = tokens[i]
      i += 1
      if (path !== undefined) result.push({ path, status: status[0]! })
    }
  }
  return result
}

/**
 * `git log -z --format=…` NUL-terminates the commit entry in place of the
 * blank line before its diff, and (when a diff follows) still emits that
 * blank line's own newline byte literally. Both are seam artifacts, not diff
 * data — stripped here before `splitNul`/`parseNameStatus`.
 */
const stripCommitSeam = (tail: string): string => {
  const afterNul = tail.startsWith("\x00") ? tail.slice(1) : tail
  return afterNul.startsWith("\n") ? afterNul.slice(1) : afterNul
}

/** The two spellings of the errors file a commit's deletion of it may carry — the namespaced state-dir path, and the legacy root-level one from pre-`.gtd/` history. */
const ERRORS_MD_PATHS: ReadonlySet<string> = new Set([".gtd/ERRORS.md", "ERRORS.md"])

type GitExec = (...args: [string, ...Array<string>]) => Effect.Effect<string, Error>

/**
 * `path → blob object id` at `ref`; a path absent from the map doesn't exist
 * there. An unresolvable `ref` (an empty repo) yields an empty map, so every
 * candidate reads as "not at `ref`".
 */
const blobsAtRef = (
  exec: GitExec,
  ref: string,
  paths: ReadonlyArray<string>,
): Effect.Effect<Map<string, string>, Error> =>
  exec("git", "ls-tree", "-r", "-z", ref, "--", ...paths).pipe(
    Effect.catchAll(() => Effect.succeed("")),
    Effect.map((out) => {
      const blobs = new Map<string, string>()
      for (const entry of splitNul(out)) {
        const tab = entry.indexOf("\t")
        if (tab === -1) continue
        const [, type, oid] = entry.slice(0, tab).split(" ")
        if (type === "blob" && oid !== undefined) blobs.set(entry.slice(tab + 1), oid)
      }
      return blobs
    }),
  )

/**
 * `path → object id` for every path's CURRENT bytes, in one call. An empty
 * map on failure (an unreadable file) — every candidate then reads as
 * "differs", the safe direction, since a file that EXISTS must never be
 * reported deleted.
 *
 * These ids are directly comparable with `git ls-tree`'s because hash-object
 * applies the repo's own CLEAN FILTERS. NEVER add `--no-filters` here: a
 * `text=auto` repo's untouched CRLF file would then report `M` — a spurious
 * "the human edited something real" that flips a clean sign-off onto the
 * feedback edge and fabricates a change for any `on` pattern to match. Both
 * tiers of the `changedPaths` contract pin this (`src/testing/GitTiers.ts`).
 *
 * A symlink is the one residual inexactness: hash-object hashes the target's
 * content rather than the link text git stores, and reads as `M`, never `D`.
 */
const hashObjects = (
  exec: GitExec,
  paths: ReadonlyArray<string>,
): Effect.Effect<Map<string, string>, Error> =>
  exec("git", "hash-object", "--", ...paths).pipe(
    Effect.map(
      (out) =>
        new Map(
          out
            .trim()
            .split("\n")
            .map((oid, i) => [paths[i] ?? "", oid.trim()] as const),
        ),
    ),
    Effect.catchAll(() => Effect.succeed(new Map<string, string>())),
  )

/**
 * Classify every untracked path against `ref`'s tree, by CONTENT: not at
 * `ref` → `A`; different bytes → `M`; identical bytes → no entry. The latter
 * two exist because "untracked" does not mean "new": against a `ref` older
 * than HEAD, a path can be absent from the index yet already present in
 * `ref`'s tree with the same or different bytes. "Different bytes" goes
 * through `hashObjects`'s clean filters, matching how git itself
 * decides it, so an untouched `text=auto` file is never over-reported `M`.
 */
const classifyUntracked = (
  exec: GitExec,
  ref: string,
  untrackedPaths: ReadonlyArray<string>,
): Effect.Effect<Array<{ path: string; status: string }>, Error> =>
  Effect.gen(function* () {
    const atRef = yield* blobsAtRef(exec, ref, untrackedPaths)
    const candidates = untrackedPaths.filter((path) => atRef.has(path))
    const onDisk =
      candidates.length === 0 ? new Map<string, string>() : yield* hashObjects(exec, candidates)
    return untrackedPaths.flatMap((path) => {
      const at = atRef.get(path)
      if (at === undefined) return [{ path, status: "A" }]
      return onDisk.get(path) === at ? [] : [{ path, status: "M" }]
    })
  })

/**
 * Run a command and return its stdout — FAILING on a non-zero exit code with
 * the command line and stderr in the error message. `Command.string` alone
 * silently ignores exit codes, which used to make gtd report success on
 * rejected commits and lose files whose quoted paths broke a swallowed
 * `git add`. Callers that expect a probe to fail handle it with an explicit
 * `catchAll`.
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

/**
 * `resolveRef`'s validation for when `git rev-parse --verify <ref>` exits
 * zero but its stdout isn't a 40-hex-char hash — a corrupted ref, not a
 * missing one. A separate pure function so this rare branch is unit-testable
 * without a real git repository contriving the condition.
 */
export const resolvedRefOrCorrupted = (
  ref: string,
  hash: string,
): Effect.Effect<string, GtdError> =>
  /^[0-9a-f]{40}$/.test(hash)
    ? Effect.succeed(hash)
    : Effect.fail(new GtdError(`Invalid ref: ${ref}`, [`ref: ${ref}`]))

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

    changedPaths: (base?: string) =>
      Effect.gen(function* () {
        const ref = base ?? "HEAD"
        // Tolerates the empty-repo case (no HEAD), where the diff has no ref
        // to compare against and reports no tracked changes.
        const nameStatusOut = yield* exec("git", "diff", "--name-status", "-z", ref).pipe(
          Effect.catchAll(() => Effect.succeed("")),
        )
        const trackedPaths = parseNameStatus(splitNul(nameStatusOut))

        const untrackedRaw = yield* exec("git", "ls-files", "--others", "--exclude-standard", "-z")
        const untrackedPaths = splitNul(untrackedRaw)
        // Nothing untracked: the index-based diff above already IS the answer,
        // and the two classification reads below are not paid for at all.
        if (untrackedPaths.length === 0) return trackedPaths

        const untrackedChanges = yield* classifyUntracked(exec, ref, untrackedPaths)

        // The untracked classification OVERRIDES the tracked diff for its own
        // paths: `git diff --name-status <ref>` compares `ref` to the INDEX, so
        // a path the index no longer carries reports `D` even while sitting
        // right there on disk — a phantom deletion, not a real one.
        const untrackedSet = new Set(untrackedPaths)
        const seen = new Set<string>()
        const all: Array<{ path: string; status: string }> = []
        for (const entry of [
          ...trackedPaths.filter((e) => !untrackedSet.has(e.path)),
          ...untrackedChanges,
        ]) {
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
        Effect.flatMap((hash) => resolvedRefOrCorrupted(ref, hash)),
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

    gitDir: () => exec("git", "rev-parse", "--absolute-git-dir").pipe(Effect.map((s) => s.trim())),

    commitHistory: (base?: string, head = "HEAD") => {
      const range = base !== undefined ? `${base}..${head}` : head !== "HEAD" ? head : undefined
      const args: [string, ...Array<string>] = [
        "git",
        "log",
        "--first-parent",
        "--reverse",
        "-z",
        "--format=%x01%H%x02%B%x02",
        "--name-status",
        ...(range !== undefined ? [range] : []),
      ]
      return exec(...args).pipe(
        Effect.map((out) =>
          out
            .split("\x01")
            .filter((chunk) => chunk.length > 0)
            .map((chunk) => {
              const parts = chunk.split("\x02")
              const hash = (parts[0] ?? "").trim()
              const message = (parts[1] ?? "").trim()
              // A literal \x02 byte inside the commit message (the documented
              // residual risk) would otherwise silently drop the extra split
              // pieces — rejoining keeps that failure mode no worse than
              // before, without pretending to fix it.
              const tail = parts.slice(2).join("")
              const entries = parseNameStatus(splitNul(stripCommitSeam(tail)))
              const removedErrors = entries.some(
                (e) => e.status === "D" && ERRORS_MD_PATHS.has(e.path),
              )
              const touched = entries.map((e) => e.path)
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
