import type { GitWrite, LandStep, Outcome } from "./step/index.js"

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

// ── ScriptSurface: LandStep[] → shell ────────────────────────────────────────
//
// The sole place `src/step/`'s `LandStep` data becomes runnable shell text.
// Deliberately does NOT import `src/OutcomeScript.ts`/`src/Emit.ts` (both
// import `shellQuote` from this file already) — a reverse import back into
// either would be a real cycle, not just a lint nit, so the two `printf`
// builders below are a small, load-bearing duplication of
// `OutcomeScript.ts`'s `transitionOutcome`/`commitOutcome`, not shared code.
// No test asserts the two stay byte-identical; a drift between them is a
// review-time risk this boundary accepts.

/** Marks an emitted block as print-only — mirrors `OutcomeScript.ts`'s `OUTCOME_MARKER` verbatim, so `src/testing/EmittedScriptRecognizer.ts` recognizes either path's output identically. */
const OUTCOME_MARKER = "# gtd: outcome (print-only)"

const printfLine = (fmt: string, args: readonly string[]): string =>
  `${OUTCOME_MARKER}\nprintf ${shellQuote(fmt.replace(/\n/g, "\\n"))} ${args.join(" ")}`

const renderOutcome = (outcome: Outcome): string => {
  switch (outcome.kind) {
    case "transition":
      return printfLine("%s %s → %s\n", ["'->'", shellQuote(outcome.from), shellQuote(outcome.to)])
    case "commit":
      return printfLine("%s %s\n", ["'[commit]'", shellQuote(outcome.subject)])
    case "note":
      return printfLine("%s\n", [shellQuote(outcome.text)])
  }
}

const renderGitWrite = (write: GitWrite): string => {
  switch (write.kind) {
    case "commitAll":
      return commitAll(write.message)
  }
}

/**
 * Wraps `command` so a non-zero exit prints `prompt` plus the command's
 * captured output before propagating that exit code — mirrors `Emit.ts`'s
 * `failurePromptWrapper` (same reverse-import concern as `renderOutcome`
 * above: `Emit.ts` imports `shellQuote` from here already).
 */
const failurePromptWrapper = (command: string, prompt: string): string => {
  const promptQ = shellQuote(prompt)
  return [
    `gtd_validate_status=0`,
    `gtd_validate_out="$( {`,
    command,
    `} 2>&1 )" || gtd_validate_status=$?`,
    `if [ "$gtd_validate_status" -ne 0 ]; then`,
    `  printf '%s\\n\\n%s\\n' ${promptQ} "$gtd_validate_out"`,
    `  exit "$gtd_validate_status"`,
    `fi`,
  ].join("\n")
}

const renderLandStep = (step: LandStep): string => {
  if (step.kind === "gitWrite") return renderGitWrite(step.write)
  if (step.kind === "outcome") return renderOutcome(step.outcome)
  if (step.kind === "uncheck") return `gtd uncheck ${shellQuote(step.file)}`
  return step.onFailure !== undefined
    ? failurePromptWrapper(step.command, step.onFailure)
    : step.command
}

/**
 * A rendered landing script — a plain `string` at runtime, constructible only
 * by `ScriptSurface.render`, so a bare string cannot reach `gtd land`'s
 * emitted output by construction.
 */
export type RunnableScript = string & { readonly guarded: unique symbol }

export const ScriptSurface = {
  render: (steps: readonly LandStep[]): RunnableScript => {
    const rendered = steps.map(renderLandStep)
    return (rendered.length === 0 ? "" : ["set -eu", ...rendered].join("\n\n")) as RunnableScript
  },
}
