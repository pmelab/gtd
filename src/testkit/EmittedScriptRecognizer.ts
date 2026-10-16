// Each block is recognized by RE-RUNNING the same `GitScript.ts`/`Emit.ts`
// builder against values extracted from it and comparing strings — never by
// duplicating a builder's template as a regex — so an unrecognized block
// fails loudly instead of silently passing through.

import {
  commitAll,
  commitAsIs,
  commitClean,
  deleteRef,
  discardPending,
  hardResetTo,
  keepTurn,
  mixedResetTo,
  shellQuote,
  softResetTo,
  updateRef,
  binaryGuard,
  DID_NOT_RUN_COMMENT,
  failurePromptWrapper,
  fileExistsGuard,
  PRESENTATION_FAILURE_WARNING,
  PRESENTATION_ONLY_COMMENT,
  buildModeContradictionCheck,
  contradictionMessage,
  modeContradictionSkipNotice,
  OUTCOME_MARKER,
} from "../emit/index.js"
import {
  BUILT_IN_MODE_NAMES,
  formatFinding,
  steeringFormatFor,
  type SteeringFormat,
} from "../steering/index.js"
import { refNameFault } from "../replay/index.js"
import { renderFormat } from "../wire/index.js"
import { applyFlowScript, rewritten } from "./FlowScripts.js"
import type { InMemRepo } from "./InMemRepo.js"
import type { ScriptedCommand } from "./Layers.js"

export interface AppliedScriptResult {
  readonly ok: boolean
  /** The exit status `sh` would report. */
  readonly status: number
  /** What the script printed, stdout and stderr together, as `sh` would. */
  readonly output: string
  /** Present exactly when `ok` is `false` — names the block/line that stopped the script. */
  readonly error?: string
}

/**
 * Reverses `GitScript.ts`'s `shellQuote`: extracts every `'...'` token from
 * `text`, in order, unescaping the `'\''` (close-literal-open) sequence back
 * to a plain `'`. Position-agnostic on purpose — a builder's block may carry
 * the same value quoted more than once (`commitAllowEmpty`'s retry line
 * repeats the message), so callers take whichever index they need rather
 * than relying on a fixed token count.
 */
const extractQuotedTokens = (text: string): string[] => {
  const tokens: string[] = []
  let i = 0
  while (i < text.length) {
    if (text[i] !== "'") {
      i += 1
      continue
    }
    i += 1
    let value = ""
    while (i < text.length) {
      if (text[i] === "'") {
        if (text.slice(i, i + 4) === "'\\''") {
          value += "'"
          i += 4
          continue
        }
        i += 1
        break
      }
      value += text[i]
      i += 1
    }
    tokens.push(value)
  }
  return tokens
}

/** What the in-memory tier prints for `$PATH` — there is none to name. */
const IN_MEMORY_PATH = "(in-memory: no PATH)"

type BlockOutcome =
  | { readonly kind: "noop"; readonly output?: string }
  | { readonly kind: "applied" }
  /** `error` is what the block printed on its way out; `status` defaults to 1. */
  | { readonly kind: "failed"; readonly error: string; readonly status?: number }
  /**
   * `fileExistsGuard` tripping on an absent file. The one shape that succeeds
   * EARLY, skipping every remaining block — every other guard here either
   * no-ops or fails the script.
   */
  | { readonly kind: "stopped" }

const SET_FLAGS_RE = /^set\s+-\S+(\s+\S+)*$/

const recognizeSetFlags = (block: string): BlockOutcome | undefined =>
  SET_FLAGS_RE.test(block) ? { kind: "noop" } : undefined

/**
 * This module's own invented precondition-assertion shape, not a real gtd
 * convention: a `[ ... ] || { ...; exit 1; }` guard on the current `HEAD`,
 * matching `set -euo pipefail` semantics — a tripped precondition must stop
 * the script, exactly like a failed builder line would.
 */
export const preconditionHeadEquals = (hash: string): string =>
  `[ "$(git rev-parse HEAD)" = '${hash}' ] || { echo "precondition failed: HEAD moved" >&2; exit 1; }`

const PRECONDITION_RE =
  /^\[ "\$\(git rev-parse HEAD\)" = '([0-9a-f]{40})' \] \|\| \{ echo "precondition failed: HEAD moved" >&2; exit 1; \}$/

