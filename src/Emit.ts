import { shellQuote } from "./GitScript.js"
import { OUTCOME_PREAMBLE } from "./OutcomeScript.js"

export interface EmittedScripts {
  readonly required: string
  readonly optional: string
}

export interface EmitPreconditions {
  /**
   * The HEAD the deciding read resolved (`""` for an empty repo, mirroring
   * `rest.context.currentCommit`). Omitted for a script meant to run AFTER
   * another one already moved HEAD, whose expected HEAD (the commit
   * `required` is about to create) can't be known at decide time; that script
   * resolves `HEAD` itself at run time instead.
   */
  readonly expectedHead?: string
}

/**
 * `gitWrite` (routed through the retry helper below) vs. plain `command`
 * (never retry-wrapped — retrying it could match "index.lock" wording
 * appearing incidentally in its own output) vs. `outcome` (a
 * `src/OutcomeScript.ts` builder's call, rendered verbatim like `command`).
 */
export type EmitStep =
  | { readonly kind: "gitWrite"; readonly command: string }
  | {
      readonly kind: "command"
      readonly command: string
      /**
       * Prompt text printed (with the command's captured output) on a
       * non-zero exit before propagating that exit code. Omitted for a step
       * that should fail raw — e.g. a `format:` command's own broken-tooling
       * failure, which an agent can't fix by editing the steering file.
       */
      readonly onFailure?: string
    }
  | { readonly kind: "outcome"; readonly command: string }

/**
 * Closes the time-of-check/time-of-use gap between the CLI resolving
 * `expectedHead` at decide time and the script running later in an unrelated
 * process. A plain `[ ... ] || { ...; exit 1; }`, not `if`/`fi`, so it stays
 * safe under `set -e` (an OR list's left side failing never trips `-e` on its
 * own). Exported so `src/testing/EmittedScriptRecognizer.ts` can re-derive
 * and string-compare this exact shape.
 *
 * The probe is `--verify --quiet`, not bare `git rev-parse HEAD` — load-
 * bearing: against an unborn HEAD (no commits), the bare form prints the
 * literal string `"HEAD"` and exits 128, so it could never match an
 * `expectedHead === ""` comparison. `--verify --quiet` reads an unborn HEAD
 * back as an empty string instead.
 */
export const headAssertion = (expectedHead: string): string => {
  const q = shellQuote(expectedHead)
  const probe = `[ "$(git rev-parse --verify --quiet HEAD 2>/dev/null)" = ${q} ] || `
  return (
    probe +
    `{ printf 'gtd: repository changed since this script was generated ` +
    `(expected HEAD %s) — re-run gtd\\n' ${q} >&2; exit 1; }`
  )
}

/**
 * `resolveValidateScript`'s guard: when the declared steering file is absent
 * (e.g. before the producing agent has written it at all), there's nothing
 * to format or validate, so the script exits 0 cleanly rather than running
 * the mode's commands against a missing file. An OR list, not `if`, for the
 * same `set -eu` safety `headAssertion` documents.
 */
export const fileExistsGuard = (file: string): string => `[ -f ${shellQuote(file)} ] || exit 0`

/**
 * Wraps `command` so a non-zero exit prints `prompt` plus the command's
 * captured output before propagating that exit code. The `{ … }` group lets
 * a multi-line `command` be inlined verbatim; the assignment sits on the
 * left of `||` so `set -e` never trips on the failing command itself.
 */
