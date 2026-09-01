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
import { clearFilePointerTicks } from "../ReviewDoc.js"
import { steeringFormatFor } from "../SteeringFormats.js"
import type { SteeringFormat } from "../SteeringFormat.js"
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
   * `Emit.ts`'s `fileExistsGuard` tripping on an absent file: a real
   * `[ -f <file> ] || exit 0` exits the WHOLE script cleanly right there,
   * unlike every other guard here (`recognizePrecondition`/
   * `recognizeHeadAssertion`/etc.), which either no-op or fail the script —
   * this is the one shape that succeeds EARLY, skipping every remaining
   * block. `applyEmittedScript`'s loop stops on this exactly like it stops
   * on a `"failed"` block, but reports `{ ok: true }`.
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

/**
 * `src/Emit.ts`'s REAL `fileExistsGuard` block — `src/program.ts`'s
 * `resolveValidateScript` leads every emitted validate script with it.
 * Re-derives the block from the extracted path and compares full strings,
 * same discipline as `recognizeHeadAssertion`. Unlike every OTHER guard in
 * this file, a tripped `fileExistsGuard` does not fail
 * the script — a real `exit 0` there ends it successfully right there — so
 * this is the one recognizer that can report `{ kind: "stopped" }`.
 */
const recognizeFileExistsGuard = (repo: InMemRepo, block: string): BlockOutcome | undefined => {
  const [file] = extractQuotedTokens(block)
  if (file === undefined || fileExistsGuard(file) !== block) return undefined
  return repo.readFile(file) !== undefined ? { kind: "noop" } : { kind: "stopped" }
}

/**
 * `src/OutcomeScript.ts`'s outcome statements, recognized by their own
 * `OUTCOME_MARKER` first line rather than re-derived and string-compared like
 * every git-effecting block above: an outcome only prints (and the
 * changed-file line under it only reads), so there is no git effect a loose
 * match could ever miss (contrast `recognizeGitBuilders`, where a
 * byte-for-byte match is load-bearing — a near-miss there could silently skip
 * a real mutation).
 */
const recognizeOutcome = (block: string): BlockOutcome | undefined =>
  block.startsWith(OUTCOME_MARKER) ? { kind: "noop" } : undefined

/**
 * `src/Emit.ts`'s `failurePromptWrapper` — wraps a `command` step's
 * `onFailure` fix prompt around its inner command. The header/middle/footer
 * constants below bracket the one variable part of the template (the inner
 * command's text, and the shell-quoted prompt), matching
 * `failurePromptWrapper`'s own `.join("\n")` shape exactly; the extracted
 * `inner`/`prompt` pair is then confirmed by RE-RUNNING `failurePromptWrapper`
 * and string-comparing, same discipline as every other recognizer here.
 * Recurses into `recognizeGtdCheck ?? recognizeScriptedCommand` on the
 * unwrapped inner text (the only two step "command" shapes this suite emits),
 * and on a failing inner outcome prefixes the prompt onto its error — the
 * fake's stand-in for what the real wrapper prints to stdout before exiting
 * non-zero.
 */
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

  const innerOutcome =
    recognizeGtdCheck(repo, inner) ?? recognizeScriptedCommand(repo, commands, inner)
  if (innerOutcome === undefined) return undefined
  if (innerOutcome.kind === "failed") {
    return { kind: "failed", error: `${prompt}\n\n${innerOutcome.error}` }
  }
  return innerOutcome
}

/**
 * `src/ModeContradiction.ts`'s `modeContradictionSkipNotice` — a mode whose
 * validator is EXTERNAL (a genuine user `validate:` override, or any
 * command-validated non-built-in mode). A single loosely-recognized `printf`
 * line, re-derived and compared against the real builder from the mode name
 * embedded in its own (decoded) message text — same "call the real builder,
 * never hand-copy its template" discipline as every other recognizer here,
 * just extracting the one argument (`mode`) the builder needs from the
 * message rather than from the shell syntax around it.
 */
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