const recognizePrecondition = (repo: InMemRepo, block: string): BlockOutcome | undefined => {
  const match = PRECONDITION_RE.exec(block)
  if (!match) return undefined
  const expected = match[1]!
  const actual = repo.resolveRef("HEAD")
  return actual === expected
    ? { kind: "noop" }
    : { kind: "failed", error: "precondition failed: HEAD moved" }
}

/**
 * The 8 `GitScript.ts` builders. Each branch checks a cheap literal PREFIX
 * first (to pick which builder to try), then re-derives the builder's
 * arguments from the block's quoted tokens and confirms the match by calling
 * the SAME builder and comparing strings — so a block is only ever "applied"
 * when it is byte-for-byte what that builder would have produced.
 */
/** The `if ! out=$(<git command> 2>&1); then` head of an if/case/fi builder — everything from its opening up to the terminator, however many lines its quoted argument spans. */
const CONDITION_TERMINATOR = " 2>&1); then"

const conditionStatement = (block: string): string => {
  const start = block.indexOf("if ! out=$(")
  if (start === -1) return block
  const end = block.indexOf(CONDITION_TERMINATOR, start)
  return end === -1 ? block.slice(start) : block.slice(start, end)
}

/** `keepTurn`: an invalid ref name fails before anything moves, as `git update-ref` does. */
const recognizeKeepTurn = (repo: InMemRepo, block: string): BlockOutcome | undefined => {
  const [message, refDir] = extractQuotedTokens(block)
  const ref = refDir?.slice(0, -1)
  if (message === undefined || ref === undefined || keepTurn(ref, message) !== block) {
    return undefined
  }
  if (refNameFault(ref) !== undefined) {
    return { kind: "failed", error: `fatal: invalid ref format: ${ref}`, status: 128 }
  }
  const failure = repo.keepTurn(ref, message)
  return failure === undefined ? { kind: "applied" } : { kind: "failed", error: failure, status: 1 }
}

// fallow-ignore-next-line complexity
const recognizeGitBuilders = (repo: InMemRepo, block: string): BlockOutcome | undefined => {
  if (block === discardPending()) {
    repo.discardPending()
    return { kind: "applied" }
  }

  // The two multi-line if/case/fi builders below re-quote their message past
  // their opening `if ! out=$(...` statement — tokens are extracted from THAT
  // statement only, or a quoted fragment further down would pollute the
  // extracted args. Sliced by its `2>&1); then` terminator rather than taken
  // as one LINE, because a commit message is routinely multi-line (every
  // trailer-carrying subject is) and its later lines are part of the same
  // quoted argument.
  const conditionLine = conditionStatement(block)

  if (block.startsWith("git add -A || exit 1\ngtd_sign_cfg=")) return recognizeKeepTurn(repo, block)

  if (block.startsWith("git add -A || exit 1\n")) {
    const [message] = extractQuotedTokens(conditionLine)
    if (message !== undefined && commitAll(message) === block) {
      const failure = repo.commitAllWithPrefix(message)
      return failure === undefined
        ? { kind: "applied" }
        : { kind: "failed", error: failure, status: 1 }
    }
    return undefined
  }

  if (block.startsWith("gtd_head=$(git rev-parse --verify HEAD) || exit 1\nif [ -n ")) {
    const [message] = extractQuotedTokens(block.slice(block.indexOf('"$gtd_head" -m ')))
    if (message !== undefined && commitClean(message) === block) {
      const failure = repo.commitClean(message)
      return failure === undefined
        ? { kind: "applied" }
        : { kind: "failed", error: failure, status: 1 }
    }
    return undefined
  }

  if (block.startsWith("if ! out=$(git commit --allow-empty -m ")) {
    const [message] = extractQuotedTokens(conditionLine)
    if (message !== undefined && commitAsIs(message) === block) {
      const failure = repo.commitAsIs(message)
      return failure === undefined
        ? { kind: "applied" }
        : { kind: "failed", error: failure, status: 1 }
    }
    return undefined
  }

  if (block.startsWith("git reset --soft ")) {
    const [ref] = extractQuotedTokens(block)
    if (ref !== undefined && softResetTo(ref) === block) {
      repo.softResetTo(ref)
      return { kind: "applied" }
    }
    return undefined
  }

  if (block.startsWith("git reset --mixed ")) {
    const [ref] = extractQuotedTokens(block)
    if (ref !== undefined && mixedResetTo(ref) === block) {
      repo.mixedResetTo(ref)
      return { kind: "applied" }
    }
    return undefined
  }

  if (block.startsWith("git reset --hard ")) {
    const [ref] = extractQuotedTokens(block)
    if (ref !== undefined && hardResetTo(ref) === block) {
      repo.hardResetTo(ref)
      return { kind: "applied" }
    }
    return undefined
  }

  if (block.startsWith("git update-ref -d ")) {
    const [ref] = extractQuotedTokens(block)
    if (ref !== undefined && deleteRef(ref) === block) {
      repo.deleteRef(ref)
      return { kind: "applied" }
    }
    return undefined
  }

  if (block.startsWith("git update-ref ")) {
    const [ref, hash] = extractQuotedTokens(block)
    if (ref !== undefined && hash !== undefined && updateRef(ref, hash) === block) {
      repo.updateRef(ref, hash)
      return { kind: "applied" }
    }
    return undefined
  }

  return undefined
}

