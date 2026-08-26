// POSIX single-quote escaping for a shell command; every builder below routes its interpolated values through this.
export const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

export const pathspec = (paths: ReadonlyArray<string>): string => paths.map(shellQuote).join(" ")

/**
 * `--allow-empty` because gtd's workflow commits may be empty on purpose.
 * Mirrors `Git.ts`'s retry: only re-tries without hooks on the specific
 * "empty git commit" rejection message, discriminated from the captured
 * output rather than the exit code, so a genuinely rejected commit (a lint
 * error, a commit-msg hook) still fails.
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

/** `git add -A` then `commitAllowEmpty`, joined with `&&` so a failing `git add` never reaches the commit. */
export const commitAll = (message: string): string => `git add -A &&\n${commitAllowEmpty(message)}`

/** No current caller — see `Git.ts`'s `GitWriterOperations.commitAsIs` for why it's kept anyway. */
export const commitAsIs = (message: string): string => commitAllowEmpty(message)

/** No current caller — see `Git.ts`'s `GitWriterOperations.softResetTo` for why it's kept anyway. */
export const softResetTo = (ref: string): string => `git reset --soft ${shellQuote(ref)}`

export const mixedResetTo = (ref: string): string => `git reset --mixed ${shellQuote(ref)}`

export const hardResetTo = (ref: string): string => `git reset --hard ${shellQuote(ref)}`

/**
 * `git add -A` then `git reset --hard HEAD` — discards every pending change,
 * tracked or untracked. Joined with `&&`: a failed stage must not reach the
 * hard reset, or untracked survivors remain — the exact outcome this builder
 * exists to avoid. No current caller — see `Git.ts`'s
 * `GitWriterOperations.discardPending` for why it's kept anyway.
 */
export const discardPending = (): string => `git add -A && git reset --hard HEAD`

export const updateRef = (ref: string, hash: string): string =>
  `git update-ref ${shellQuote(ref)} ${shellQuote(hash)}`

/** `git update-ref -d <ref>` — idempotent: deleting a missing ref is already a no-op in real git. */
export const deleteRef = (ref: string): string => `git update-ref -d ${shellQuote(ref)}`
