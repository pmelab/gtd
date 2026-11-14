// Each block is recognized by RE-RUNNING the same `GitScript.ts`/`Emit.ts`
// builder against values extracted from it and comparing strings — never by
// duplicating a builder's template as a regex — so an unrecognized block
// fails loudly instead of silently passing through.

import {
  commitAll,
  commitAsIs,
  commitClean,
  commitPath,
  deleteRef,
  discardPending,
  hardResetTo,
  keepTurn,
  mixedResetTo,
  switchBranchTo,
  switchBack,
  switchTo,
  deleteBranch,
  pushRef,
  shipCommit,
  shellQuote,
  softResetTo,
  updateRef,
  failurePromptWrapper,
  PRESENTATION_FAILURE_WARNING,
  PRESENTATION_ONLY_COMMENT,
  OUTCOME_MARKER,
  pinScript,
  failRestScript,
  repinScript,
  unpinScript,
} from "../emit/index.js"
import { serialize } from "../steering/internal.js"
import { refNameFault } from "../replay/index.js"
import { PIN_PATH, renderFormat } from "../wire/index.js"
import { applyFlowScript, rewritten } from "./FlowScripts.js"
import type { InMemRepo } from "./InMemRepo.js"
import type { CommandTable } from "./Layers.js"

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

const attempt = (apply: () => void): BlockOutcome => {
  try {
    apply()
    return { kind: "applied" }
  } catch (e) {
    return {
      kind: "failed",
      error: `fatal: ${e instanceof Error ? e.message : String(e)}`,
      status: 128,
    }
  }
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

  if (block.startsWith("git add -A -- ")) {
    const [path, message] = extractQuotedTokens(block)
    if (path === undefined || message === undefined || commitPath(path, message) !== block) {
      return undefined
    }
    const failure = repo.commitPath(path, message)
    return failure === undefined
      ? { kind: "applied" }
      : { kind: "failed", error: failure, status: 1 }
  }

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

  if (block.startsWith("git switch -q -C ")) {
    const [branch, start] = extractQuotedTokens(block)
    if (branch !== undefined && switchBranchTo(branch, start) === block) {
      return attempt(() => repo.switchBranchTo(branch, start))
    }
    return undefined
  }

  if (block.startsWith("if ! git switch -q ")) {
    const [branch, , note] = extractQuotedTokens(block)
    if (branch !== undefined && switchBack(branch) === block) {
      try {
        repo.switchTo(branch)
        return { kind: "applied" }
      } catch {
        return { kind: "noop", output: `${note}\n` }
      }
    }
    return undefined
  }

  if (block.startsWith("git switch -q ")) {
    const [branch] = extractQuotedTokens(block)
    if (branch !== undefined && switchTo(branch) === block) {
      return attempt(() => repo.switchTo(branch))
    }
    return undefined
  }

  if (block.startsWith("git branch -q -D ")) {
    const [branch] = extractQuotedTokens(block)
    if (branch !== undefined && deleteBranch(branch) === block) {
      return attempt(() => repo.deleteBranch(branch))
    }
    return undefined
  }

  if (block.startsWith("if ! git push --force ")) {
    const [remote, refspec] = extractQuotedTokens(block)
    const ref = refspec?.split(":")[0]
    if (remote !== undefined && ref !== undefined && pushRef(remote, ref) === block) {
      const failure = repo.pushRef(remote, ref)
      if (failure === undefined) return { kind: "applied" }
      const retry = extractQuotedTokens(block)[3]!
      return { kind: "failed", error: `${failure}\n${retry}`, status: 1 }
    }
    return undefined
  }

  if (block.startsWith("gtd_ship_parent=")) {
    const [parent, branch, shipMessage, message] = extractQuotedTokens(block)
    if (
      parent === undefined ||
      branch === undefined ||
      shipMessage === undefined ||
      message === undefined ||
      shipCommit(branch, parent, shipMessage, message) !== block
    ) {
      return undefined
    }
    const failure = repo.shipCommit(branch, parent, shipMessage, message)
    return failure === undefined
      ? { kind: "applied" }
      : { kind: "failed", error: failure, status: 1 }
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

/** What the in-memory `gtd bundle` prints: a pin header, and no engine behind it. */
const IN_MEMORY_PIN = "gtdpin 1 gtd in-memory\n"

/** A pin or unpin beat's script, or `gtd repin`'s. */
const recognizePinScripts = (repo: InMemRepo, block: string): BlockOutcome | undefined => {
  if (block === pinScript(PIN_PATH) || block === repinScript(PIN_PATH)) {
    repo.writeFile(PIN_PATH, IN_MEMORY_PIN)
    return { kind: "applied" }
  }
  if (block === unpinScript(PIN_PATH)) {
    if (repo.readFile(PIN_PATH) !== undefined) repo.deleteFile(PIN_PATH)
    return { kind: "applied" }
  }
  return undefined
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

const FAIL_REST_MIDDLE = '\n} 2>&1 )" || gtd_run_status=$?\n'

/** A `run(…, { onFail: "rest" })` body: the inner script's failure is recorded in the tree and the block itself succeeds. */
// fallow-ignore-next-line complexity
const recognizeFailRest = (
  repo: InMemRepo,
  commands: CommandTable,
  block: string,
): BlockOutcome | undefined => {
  if (!block.startsWith("rm -f -- '") || !block.includes("gtd_run_out=")) return undefined
  const [path] = extractQuotedTokens(block)
  const headerEnd = block.indexOf('gtd_run_out="$( {\n')
  const bodyEnd = block.indexOf(FAIL_REST_MIDDLE)
  if (path === undefined || headerEnd === -1 || bodyEnd === -1) return undefined
  const body = block.slice(headerEnd + 'gtd_run_out="$( {\n'.length, bodyEnd)
  if (failRestScript(body, path) !== block) return undefined
  if (repo.readFile(path) !== undefined) repo.deleteFile(path)
  const result = applyEmittedScript(repo, commands, body)
  if (!result.ok && result.error?.startsWith(UNRECOGNIZED_PREFIX)) {
    return { kind: "failed", error: `${result.output}${result.error}` }
  }
  if (!result.ok) {
    // Mirrors `$(…)` (strips trailing newlines) and the script's `tail -n 50`.
    const lines = result.output.replace(/\n+$/, "").split("\n")
    repo.writeFile(path, `exit ${result.status}\n${lines.slice(-50).join("\n")}\n`)
  }
  return { kind: "noop", output: result.output }
}

/**
 * `failurePromptWrapper`. The constants below bracket the template's one
 * variable part; the extracted pair is confirmed by RE-RUNNING the real
 * builder and string-comparing. On a failing inner outcome it prefixes the
 * prompt onto the error — the fake's stand-in for what the real wrapper
 * prints before exiting non-zero.
 */
const FAILURE_PROMPT_HEADER = 'gtd_validate_status=0\ngtd_validate_out="$( {\n'
const FAILURE_PROMPT_MIDDLE =
  '\n} 2>&1 )" || gtd_validate_status=$?\n' +
  'if [ "$gtd_validate_status" -ne 0 ]; then\n' +
  "  printf '%s\\n\\n%s\\n' "
const FAILURE_PROMPT_FOOTER = ' "$gtd_validate_out"\n  exit "$gtd_validate_status"\nfi'

const recognizeFailurePromptWrapper = (
  repo: InMemRepo,
  commands: CommandTable,
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

  const innerOutcome = recognizeScriptedCommand(repo, commands, inner)
  if (innerOutcome === undefined) return undefined
  if (innerOutcome.kind === "failed") {
    // `"$( … )"` strips the captured output's trailing newlines.
    const captured = innerOutcome.error.replace(/\n+$/, "")
    return { kind: "failed", error: `${prompt}\n\n${captured}`, status: innerOutcome.status ?? 1 }
  }
  return innerOutcome
}

const GTD_FORMAT_RE = /^gtd check --write (.+) >\/dev\/null 2>&1 \|\| :$/

/** `gtd check --write <file> … || :` — a widget steering file serialized ahead of the commit; never fails. */
const recognizeGtdFormat = (repo: InMemRepo, block: string): BlockOutcome | undefined => {
  const match = GTD_FORMAT_RE.exec(block)
  if (!match) return undefined
  const [file] = extractQuotedTokens(match[1]!)
  if (file === undefined) return undefined
  const content = repo.readFile(file)
  if (content === undefined) return { kind: "noop" }
  const canonical = serialize(content)
  if (canonical !== content) repo.writeFile(file, canonical)
  return { kind: "noop" }
}

/**
 * A block of nothing but comments is a no-op in `sh` too — `combinedScript`'s
 * leading `DID_NOT_RUN_COMMENT`, and the list of paths a start commits.
 */
const recognizeCommentBlock = (block: string): BlockOutcome | undefined =>
  block.split("\n").every((line) => line.startsWith("#")) ? { kind: "noop" } : undefined

/** `combinedScript`'s optional half. Reports `noop` whatever the inner result, mirroring bash's `( … ) || <warning>`. Exception: under `git: false` any unrecognized inner block fails the outer script (git or not), so the in-memory twin knowingly diverges from `sh` rather than run git unseen. */
const PRESENTATION_FAILURE_TEXT = `${extractQuotedTokens(PRESENTATION_FAILURE_WARNING)[0]!.replace(/\\n$/, "")}\n`
const PRESENTATION_SUBSHELL_PREFIX = `${PRESENTATION_ONLY_COMMENT}\n(\n`
const PRESENTATION_SUBSHELL_SUFFIX = `\n) || ${PRESENTATION_FAILURE_WARNING}`

const recognizePresentationSubshell = (
  repo: InMemRepo,
  commands: CommandTable,
  block: string,
  git: boolean,
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
  const result = applyEmittedScript(repo, commands, inner, { git })
  if (result.ok) return { kind: "noop", output: result.output }
  if (!git && result.error?.startsWith(UNRECOGNIZED_PREFIX)) {
    return { kind: "failed", error: `${result.output}${result.error}` }
  }
  return { kind: "noop", output: `${result.output}${PRESENTATION_FAILURE_TEXT}` }
}

/** Anything left over must be an EXACT hit in the scripted-command table — mirrors `ScriptedCommand`'s two `kind`s (`Layers.ts`). */
const recognizeScriptedCommand = (
  repo: InMemRepo,
  commands: CommandTable,
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
  scripted.effect?.()
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
  commands: CommandTable,
  git: boolean,
): ReadonlyArray<(block: string) => BlockOutcome | undefined> => [
  (block) => recognizeSetFlags(block),
  (block) => recognizeCommentBlock(block),
  (block) => recognizePrecondition(repo, block),
  (block) => (git ? recognizeGitBuilders(repo, block) : undefined),
  (block) => recognizeWriteLines(repo, block),
  (block) => recognizePinScripts(repo, block),
  (block) => recognizeFailRest(repo, commands, block),
  (block) => recognizeFailurePromptWrapper(repo, commands, block),
  (block) => recognizePresentationSubshell(repo, commands, block, git),
  (block) => recognizeGtdFormat(repo, block),
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
  commands: CommandTable,
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
  commands: CommandTable,
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

const UNRECOGNIZED_PREFIX = "unrecognized script block: "

const unrecognized = (block: string, output = ""): AppliedScriptResult => ({
  ok: false,
  status: 1,
  output,
  error: `${UNRECOGNIZED_PREFIX}${block.split("\n")[0]}`,
})