/** The REAL `fileExistsGuard` block, re-derived from the extracted path and string-compared. The one recognizer that can report `{ kind: "stopped" }`: a real `exit 0` there ends the script successfully. */
const recognizeFileExistsGuard = (repo: InMemRepo, block: string): BlockOutcome | undefined => {
  const [file] = extractQuotedTokens(block)
  if (file === undefined || fileExistsGuard(file) !== block) return undefined
  return repo.readFile(file) !== undefined ? { kind: "noop" } : { kind: "stopped" }
}

/** `binaryGuard`. The in-memory tier has no `$PATH`: a binary is present unless declared `missing`. */
const BINARY_GUARD_MESSAGE_RE = /^gtd: mode "([^"]+)": "(format|validate)" command not found: (.+)$/

const recognizeBinaryGuard = (
  commands: ReadonlyMap<string, ScriptedCommand>,
  block: string,
): BlockOutcome | undefined => {
  const [binary, , message] = extractQuotedTokens(block)
  if (binary === undefined || message === undefined) return undefined
  const match = BINARY_GUARD_MESSAGE_RE.exec(message)
  if (!match) return undefined
  const [, mode, key, messageBinary] = match
  if (messageBinary !== binary) return undefined
  if (binaryGuard(binary, mode!, key as "format" | "validate") !== block) return undefined
  if (commands.get(binary)?.kind !== "missing") return { kind: "noop" }
  return { kind: "failed", error: `${message}\n$PATH: ${IN_MEMORY_PATH}`, status: 127 }
}

/** Recognized by `OUTCOME_MARKER` rather than re-derived and string-compared: an outcome only prints, so no git effect a loose match could miss — unlike `recognizeGitBuilders`, where a near-miss would silently skip a real mutation. */
const recognizeOutcome = (repo: InMemRepo, block: string): BlockOutcome | undefined => {
  if (!block.startsWith(`${OUTCOME_MARKER}\nprintf `)) return undefined
  const line = block.slice(OUTCOME_MARKER.length + 1)
  const [format, ...args] = shellWords(repo, line.slice("printf ".length))
  return { kind: "noop", output: renderFormat(format!.replace(/\\n/g, "\n"), ...args) }
}

/** The word list of `printf`'s arguments: quoted literals, and the `"$(git …)"` lookups outcome lines carry. */
const shellWords = (repo: InMemRepo, text: string): string[] =>
  [
    ...text.matchAll(
      /'((?:[^']|'\\'')*)'|"\$\(git (rev-parse --short|log -1 --format=%s) '([^']*)'\)"/g,
    ),
  ].map((m) => {
    if (m[1] !== undefined) return m[1].replaceAll("'\\''", "'")
    const hash = repo.resolveRef(m[3]!) ?? ""
    return m[2] === "rev-parse --short" ? hash.slice(0, 7) : (repo.lastCommitSubject(hash) ?? "")
  })

/**
 * `failurePromptWrapper`. The constants below bracket the template's one
 * variable part; the extracted pair is confirmed by RE-RUNNING the real
 * builder and string-comparing. On a failing inner outcome it prefixes the
 * prompt onto the error — the fake's stand-in for what the real wrapper
 * prints before exiting non-zero.
 */
const FILE_VAR_PREFIX_RE = /^export GTD_FILE=('(?:[^']|'\\'')*')\n/

/** The command after `withFileVar`'s `export GTD_FILE=…` line, `$GTD_FILE` expanded the way the shell would. */
const expandFileVar = (text: string): string | undefined => {
  const match = FILE_VAR_PREFIX_RE.exec(text)
  if (match === null) return undefined
  const [file] = extractQuotedTokens(match[1]!)
  if (file === undefined) return undefined
  return text
    .slice(match[0].length)
    .replace(/"\$GTD_FILE"|"\$\{GTD_FILE\}"/g, shellQuote(file))
    .replace(/\$\{GTD_FILE\}|\$GTD_FILE\b/g, file)
}

