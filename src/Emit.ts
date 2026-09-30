import { shellQuote } from "./GitScript.js"

export interface EmittedScripts {
  readonly required: string
  readonly optional: string
}

/**
 * Every kind renders its `command` verbatim (the one exception is a
 * `command` step carrying an `onFailure` prompt); the discriminant records
 * WHAT a step is, and nothing else. A failing git write is left to fail in
 * the user's shell — gtd never writes git itself, so there is nothing to
 * retry on its behalf — and an `outcome` step carries its own complete
 * `printf`, so no shared preamble is emitted for it either.
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

/** Exits 0 when the declared steering file is absent — nothing to format or validate yet. An OR list, not `if`: its left side failing never trips `set -e`. */
export const fileExistsGuard = (file: string): string => `[ -f ${shellQuote(file)} ] || exit 0`

/** A mode or `ui.format` command finds the file it works on in `$GTD_FILE`. */
export const withFileVar = (command: string, file: string): string =>
  `export GTD_FILE=${shellQuote(file)}\n${command}`

const SIMPLE_LEADING_WORD_RE = /^[A-Za-z0-9_./-]+(?=[ \t]|$)/
const SHELL_METACHARACTER_RE = /[|&;$<>(){}`]/
// The file variable is an argument, never a second command.
const FILE_VAR_RE = /"\$GTD_FILE"|"\$\{GTD_FILE\}"|\$GTD_FILE\b|\$\{GTD_FILE\}/g

/** `command` with `file` written in for `$GTD_FILE` — one line an agent can copy, equivalent to running it under `withFileVar`. */
export const commandForFile = (command: string, file: string): string =>
  command.replace(FILE_VAR_RE, shellQuote(file))

/**
 * The leading word of a rendered `format:`/`validate:` command, when the
 * command has exactly one unambiguous binary to probe — `undefined` for
 * anything a shell metacharacter could hide a second command behind. A missing
 * guard degrades to a raw exit; a wrong guard would refuse a working command.
 */
export const extractLeadingBinary = (command: string): string | undefined => {
  if (command.includes("\n")) return undefined
  if (SHELL_METACHARACTER_RE.test(command.replace(FILE_VAR_RE, ""))) return undefined
  const match = SIMPLE_LEADING_WORD_RE.exec(command)
  return match === null ? undefined : match[0]
}

/**
 * Names a typo'd or uninstalled binary and the `$PATH` it was looked up on.
 * `$PATH` is a shell word the DRIVER's shell expands at run time, so gtd never
 * resolves it in-process. Exits 127, matching bash's "command not found".
 */
export const binaryGuard = (binary: string, mode: string, key: "format" | "validate"): string => {
  const messageQ = shellQuote(`gtd: mode "${mode}": "${key}" command not found: ${binary}`)
  return [
    `command -v ${shellQuote(binary)} >/dev/null 2>&1 || {`,
    `  printf '%s\\n%s\\n' ${messageQ} '$PATH: '"$PATH"`,
    `  exit 127`,
    `}`,
  ].join("\n")
}

/**
 * Prints `prompt` plus the captured output on a non-zero exit, then propagates
 * it. The `{ … }` group inlines a multi-line `command` verbatim; the
 * assignment sits left of `||` so `set -e` never trips on the failure itself.
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

const renderStep = (step: EmitStep): string => {
  if (step.kind === "command" && step.onFailure !== undefined) {
    return failurePromptWrapper(step.command, step.onFailure)
  }
  return step.command
}

const assembleScript = (steps: ReadonlyArray<EmitStep>): string =>
  steps.length === 0 ? "" : ["set -eu", ...steps.map(renderStep)].join("\n\n")

/** Build both halves from already-rendered command strings; an empty (or omitted) array produces the empty-string result, so a driver checking `if [ -n "$required" ]` never has to special-case a bare preamble. */
export const emitScripts = (
  required: ReadonlyArray<EmitStep> = [],
  optional: ReadonlyArray<EmitStep> = [],
): EmittedScripts => ({
  required: assembleScript(required),
  optional: assembleScript(optional),
})

/** Exported so `src/testing/EmittedScriptRecognizer.ts` can recognize these by exact string comparison. `printf`, not `echo`, avoids shell-specific backslash-escape quirks. */
export const DID_NOT_RUN_COMMENT =
  "# gtd emitted this and did NOT run it — pipe it into `sh` to land the turn"

export const PRESENTATION_ONLY_COMMENT = "# presentation only — safe to skip"

export const PRESENTATION_FAILURE_WARNING =
  "printf 'gtd: presentation-only follow-up failed — continuing\\n' >&2"

/**
 * A write command's single pasteable script (`gtd abandon | sh`,
 * `gtd land --json=script`'s own field). `optional`, when non-empty, is
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
