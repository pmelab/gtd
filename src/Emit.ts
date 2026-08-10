/**
 * Assembles the two scripts a `gtd next`-time decision hands the external
 * driver: `required` (everything that decides what lands in git) and
 * `optional` (presentation only — e.g. opening the review checkout window so
 * an editor's diff view has something to show; a driver that skips it loses
 * nothing but that view). Pure, like `src/GitScript.ts`: no git, no
 * filesystem, no `Effect`. Every input string (a `GitScript.ts` builder's
 * output, a steering mode's already-rendered `format:`/`validate:` command)
 * arrives already rendered — this module only concatenates and wraps.
 *
 * Both halves are meant to stand alone: a driver may run either, both, or
 * only `required`, and a person could paste either into a terminal. That's
 * why each carries its OWN copy of the precondition asserts and the retry
 * helper, rather than the two sharing one preamble a caller has to splice
 * together correctly.
 */

import { shellQuote } from "./GitScript.js"

export interface EmittedScripts {
  readonly required: string
  readonly optional: string
}

export interface EmitPreconditions {
  /**
   * The HEAD the deciding read resolved. OMITTED for a script that is meant
   * to run AFTER another one already moved HEAD — the `optional` half of a
   * step that commits and then opens a review window is the one such case:
   * its own expected HEAD is the commit the `required` half is about to
   * create, a hash no one can know at decide time. Asserting the pre-commit
   * hash there would fail the open every single time. Nothing is lost by
   * omitting it: the open script is presentation-only, re-runnable, and
   * resolves `HEAD` itself at run time.
   */
  readonly expectedHead?: string
  readonly reviewWindow?: { readonly ref: string; readonly expectedHash: string }
}

/**
 * A step that IS a git index write (`gitWrite`, routed through the retry
 * helper below) vs. a plain `command` (a steering mode's `format:`/
 * `validate:` line, a `gtd check` script) that never touches git's index and
 * must NOT be retry-wrapped — wrapping a non-git command would silently retry
 * on any output that happens to contain the lock wording, e.g. a check whose
 * own diff mentions "index.lock" in prose.
 */
export type EmitStep =
  | { readonly kind: "gitWrite"; readonly command: string }
  | { readonly kind: "command"; readonly command: string }

/**
 * The CLI resolves `expectedHead` (and a review window's `expectedHash`) at
 * DECIDE time; the script may RUN later, in a process that never shared
 * memory with the one that decided. This assertion closes that
 * time-of-check/time-of-use gap. A plain `[ ... ] || { ...; exit 1; }`
 * statement, not an `if`/`fi` block, so a line-oriented consumer can still
 * recognize it, and so it stays safe under `set -e`: in an OR list, `-e`
 * exempts every command except the LAST one, so the left-hand `[ ... ]`
 * failing here never trips `set -e` on its own — only the explicit `exit 1`
 * inside the right-hand group does. Exported (alongside `reviewWindowAssertion`)
 * solely so `src/testing/EmittedScriptRecognizer.ts` can re-derive and
 * string-compare this exact shape, the same "call the real builder, never
 * hand-copy its template" discipline it already applies to every
 * `GitScript.ts` builder.
 */
export const headAssertion = (expectedHead: string): string => {
  const q = shellQuote(expectedHead)
  return (
    `[ "$(git rev-parse HEAD)" = ${q} ] || ` +
    `{ printf 'gtd: repository changed since this script was generated ` +
    `(expected HEAD %s) — re-run gtd\\n' ${q} >&2; exit 1; }`
  )
}

/**
 * Same shape as `headAssertion`, for the saved-head ref a review window
 * pins. `--verify --quiet ... 2>/dev/null` makes a MISSING ref read as an
 * empty string rather than erroring the substitution itself — the assertion
 * only needs to compare, never to fail outright before the `[ ... ]` runs.
 */