/**
 * A mode's `format:`/`validate:` command, under `withFileVar` or not:
 * `gtd check`, or a scripted command — keyed by the command as expanded, or
 * as written in the config (`fmt $GTD_FILE`), which is the only key a command
 * run on a scratch path can have.
 */
const recognizeModeCommand = (
  repo: InMemRepo,
  commands: ReadonlyMap<string, ScriptedCommand>,
  block: string,
): BlockOutcome | undefined => {
  const command = expandFileVar(block) ?? block
  const exact =
    recognizeGtdCheck(repo, command) ?? recognizeScriptedCommand(repo, commands, command)
  if (exact !== undefined) return exact
  const match = FILE_VAR_PREFIX_RE.exec(block)
  if (match === null) return undefined
  const scripted = commands.get(block.slice(match[0].length))
  const [file] = extractQuotedTokens(match[1]!)
  if (scripted === undefined || file === undefined) return undefined
  const bound =
    scripted.kind === "rewrite" && scripted.file === "$GTD_FILE" ? { ...scripted, file } : scripted
  return recognizeScriptedCommand(repo, new Map([[command, bound]]), command)
}

const FAILURE_PROMPT_HEADER = 'gtd_validate_status=0\ngtd_validate_out="$( {\n'
const FAILURE_PROMPT_MIDDLE =
  '\n} 2>&1 )" || gtd_validate_status=$?\n' +
  'if [ "$gtd_validate_status" -ne 0 ]; then\n' +
  "  printf '%s\\n\\n%s\\n' "
const FAILURE_PROMPT_FOOTER = ' "$gtd_validate_out"\n  exit "$gtd_validate_status"\nfi'

const recognizeFailurePromptWrapper = (
  repo: InMemRepo,
  commands: ReadonlyMap<string, ScriptedCommand>,
  block: string,
): BlockOutcome | undefined => {
  if (!block.startsWith(FAILURE_PROMPT_HEADER) || !block.endsWith(FAILURE_PROMPT_FOOTER)) {
    return undefined
  }
  const middleIndex = block.indexOf(FAILURE_PROMPT_MIDDLE, FAILURE_PROMPT_HEADER.length)
  if (middleIndex === -1) return undefined

  const inner = block.slice(FAILURE_PROMPT_HEADER.length, middleIndex)
  const promptQuoted = block.slice(
    middleIndex + FAILURE_PROMPT_MIDDLE.length,
    block.length - FAILURE_PROMPT_FOOTER.length,
  )
  const [prompt] = extractQuotedTokens(promptQuoted)
  if (prompt === undefined || failurePromptWrapper(inner, prompt) !== block) return undefined

  const innerOutcome = recognizeModeCommand(repo, commands, inner)
  if (innerOutcome === undefined) return undefined
  if (innerOutcome.kind === "failed") {
    // `"$( … )"` strips the captured output's trailing newlines.
    const captured = innerOutcome.error.replace(/\n+$/, "")
    return { kind: "failed", error: `${prompt}\n\n${captured}`, status: innerOutcome.status ?? 1 }
  }
  return innerOutcome
}

/** `modeContradictionSkipNotice` — a mode whose validator is EXTERNAL. Re-derived from the mode name embedded in its own decoded message, keeping the "call the real builder, never hand-copy its template" discipline. */
const SKIP_NOTICE_MODE_RE = /mode "([^"]+)" has an external validate:/

const recognizeModeContradictionSkipNotice = (block: string): BlockOutcome | undefined => {
  // Two quoted tokens: the literal `printf` format string `'%s\n'` first,
  // then the message itself.
  const [, message] = extractQuotedTokens(block)
  if (message === undefined) return undefined
  const match = SKIP_NOTICE_MODE_RE.exec(message)
  if (!match) return undefined
  const mode = match[1]!
  if (modeContradictionSkipNotice(mode) !== block) return undefined
  return { kind: "noop", output: `${message}\n` }
}

/** Everything `parseModeContradictionCheck` recovers from a matched block — enough for `simulateModeContradictionCheck` to run it, with no further parsing. */
interface ParsedModeContradictionCheck {
  readonly mode: string
  readonly samplePath: string
  readonly sample: string
  readonly formatCommand: string
  readonly format: SteeringFormat
}