/**
 * Parses `block` back into `buildModeContradictionCheck`'s own inputs, or
 * `undefined` when it isn't one — split out of `recognizeModeContradictionCheck`
 * so extraction (many small guards, no repo effects) and simulation (few
 * guards, all the effects) each stay simple enough to read as their own
 * function. Confirmed, like every other builder-backed recognizer here, by
 * RE-RUNNING `buildModeContradictionCheck` on the recovered pieces and
 * requiring a byte-for-byte match — a wrong guess anywhere just fails to
 * parse rather than mis-simulating.
 */
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
 * Runs one PARSED round-trip against `repo`: writes the sample to the
 * scratch path, runs its `format:` command through the scripted-command
 * table (the only way a command executes against the in-memory tier — real
 * bash is unreachable there), re-validates whatever ended up at the scratch
 * path with the format's own parser, and cleans the scratch path up on
 * every path out — mirroring the real script's `rm -f` on both the failure
 * and success branches. An unscripted `format:` command fails loudly
 * (mirroring `makeScriptedCommandRunner`'s own "unscripted command" error)
 * rather than silently succeeding.
 */
const simulateModeContradictionCheck = (
  repo: InMemRepo,
  commands: ReadonlyMap<string, ScriptedCommand>,
  parsed: ParsedModeContradictionCheck,
): BlockOutcome => {
  const { mode, samplePath, sample, formatCommand, format } = parsed
  repo.writeFile(samplePath, sample)
  const formatOutcome = recognizeScriptedCommand(repo, commands, formatCommand)
  if (formatOutcome === undefined) {
    repo.deleteFile(samplePath)
    return {
      kind: "failed",
      error: `unscripted command "${formatCommand}" — declare it with a Given step`,
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

/**
 * `gtd uncheck <file>` — the review-gate reset `renderDecision` (`src/Edge.ts`)
 * prepends ahead of the human's own commit (package 01). Re-runs the real
 * `clearFilePointerTicks` against the repo's current content, writing back
 * only on an actual change, mirroring `runUncheckCommand`'s own behavior
 * (`src/program.ts`) — an absent file is a no-op, same as a real invocation.
 */
const recognizeGtdUncheck = (repo: InMemRepo, block: string): BlockOutcome | undefined => {
  const match = GTD_UNCHECK_RE.exec(block)
  if (!match) return undefined
  const [file] = extractQuotedTokens(match[1]!)
  if (file === undefined) return undefined
  const content = repo.readFile(file)
  if (content === undefined) return { kind: "noop" }
  const cleared = clearFilePointerTicks(content)
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

/**
 * `Emit.ts`'s `combinedScript` optional-half wrapper: `PRESENTATION_ONLY_COMMENT`
 * immediately followed (no blank line) by `(\n<optional>\n) || <warning>` —
 * kept as ONE block by `splitBlocks`'s subshell-depth tracking, even though
 * `<optional>` itself may carry blank lines. Recurses into
 * `applyEmittedScript` on the unwrapped inner script and ALWAYS reports
 * `noop` regardless of the inner result — mirroring bash's own `( … ) ||
 * <warning>` semantics, where the subshell's exit status is swallowed and
 * must never fail the outer script.
 */
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

/** Anything left over must be an EXACT hit in the scripted-command table — mirrors `makeScriptedCommandRunner`'s two `kind`s (`Layers.ts`). */
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
 * Splits `script` into blocks on blank lines, IGNORING blank lines that fall
 * inside a single-quoted string. A commit message is a quoted argument that
 * routinely spans a blank line — every trailer-carrying subject
 * (`gtd(human): x\n\nGtd-Cost: …`) does — so a naive `split(/\n{2,}/)` tears
 * one `commitAll` block into fragments that recognize as nothing. POSIX
 * single quotes have no escape sequence of their own, so quote depth is
 * "toggle on every `'`" — with one correction that `shellQuote`'s nesting
 * makes load-bearing: the `\` in `'\''` (close, backslash-escaped literal
 * quote, reopen) escapes its following `'` OUTSIDE any quote, so that middle
 * quote must not toggle. Deliberately not a bash lexer — like every other
 * recognizer here, it only has to handle gtd's own closed emission
 * vocabulary, where no double-quoted string ever contains a `'`.
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
 * `Emit.ts`'s `combinedScript` wraps the optional half in a bare `(\n...\n) ||
 * <warning>` — a literal `(` line opens it, a `) || ...` line closes it — and
 * the optional script it wraps is itself a multi-section `assembleScript`
 * output with its OWN blank-line-separated sections inside. `splitBlocks`
 * below needs this depth (alongside quote state) to keep blank lines inside
 * an open subshell from splitting it apart before `recognizePresentationSubshell`
 * ever sees the whole thing. Safe to key on a bare `(`/`)` line specifically
 * because no other emitted shape in this closed vocabulary ever produces one.
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
  (block) => recognizeGitBuilders(repo, block),
  (block) => recognizeFailurePromptWrapper(repo, commands, block),
  (block) => recognizePresentationSubshell(repo, commands, block),
  (block) => recognizeModeContradictionSkipNotice(block),
  (block) => recognizeModeContradictionCheck(repo, commands, block),
  (block) => recognizeGtdCheck(repo, block),
  (block) => recognizeGtdUncheck(repo, block),
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
