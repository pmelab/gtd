/**
 * Bash-script builders mirroring `GitWriterOperations` (`src/Git.ts`) — one
 * function per writer method, each returning the equivalent bash as a
 * `string` instead of executing it. Scaffolding for a later change that will
 * emit these scripts rather than run git directly through the `Effect`
 * `CommandExecutor`; nothing calls this module yet.
 *
 * Pure, like `src/PatternMachine.ts`: no git, no filesystem, no `Effect`, no
 * IO of any kind. Every export is a plain, total function of its arguments.
 * `src/Git.ts`'s doc comments on `GitWriterOperations` are the source of
 * truth for each shape below; read them for WHY, not just WHAT.
 */

/**
 * POSIX single-quote escaping: wrap `value` in `'...'`, replacing every
 * embedded `'` with `'\''` (close quote, escaped literal quote, reopen
 * quote). The only place a raw string may reach a shell command in this
 * module — every builder below routes every interpolated value through this.
 */
export const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

/**
 * `--allow-empty` mirrors `commitAllWithPrefix`/`commitAsIs`'s load-bearing
 * use in `src/Git.ts`: gtd's workflow commits may be empty on purpose. The
 * retry-without-hooks behavior there keys off the specific "empty git commit"
 * hook-rejection message, re-failing on anything else (`src/Git.ts`'s `run`
 * doc comment records the regression a blind retry-on-any-failure would
 * reintroduce: reporting success on a genuinely rejected commit — a lint
 * error, a rejected commit-msg hook). Bash CAN inspect the message: capture
 * the first attempt's combined output and discriminate on it in a `case`,
 * exactly like `isIndexLockError`/`error.message.includes(...)` do in
 * `src/Git.ts`, instead of retrying on the exit code alone.
 */
const commitAllowEmpty = (message: string): string => {
  const m = shellQuote(message)
  return [
    `if ! out=$(git commit --allow-empty -m ${m} 2>&1); then`,
    `  case "$out" in`,
    `    *"empty git commit"*) git commit --allow-empty --no-verify -m ${m} ;;`,
    `    *) printf '%s\\n' "$out" >&2; exit 1 ;;`,
    `  esac`,
    `fi`,
  ].join("\n")
}

/**
 * `git add -A` then `git commit --allow-empty -m <message>`, retried without
 * hooks on the same hook rejection `commitAllowEmpty` guards against. Joined
 * with `&&` so a failing `git add` (e.g. a quoted path breaking it) never
 * reaches the commit — the same "lost files whose quoted paths broke a
 * swallowed `git add`" failure mode `src/Git.ts`'s `run` doc comment records.
 */
export const commitAll = (message: string): string => `git add -A &&\n${commitAllowEmpty(message)}`

/** `git commit --allow-empty -m <message>` — commits the index as-is, no implicit `git add`. */
export const commitAsIs = (message: string): string => commitAllowEmpty(message)

/** `git reset --soft <ref>` — HEAD moves; index and working tree untouched. */
export const softResetTo = (ref: string): string => `git reset --soft ${shellQuote(ref)}`

/** `git reset --mixed <ref>` — HEAD and index move; working tree untouched. */
export const mixedResetTo = (ref: string): string => `git reset --mixed ${shellQuote(ref)}`

/** `git reset --hard <ref>` — HEAD, index, AND working tree all move. */
export const hardResetTo = (ref: string): string => `git reset --hard ${shellQuote(ref)}`

/**
 * `git add -A` then `git reset --hard HEAD` — discards every pending change,
 * tracked or untracked. Joined with `&&`: a failed stage must not reach the
 * hard reset, or untracked survivors remain — the exact outcome this builder
 * exists to avoid.
 */
export const discardPending = (): string => `git add -A && git reset --hard HEAD`

/** `git update-ref <ref> <hash>` — point a repo-local ref at a commit. */
export const updateRef = (ref: string, hash: string): string =>
  `git update-ref ${shellQuote(ref)} ${shellQuote(hash)}`

/** `git update-ref -d <ref>` — idempotent: deleting a missing ref is already a no-op in real git. */
export const deleteRef = (ref: string): string => `git update-ref -d ${shellQuote(ref)}`

/**
 * `git restore --staged --source=<source> -- <paths…>` — tolerant of the
 * SAME two cases `src/Git.ts`'s `Effect.catchIf` tolerates (a missing ref, or
 * no path matching at `source`), and NOT tolerant of `index.lock` contention,
 * which must still fail the script rather than being swallowed here (see
 * `src/Git.ts`'s `restoreStagedFrom` doc comment and `isIndexLockError`) — a
 * lock failure silently swallowed here would mean the `.gtd/` index pin
 * silently doesn't happen, leaking `.gtd/` plumbing into the surfaced review
 * diff, the exact thing the pin exists to prevent. Captures the command's
 * output and discriminates on it, mirroring `isIndexLockError`'s two
 * substrings, exactly like `commitAllowEmpty` above. An empty `paths` emits
 * nothing at all (a harmless, syntactically valid empty script), mirroring
 * the Effect implementation's own `paths.length === 0` skip.
 */
export const restoreStagedFrom = (source: string, paths: ReadonlyArray<string>): string => {
  if (paths.length === 0) return ""
  const pathArgs = paths.map(shellQuote).join(" ")
  return [
    `if ! out=$(git restore --staged --source=${shellQuote(source)} -- ${pathArgs} 2>&1); then`,
    `  case "$out" in`,
    `    *"index.lock"*|*"Another git process seems to be running"*) printf '%s\\n' "$out" >&2; exit 1 ;;`,
    `    *) : ;;`,
    `  esac`,
    `fi`,
  ].join("\n")
}