/** The printf line's own pieces — the sample bytes, the scratch path, and the literal PREFIX text (up to and including that path) — or `undefined` when `block` doesn't open with `printf '%s' ...`. */
const parsePrintfPrefix = (
  block: string,
):
  | { readonly sample: string; readonly samplePath: string; readonly prefix: string }
  | undefined => {
  if (!block.startsWith("printf '%s' ")) return undefined
  // Three leading quoted tokens: the literal printf format string `'%s'`
  // first, then the sample, then the scratch path.
  const [, sample, samplePath] = extractQuotedTokens(block)
  if (sample === undefined || samplePath === undefined) return undefined
  const prefix = `printf '%s' ${shellQuote(sample)} > ${shellQuote(samplePath)}`
  if (!block.startsWith(`${prefix}\n`)) return undefined
  return { sample, samplePath, prefix }
}

/** The mode name and `format:` command sandwiched between the printf `prefix` and the fixed `gtd check <mode> <pathQ> >/dev/null ...` line, or `undefined` when that line isn't there right after it. */
const parseModeAndFormatCommand = (
  block: string,
  prefix: string,
  pathQ: string,
): { readonly mode: string; readonly formatCommand: string } | undefined => {
  const suffix = ` ${pathQ} >/dev/null 2>&1 || {\n`
  const suffixIndex = block.indexOf(suffix, prefix.length + 1)
  if (suffixIndex === -1) return undefined
  const lineStart = block.lastIndexOf("\ngtd check ", suffixIndex)
  if (lineStart === -1) return undefined
  const mode = block.slice(lineStart + "\ngtd check ".length, suffixIndex)
  if (mode.length === 0 || /\s/.test(mode)) return undefined
  return { mode, formatCommand: block.slice(prefix.length + 1, lineStart) }
}

/** Parses `block` back into the real builder's inputs. Split from the simulation so extraction (many guards, no effects) and simulation (few guards, all effects) stay separate. A wrong guess fails to parse rather than mis-simulating. */
const parseModeContradictionCheck = (block: string): ParsedModeContradictionCheck | undefined => {
  const prefixParts = parsePrintfPrefix(block)
  if (prefixParts === undefined) return undefined
  const { sample, samplePath, prefix } = prefixParts

  const modeParts = parseModeAndFormatCommand(block, prefix, shellQuote(samplePath))
  if (modeParts === undefined) return undefined
  const { mode, formatCommand } = modeParts

  const format = steeringFormatFor(mode)
  if (format === undefined) return undefined
  if (buildModeContradictionCheck({ mode, samplePath, sample, formatCommand }) !== block) {
    return undefined
  }
  return { mode, samplePath, sample, formatCommand, format }
}

/**
 * One parsed round-trip: write the sample, run its `format:` through the
 * scripted-command table (real bash is unreachable in this tier), re-validate,
 * and clean up on every path out, mirroring the real script's `rm -f` on both
 * branches. An unscripted `format:` fails loudly rather than succeeding.
 */
const simulateModeContradictionCheck = (
  repo: InMemRepo,
  commands: ReadonlyMap<string, ScriptedCommand>,
  parsed: ParsedModeContradictionCheck,
): BlockOutcome => {
  const { mode, samplePath, sample, formatCommand, format } = parsed
  repo.writeFile(samplePath, sample)
  const command = expandFileVar(formatCommand) ?? formatCommand
  const formatOutcome = recognizeModeCommand(repo, commands, formatCommand)
  if (formatOutcome === undefined) {
    repo.deleteFile(samplePath)
    return {
      kind: "failed",
      error: `unscripted command "${command}" — declare it with a Given step`,
    }
  }
  if (formatOutcome.kind === "failed") {
    repo.deleteFile(samplePath)
    return formatOutcome
  }
  const formatted = repo.readFile(samplePath) ?? sample
  const findings = format.validate(formatted)
  repo.deleteFile(samplePath)
  if (findings.length === 0) return { kind: "noop" }
  return {
    kind: "failed",
    error: `${contradictionMessage(mode, formatCommand)}\n${formatted}`,
  }
}

/**
 * `src/emit/ModeContradiction.ts`'s `buildModeContradictionCheck` — the
 * contradiction round-trip block `resolveValidateScript` (`src/cli/Program.ts`)
 * emits ahead of `fileExistsGuard` for a mode with a live built-in validator
 * and a declared `format:`. Carries no blank line of its own, so it always
 * arrives here as ONE block.
 */
