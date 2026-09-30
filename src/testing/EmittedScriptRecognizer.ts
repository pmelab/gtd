// Each block is recognized by RE-RUNNING the same `GitScript.ts`/`Emit.ts`
// builder against values extracted from it and comparing strings — never by
// duplicating a builder's template as a regex — so an unrecognized block
// fails loudly instead of silently passing through.

import {
  commitAll,
  commitAsIs,
  deleteRef,
  discardPending,
  hardResetTo,
  mixedResetTo,
  shellQuote,
  softResetTo,
  updateRef,
} from "../GitScript.js"
import {
  binaryGuard,
  DID_NOT_RUN_COMMENT,
  failurePromptWrapper,
  fileExistsGuard,
  PRESENTATION_FAILURE_WARNING,
  PRESENTATION_ONLY_COMMENT,
} from "../Emit.js"
import {
  buildModeContradictionCheck,
  contradictionMessage,
  modeContradictionSkipNotice,
} from "../ModeContradiction.js"
import { OUTCOME_MARKER } from "../OutcomeScript.js"
import { steeringFormatFor, type SteeringFormat } from "../steering/index.js"
import type { InMemRepo } from "./InMemRepo.js"
import type { ScriptedCommand } from "./Layers.js"

export interface AppliedScriptResult {
  readonly ok: boolean
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

type BlockOutcome =
  | { readonly kind: "noop" }
  | { readonly kind: "applied" }
  | { readonly kind: "failed"; readonly error: string }
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
  if (actual === expected) return { kind: "noop" }
  return {
    kind: "failed",
    error: `precondition failed: HEAD is ${actual ?? "(no commits)"}, expected ${expected}`,
  }
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

  if (block.startsWith("git add -A &&\n")) {
    const [message] = extractQuotedTokens(conditionLine)
    if (message !== undefined && commitAll(message) === block) {
      repo.commitAllWithPrefix(message)
      return { kind: "applied" }
    }
    return undefined
  }

  if (block.startsWith("if ! out=$(git commit --allow-empty -m ")) {
    const [message] = extractQuotedTokens(conditionLine)
    if (message !== undefined && commitAsIs(message) === block) {
      repo.commitAsIs(message)
      return { kind: "applied" }
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

/** `binaryGuard`. The in-memory tier has no real `$PATH` to probe — a scripted command IS the stand-in for "this binary exists" — so this always no-ops; the guard actually tripping is `@live`-only coverage. */
const BINARY_GUARD_MESSAGE_RE = /^gtd: mode "([^"]+)": "(format|validate)" command not found: (.+)$/

const recognizeBinaryGuard = (block: string): BlockOutcome | undefined => {
  const [binary, , message] = extractQuotedTokens(block)
  if (binary === undefined || message === undefined) return undefined
  const match = BINARY_GUARD_MESSAGE_RE.exec(message)
  if (!match) return undefined
  const [, mode, key, messageBinary] = match
  if (messageBinary !== binary) return undefined
  if (binaryGuard(binary, mode!, key as "format" | "validate") !== block) return undefined
  return { kind: "noop" }
}

/** Recognized by `OUTCOME_MARKER` rather than re-derived and string-compared: an outcome only prints, so no git effect a loose match could miss — unlike `recognizeGitBuilders`, where a near-miss would silently skip a real mutation. */
const recognizeOutcome = (block: string): BlockOutcome | undefined =>
  block.startsWith(OUTCOME_MARKER) ? { kind: "noop" } : undefined

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

/** A mode's `format:`/`validate:` command: `gtd check`, or a scripted command. */
const recognizeModeCommand = (
  repo: InMemRepo,
  commands: ReadonlyMap<string, ScriptedCommand>,
  command: string,
): BlockOutcome | undefined =>
  recognizeGtdCheck(repo, command) ?? recognizeScriptedCommand(repo, commands, command)

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