export const reviewWindowAssertion = (ref: string, expectedHash: string): string => {
  const refQ = shellQuote(ref)
  const hashQ = shellQuote(expectedHash)
  return (
    `[ "$(git rev-parse --verify --quiet ${refQ} 2>/dev/null)" = ${hashQ} ] || ` +
    `{ printf 'gtd: review window ref %s changed since this script was generated ` +
    `(expected %s) — re-run gtd\\n' ${refQ} ${hashQ} >&2; exit 1; }`
  )
}

/**
 * `gtd_retry` takes ONE already-`shellQuote`d command string and `eval`s it,
 * mirroring `src/Git.ts`'s `withIndexLockRetry`: retry ONLY on the same two
 * substrings `isIndexLockError` matches, with jittered exponential backoff
 * (~10ms doubling, capped at 6 TOTAL attempts — the initial try plus 5
 * retries), and propagate any other failure on the very first attempt. Output
 * is captured combined (`2>&1`) so the discrimination can inspect it exactly
 * like `commitAllowEmpty`/`restoreStagedFrom` in `src/GitScript.ts` do for
 * their own single-shot retries — this is the same technique, generalized
 * into a loop. `awk` (not bash, which has no fractional `sleep` builtin)
 * turns the millisecond backoff into the fractional-second argument `sleep`
 * needs; `-v` passes the values in rather than interpolating them into the
 * awk program text, so a variable's value can never be mistaken for awk
 * syntax.
 */
const RETRY_HELPER = [
  `gtd_retry() {`,
  `  local cmd=$1 attempt=1 delay_ms=10 out total_ms jitter_ms`,
  `  while true; do`,
  `    if out=$(eval "$cmd" 2>&1); then`,
  `      [ -n "$out" ] && printf '%s\\n' "$out"`,
  `      return 0`,
  `    fi`,
  `    case "$out" in`,
  `      *"index.lock"*|*"Another git process seems to be running"*) ;;`,
  `      *) printf '%s\\n' "$out" >&2; return 1 ;;`,
  `    esac`,
  `    if [ "$attempt" -ge 6 ]; then`,
  `      printf '%s\\n' "$out" >&2`,
  `      return 1`,
  `    fi`,
  `    jitter_ms=$(( RANDOM % delay_ms + 1 ))`,
  `    total_ms=$(( delay_ms + jitter_ms ))`,
  `    sleep "$(awk -v ms="$total_ms" 'BEGIN { printf "%.3f", ms / 1000 }')"`,
  `    delay_ms=$(( delay_ms * 2 ))`,
  `    attempt=$(( attempt + 1 ))`,
  `  done`,
  `}`,
].join("\n")

const renderStep = (step: EmitStep): string =>
  step.kind === "gitWrite" ? `gtd_retry ${shellQuote(step.command)}` : step.command

const assembleScript = (
  preconditions: EmitPreconditions,
  steps: ReadonlyArray<EmitStep>,
): string => {
  if (steps.length === 0) return ""

  const sections: Array<string> = ["set -euo pipefail"]
  if (preconditions.expectedHead !== undefined) {
    sections.push(headAssertion(preconditions.expectedHead))
  }
  if (preconditions.reviewWindow) {
    sections.push(
      reviewWindowAssertion(
        preconditions.reviewWindow.ref,
        preconditions.reviewWindow.expectedHash,
      ),
    )
  }
  if (steps.some((step) => step.kind === "gitWrite")) {
    sections.push(RETRY_HELPER)
  }
  sections.push(...steps.map(renderStep))

  return sections.join("\n\n")
}

/**
 * Build both halves from already-rendered command strings. `required`
 * defaults to `[]` (nothing to do), `optional` to `[]` (no review window to
 * open) — either omitted argument, or an explicit empty array, produces the
 * fixed empty-string result `EmittedScripts` documents: a driver checking
 * `if [ -n "$required" ]` (or the JS equivalent) never has to special-case a
 * bare preamble with no body.
 */
export const emitScripts = (
  preconditions: EmitPreconditions,
  required: ReadonlyArray<EmitStep> = [],
  optional: ReadonlyArray<EmitStep> = [],
): EmittedScripts => ({
  required: assembleScript(preconditions, required),
  optional: assembleScript(preconditions, optional),
})