const recognizeModeContradictionCheck = (
  repo: InMemRepo,
  commands: ReadonlyMap<string, ScriptedCommand>,
  block: string,
): BlockOutcome | undefined => {
  const parsed = parseModeContradictionCheck(block)
  return parsed === undefined ? undefined : simulateModeContradictionCheck(repo, commands, parsed)
}

const GTD_CHECK_RE = /^gtd check (\S+) (.+)$/

/** `gtd check <mode> <file>` — a non-empty findings array fails the script, mirroring a real invocation's non-zero exit under `set -e`. */
const recognizeGtdCheck = (repo: InMemRepo, block: string): BlockOutcome | undefined => {
  const match = GTD_CHECK_RE.exec(block)
  if (!match) return undefined
  const mode = match[1]!
  const [file] = extractQuotedTokens(match[2]!)
  const format = steeringFormatFor(mode)
  if (format === undefined || file === undefined) {
    const known = BUILT_IN_MODE_NAMES.join(", ")
    return { kind: "failed", error: `gtd check: unknown mode "${mode}" — known modes: ${known}` }
  }
  // An ABSENT file has nothing to check and exits 0 — `runCheckCommand`'s own
  // documented behavior. Validating `""` instead would report every "missing
  // header" finding the format has, turning "the reviewer deleted the file"
  // (a case the review-doc guard owns) into a script failure.
  const content = repo.readFile(file)
  if (content === undefined) return { kind: "noop" }
  const findings = format.validate(content).map((finding) => formatFinding(file, finding))
  if (findings.length === 0) return { kind: "noop" }
  return {
    kind: "failed",
    error:
      `gtd check: ${file} is not valid under mode "${mode}" (${findings.length} finding(s)):\n` +
      findings.join("\n"),
  }
}

const GTD_UNCHECK_RE = /^gtd uncheck (.+)$/

/** `gtd uncheck <file>` — the review-gate reset prepended ahead of the human's commit, so no tick ever reaches it. Re-runs the REAL `clearTicks`, writing back only on an actual change. */
const recognizeGtdUncheck = (repo: InMemRepo, block: string): BlockOutcome | undefined => {
  const match = GTD_UNCHECK_RE.exec(block)
  if (!match) return undefined
  const [file] = extractQuotedTokens(match[1]!)
  if (file === undefined) return undefined
  const content = repo.readFile(file)
  if (content === undefined) return { kind: "noop" }
  const format = steeringFormatFor("review")
  const cleared = format === undefined ? content : format.clearTicks(content)
  if (cleared !== content) repo.writeFile(file, cleared)
  return { kind: "noop" }
}

/**
 * `Emit.ts`'s `combinedScript` leading comment — `gtd land`/`gtd --workflow`'s
 * whole plain-text artifact opens with this line ahead of the required
 * script, so recognizing it as a no-op (like the retry-helper function
 * definition) keeps the `@inmem` tier green.
 */
const recognizeDidNotRunComment = (block: string): BlockOutcome | undefined =>
  block === DID_NOT_RUN_COMMENT ? { kind: "noop" } : undefined

/** `combinedScript`'s optional half. ALWAYS reports `noop` whatever the inner result, mirroring bash's `( … ) || <warning>`, where the subshell's exit status is swallowed and must never fail the outer script. */
const PRESENTATION_FAILURE_TEXT = `${extractQuotedTokens(PRESENTATION_FAILURE_WARNING)[0]!.replace(/\\n$/, "")}\n`
const PRESENTATION_SUBSHELL_PREFIX = `${PRESENTATION_ONLY_COMMENT}\n(\n`
const PRESENTATION_SUBSHELL_SUFFIX = `\n) || ${PRESENTATION_FAILURE_WARNING}`

const recognizePresentationSubshell = (
  repo: InMemRepo,
  commands: ReadonlyMap<string, ScriptedCommand>,
  block: string,
): BlockOutcome | undefined => {
  if (
    !block.startsWith(PRESENTATION_SUBSHELL_PREFIX) ||
    !block.endsWith(PRESENTATION_SUBSHELL_SUFFIX)
  ) {
    return undefined
  }
  const inner = block.slice(
    PRESENTATION_SUBSHELL_PREFIX.length,
    block.length - PRESENTATION_SUBSHELL_SUFFIX.length,
  )
  const result = applyEmittedScript(repo, commands, inner)
  if (result.ok) return { kind: "noop", output: result.output }
  return { kind: "noop", output: `${result.output}${PRESENTATION_FAILURE_TEXT}` }
}