export const failurePromptWrapper = (command: string, prompt: string): string => {
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

/**
 * `gtd_retry` `eval`s one already-`shellQuote`d command, mirroring
 * `src/Git.ts`'s `withIndexLockRetry`: retry only on the same two
 * `isIndexLockError` substrings, jittered exponential backoff (~10ms
 * doubling, 6 total attempts), propagating any other failure immediately.
 * `awk` (not the shell — no fractional `sleep`, and no `$RANDOM` under POSIX
 * `sh`/`dash`) computes both the fractional-second delay and its own jitter
 * deterministically, so no external entropy source is needed. POSIX `sh` has
 * no `local`, so every variable is `gtd_`-prefixed and `unset` before each
 * `return` to avoid leaking into the rest of the assembled script.
 */
const RETRY_HELPER = [
  `gtd_retry() {`,
  `  gtd_cmd=$1`,
  `  gtd_attempt=1`,
  `  gtd_delay_ms=10`,
  `  while true; do`,
  `    if gtd_out=$(eval "$gtd_cmd" 2>&1); then`,
  `      [ -n "$gtd_out" ] && printf '%s\\n' "$gtd_out"`,
  `      unset gtd_cmd gtd_attempt gtd_delay_ms gtd_out gtd_total_ms`,
  `      return 0`,
  `    fi`,
  `    case "$gtd_out" in`,
  `      *"index.lock"*|*"Another git process seems to be running"*) ;;`,
  `      *)`,
  `        printf '%s\\n' "$gtd_out" >&2`,
  `        unset gtd_cmd gtd_attempt gtd_delay_ms gtd_out gtd_total_ms`,
  `        return 1`,
  `        ;;`,
  `    esac`,
  `    if [ "$gtd_attempt" -ge 6 ]; then`,
  `      printf '%s\\n' "$gtd_out" >&2`,
  `      unset gtd_cmd gtd_attempt gtd_delay_ms gtd_out gtd_total_ms`,
  `      return 1`,
  `    fi`,
  `    gtd_total_ms=$(awk -v attempt="$gtd_attempt" -v ms="$gtd_delay_ms" 'BEGIN { jitter = (attempt * 2654435761) % ms + 1; printf "%.3f", (ms + jitter) / 1000 }')`,
  `    sleep "$gtd_total_ms"`,
  `    gtd_delay_ms=$(( gtd_delay_ms * 2 ))`,
  `    gtd_attempt=$(( gtd_attempt + 1 ))`,
  `  done`,
  `}`,
].join("\n")

const renderStep = (step: EmitStep): string => {
  if (step.kind === "gitWrite") return `gtd_retry ${shellQuote(step.command)}`
  if (step.kind === "command" && step.onFailure !== undefined) {
    return failurePromptWrapper(step.command, step.onFailure)
  }
  return step.command
}

const assembleScript = (
  preconditions: EmitPreconditions,
  steps: ReadonlyArray<EmitStep>,
): string => {
  if (steps.length === 0) return ""

  const sections: Array<string> = ["set -eu"]
  if (preconditions.expectedHead !== undefined) {
    sections.push(headAssertion(preconditions.expectedHead))
  }
  if (steps.some((step) => step.kind === "gitWrite")) {
    sections.push(RETRY_HELPER)
  }
  if (steps.some((step) => step.kind === "outcome")) {
    sections.push(OUTCOME_PREAMBLE)
  }
  sections.push(...steps.map(renderStep))

  return sections.join("\n\n")
}

/** Build both halves from already-rendered command strings; an empty (or omitted) array produces the empty-string result, so a driver checking `if [ -n "$required" ]` never has to special-case a bare preamble. */
export const emitScripts = (
  preconditions: EmitPreconditions,
  required: ReadonlyArray<EmitStep> = [],
  optional: ReadonlyArray<EmitStep> = [],
): EmittedScripts => ({
  required: assembleScript(preconditions, required),
  optional: assembleScript(preconditions, optional),
})

/** Exported so `src/testing/EmittedScriptRecognizer.ts` can recognize these by exact string comparison. `printf`, not `echo`, avoids shell-specific backslash-escape quirks. */
export const DID_NOT_RUN_COMMENT =
  "# gtd emitted this and did NOT run it — pipe it into `sh` to land the turn"

export const PRESENTATION_ONLY_COMMENT = "# presentation only — safe to skip"

export const PRESENTATION_FAILURE_WARNING =
  "printf 'gtd: presentation-only follow-up failed — continuing\\n' >&2"

/**
 * A write command's single pasteable script (`gtd abandon | sh`,
 * `gtd land --sh`'s own `gtd_script` field). `optional`, when non-empty, is
 * wrapped in a subshell whose failure is swallowed — presentation-only, so it
 * must never turn a landed turn into a non-zero exit.
 */
export const combinedScript = (required: string, optional: string): string => {
  if (required.length === 0) return ""
  if (optional.length === 0) return `${DID_NOT_RUN_COMMENT}\n\n${required}`
  return [
    DID_NOT_RUN_COMMENT,
    "",
    required,
    "",
    PRESENTATION_ONLY_COMMENT,
    `(\n${optional}\n) || ${PRESENTATION_FAILURE_WARNING}`,
  ].join("\n")
}