  const innerOutcome = recognizeModeCommand(repo, commands, expandFileVar(inner) ?? inner)
  if (innerOutcome === undefined) return undefined
  if (innerOutcome.kind === "failed") {
    return { kind: "failed", error: `${prompt}\n\n${innerOutcome.error}` }
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
  return { kind: "noop" }
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
  const formatOutcome = recognizeScriptedCommand(repo, commands, command)
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
 * `src/ModeContradiction.ts`'s `buildModeContradictionCheck` — the
 * contradiction round-trip block `resolveValidateScript` (`src/program.ts`)
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
    return { kind: "failed", error: `gtd check: no built-in steering format named "${mode}"` }
  }
  // An ABSENT file has nothing to check and exits 0 — `runCheckCommand`'s own
  // documented behavior. Validating `""` instead would report every "missing
  // header" finding the format has, turning "the reviewer deleted the file"
  // (a case the review-doc guard owns) into a script failure.
  const content = repo.readFile(file)
  if (content === undefined) return { kind: "noop" }
  const findings = format.validate(content)
  if (findings.length > 0) {
    const formatted = findings.map((f) =>
      f.line !== undefined ? `${file}:${f.line + 1}: ${f.message}` : f.message,
    )
    return { kind: "failed", error: `gtd check ${mode} ${file}: ${formatted.join("; ")}` }
  }
  return { kind: "noop" }
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
 * `Emit.ts`'s `combinedScript` leading comment — `gtd land`/`gtd --entry`'s
 * whole plain-text artifact opens with this line ahead of the required
 * script, so recognizing it as a no-op (like the retry-helper function
 * definition) keeps the `@inmem` tier green.
 */
const recognizeDidNotRunComment = (block: string): BlockOutcome | undefined =>
  block === DID_NOT_RUN_COMMENT ? { kind: "noop" } : undefined

/** `combinedScript`'s optional half. ALWAYS reports `noop` whatever the inner result, mirroring bash's `( … ) || <warning>`, where the subshell's exit status is swallowed and must never fail the outer script. */
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
  applyEmittedScript(repo, commands, inner)
  return { kind: "noop" }
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
    repo.writeFile(scripted.file, scripted.content)
    return { kind: "applied" }
  }
  if (scripted.status !== 0) {
    return {
      kind: "failed",
      error: `scripted command "${block}" exited ${scripted.status}: ${scripted.output}`,
    }
  }
  return { kind: "noop" }
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

/** Every recognizer `applyEmittedScript` tries, first match wins — `recognizeScriptedCommand` stays last since it's the exact-hit fallback for anything the rest don't claim. */
const recognizersFor = (
  repo: InMemRepo,
  commands: ReadonlyMap<string, ScriptedCommand>,
): ReadonlyArray<(block: string) => BlockOutcome | undefined> => [
  (block) => recognizeSetFlags(block),
  (block) => recognizeDidNotRunComment(block),
  (block) => recognizePrecondition(repo, block),
  (block) => recognizeFileExistsGuard(repo, block),
  (block) => recognizeBinaryGuard(block),
  (block) => recognizeGitBuilders(repo, block),
  (block) => recognizeFailurePromptWrapper(repo, commands, block),
  (block) => recognizePresentationSubshell(repo, commands, block),
  (block) => recognizeModeContradictionSkipNotice(block),
  (block) => recognizeModeContradictionCheck(repo, commands, block),
  (block) => recognizeGtdCheck(repo, block),
  (block) => recognizeGtdUncheck(repo, block),
  (block) => {
    const command = expandFileVar(block)
    return command === undefined ? undefined : recognizeModeCommand(repo, commands, command)
  },
  (block) => recognizeOutcome(block),
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
): AppliedScriptResult => {
  const recognizers = recognizersFor(repo, commands)

  for (const block of splitBlocks(script)) {
    const outcome = recognizeBlock(recognizers, block)

    if (outcome === undefined) {
      return { ok: false, error: `unrecognized script block: ${block.split("\n")[0]}` }
    }
    if (outcome.kind === "stopped") return { ok: true }
    if (outcome.kind === "failed") {
      return { ok: false, error: outcome.error }
    }
  }

  return { ok: true }
}