/** Anything left over must be an EXACT hit in the scripted-command table — mirrors `ScriptedCommand`'s two `kind`s (`Layers.ts`). */
const recognizeScriptedCommand = (
  repo: InMemRepo,
  commands: ReadonlyMap<string, ScriptedCommand>,
  block: string,
): BlockOutcome | undefined => {
  const scripted = commands.get(block)
  if (scripted === undefined) return undefined
  if (scripted.kind === "rewrite") {
    repo.writeFile(scripted.file, rewritten(repo, scripted))
    return { kind: "applied" }
  }
  if (scripted.kind === "missing") {
    return { kind: "failed", error: `sh: ${block.split(" ")[0]}: not found`, status: 127 }
  }
  if (scripted.status !== 0) {
    return { kind: "failed", error: scripted.output, status: scripted.status }
  }
  return { kind: "noop", output: scripted.output }
}

/**
 * Splits on blank lines, IGNORING those inside a single-quoted string: every
 * trailer-carrying commit subject spans one, so a naive `split(/\n{2,}/)`
 * tears a `commitAll` block into fragments that recognize as nothing.
 *
 * Quote depth toggles on every `'`, with one load-bearing correction: the `\`
 * in `'\''` escapes its following `'` OUTSIDE any quote, so that middle quote
 * must not toggle. Deliberately not a bash lexer — gtd's emission vocabulary
 * is closed, and no double-quoted string in it ever contains a `'`.
 */
const trackQuoteState = (line: string, quoted: boolean): boolean => {
  let inQuote = quoted
  let index = 0
  while (index < line.length) {
    const char = line[index]
    if (!inQuote && char === "\\") {
      index += 2
      continue
    }
    if (char === "'") inQuote = !inQuote
    index += 1
  }
  return inQuote
}

/**
 * The optional half is a bare `(\n...\n) || <warning>` whose inner script has
 * its OWN blank-line-separated sections, so `splitBlocks` needs this depth to
 * keep them from tearing it apart. Safe to key on a bare `(`/`)` line because
 * no other shape in this closed vocabulary produces one.
 */
const nextSubshellDepth = (trimmedLine: string, depth: number): number => {
  if (trimmedLine === "(") return depth + 1
  if (depth > 0 && trimmedLine.startsWith(")")) return depth - 1
  return depth
}

const splitBlocks = (script: string): readonly string[] => {
  const blocks: string[] = []
  let current = ""
  let quoted = false
  let subshellDepth = 0
  for (const line of script.trim().split("\n")) {
    const trimmedLine = line.trim()
    if (!quoted && subshellDepth === 0 && trimmedLine.length === 0) {
      if (current.trim().length > 0) blocks.push(current.trim())
      current = ""
      continue
    }
    current += (current.length > 0 ? "\n" : "") + line
    quoted = trackQuoteState(line, quoted)
    if (!quoted) subshellDepth = nextSubshellDepth(trimmedLine, subshellDepth)
  }
  if (current.trim().length > 0) blocks.push(current.trim())
  return blocks
}

/** `deferNotesScript`: append its one section to `.gtd/TODO.md`, reading the section's lines off the final `printf`. */
const DEFER_HEAD = "mkdir -p .gtd\nif [ -s .gtd/TODO.md ]; then"
const recognizeDeferNotes = (repo: InMemRepo, block: string): BlockOutcome | undefined => {
  if (!block.startsWith(DEFER_HEAD)) return undefined
  const at = block.lastIndexOf("\nprintf '%s\\n' ")
  if (at === -1) return undefined
  const lines = extractQuotedTokens(block.slice(at + "\nprintf '%s\\n' ".length))
  const old = repo.readFile(".gtd/TODO.md") ?? ""
  const sep = old === "" ? "" : `${old.endsWith("\n") ? "" : "\n"}\n`
  repo.writeFile(".gtd/TODO.md", `${old}${sep}${lines.join("\n")}\n`)
  return { kind: "applied" }
}

/** `mkdir -p <dir>` then `printf '%s\n' <quoted lines> > <path>`: a flow's one-file write. Re-rendered from what was extracted, so any other shape stays unrecognized. */
const recognizeWriteLines = (repo: InMemRepo, block: string): BlockOutcome | undefined => {
  const [mkdir, printf, ...rest] = block.split("\n")
  if (
    rest.length > 0 ||
    !mkdir?.startsWith("mkdir -p ") ||
    !printf?.startsWith("printf '%s\\n' ")
  ) {
    return undefined
  }
  const tokens = extractQuotedTokens(printf.slice("printf '%s\\n' ".length))
  const path = tokens.pop()
  if (path === undefined || !path.includes("/")) return undefined
  const dir = path.slice(0, path.lastIndexOf("/"))
  const rendered = `mkdir -p ${dir}\nprintf '%s\\n' ${tokens.map(shellQuote).join(" ")} > ${shellQuote(path)}`
  if (rendered !== block) return undefined
  repo.writeFile(path, `${tokens.join("\n")}\n`)
  return { kind: "applied" }
}

/** Every recognizer `applyEmittedScript` tries, first match wins — `recognizeScriptedCommand` stays last since it's the exact-hit fallback for anything the rest don't claim. */
const recognizersFor = (
  repo: InMemRepo,
  commands: ReadonlyMap<string, ScriptedCommand>,
  git: boolean,
): ReadonlyArray<(block: string) => BlockOutcome | undefined> => [
  (block) => recognizeSetFlags(block),
  (block) => recognizeDidNotRunComment(block),
  (block) => recognizePrecondition(repo, block),
  (block) => recognizeFileExistsGuard(repo, block),
  (block) => recognizeBinaryGuard(commands, block),
  (block) => (git ? recognizeGitBuilders(repo, block) : undefined),
  (block) => recognizeDeferNotes(repo, block),
  (block) => recognizeWriteLines(repo, block),
  (block) => recognizeFailurePromptWrapper(repo, commands, block),
  (block) => recognizePresentationSubshell(repo, commands, block),
  (block) => recognizeModeContradictionSkipNotice(block),
  (block) => recognizeModeContradictionCheck(repo, commands, block),
  (block) => recognizeGtdCheck(repo, block),
  (block) => recognizeGtdUncheck(repo, block),
  (block) => {
    return FILE_VAR_PREFIX_RE.test(block) ? recognizeModeCommand(repo, commands, block) : undefined
  },
  (block) => recognizeOutcome(repo, block),
  (block) => recognizeScriptedCommand(repo, commands, block),
]

const recognizeBlock = (
  recognizers: ReadonlyArray<(block: string) => BlockOutcome | undefined>,
  block: string,
): BlockOutcome | undefined => {
  for (const recognize of recognizers) {
    const outcome = recognize(block)
    if (outcome !== undefined) return outcome
  }
  return undefined
}

/**
 * Applies `script` to `repo` block by block, stopping at the first failure —
 * an unrecognized block, a tripped precondition, a failing `gtd check`, or a
 * non-zero scripted-command exit — exactly like `set -euo pipefail` stops a
 * real script. No block after the failing one is applied.
 */
export const applyEmittedScript = (
  repo: InMemRepo,
  commands: ReadonlyMap<string, ScriptedCommand>,
  script: string,
  { git = true }: { readonly git?: boolean } = {},
): AppliedScriptResult => {
  const flow = applyFlowScript(repo, commands, script)
  if (flow !== undefined) {
    return flow.ok
      ? { ok: true, status: 0, output: flow.output }
      : { ok: false, status: 1, output: flow.output, error: flow.error ?? "" }
  }
  return script.startsWith("#!") ? unrecognized(script) : applyBlocks(repo, commands, script, git)
}

const applyBlocks = (
  repo: InMemRepo,
  commands: ReadonlyMap<string, ScriptedCommand>,
  script: string,
  git: boolean,
): AppliedScriptResult => {
  const recognizers = recognizersFor(repo, commands, git)
  let output = ""
  for (const block of splitBlocks(script)) {
    const outcome = recognizeBlock(recognizers, block)
    if (outcome === undefined) return unrecognized(block, output)
    if (outcome.kind === "noop") output += outcome.output ?? ""
    if (outcome.kind === "stopped") break
    if (outcome.kind === "failed") return failedAt(outcome, output)
  }
  return { ok: true, status: 0, output }
}

const failedAt = (
  outcome: { readonly error: string; readonly status?: number },
  output: string,
): AppliedScriptResult => {
  const printed = outcome.error.length === 0 || outcome.error.endsWith("\n") ? "" : "\n"
  return {
    ok: false,
    status: outcome.status ?? 1,
    output: `${output}${outcome.error}${printed}`,
    error: outcome.error,
  }
}

const unrecognized = (block: string, output = ""): AppliedScriptResult => ({
  ok: false,
  status: 1,
  output,
  error: `unrecognized script block: ${block.split("\n")[0]}`,
})
