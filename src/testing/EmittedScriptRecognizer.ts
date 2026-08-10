/**
 * Applies an EMITTED bash script (the text `src/GitScript.ts`'s builders
 * produce, assembled into one script by `src/Emit.ts`) onto an `InMemRepo`,
 * so the `@inmem` e2e tier keeps observing commits once a command starts
 * printing a script instead of writing git directly. This is `world.ts`'s
 * ONE bridge from a `gtd`-emitted `required`/`optional` script back onto the
 * fake repo — it exists so a scenario asserting on `gitLog()`/`gitStatus()`/
 * etc. after a plain (non-`--json`) `gtd step`/`gtd --entry` keeps working
 * once that command stops writing git itself and starts only PRINTING what a
 * driver should run.
 *
 * The recognized vocabulary is closed and small: the 9 `GitScript.ts`
 * builders (both bare, and wrapped in `src/Emit.ts`'s `gtd_retry` retry
 * helper — see `recognizeRetryWrappedGitWrite`), the two compound
 * `src/ReviewWindow.ts` open/close sequences (bare or retry-wrapped — see
 * `recognizeReviewWindowOpen`/`Close`), `src/Emit.ts`'s real preamble
 * (`set -euo pipefail`, the HEAD assertion, the optional review-window-ref
 * assertion, the `gtd_retry` function definition itself), a `gtd check <mode>
 * <file>` line, one invented placeholder precondition shape (see
 * `preconditionHeadEquals` — kept only because some unit tests below still
 * hand-build scripts with it; no production emitter writes it any more), and
 * anything else must be an EXACT hit in the scripted-command table
 * (`ScriptedCommand`, `Layers.ts`). Recognition works by SPLITTING the script
 * into blocks on blank lines, then matching each block in turn — this is
 * deliberately not a general bash parser, only a recognizer for gtd's own
 * known emission shapes. A git builder block (or an `src/Emit.ts` assertion)
 * is verified by RE-RUNNING the same builder function against the values
 * extracted from the block and comparing strings, rather than duplicating
 * each builder's template as a second regex — so this module can never drift
 * from its source of truth.
 *
 * An unrecognized block is the safety property this module exists for: it
 * must fail loudly (naming the offending line), never silently pass through,
 * so "someone added a builder without teaching the recognizer" fails a test
 * instead of producing a green run that proves nothing.
 */

import {
  commitAll,
  commitAsIs,
  deleteRef,
  discardPending,
  hardResetTo,
  mixedResetTo,
  restoreStagedFrom,
  shellQuote,
  softResetTo,
  updateRef,
} from "../GitScript.js"
import { headAssertion, reviewWindowAssertion } from "../Emit.js"
import {
  buildCloseWindowScript,
  buildOpenWindowScript,
  REVIEW_BASE_REF,
  REVIEW_HEAD_REF,
  type WindowRefs,
} from "../ReviewWindow.js"
import { steeringFormatFor } from "../SteeringFormats.js"
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

/** Bash's own no-op preamble decoration — never a failure, never applies anything. */
const SET_FLAGS_RE = /^set\s+-\S+(\s+\S+)*$/

const recognizeSetFlags = (block: string): BlockOutcome | undefined =>
  SET_FLAGS_RE.test(block) ? { kind: "noop" } : undefined

/**
 * This module's OWN invented precondition-assertion shape — a placeholder for
 * whatever preamble `src/Emit.ts` finalizes later, not a real gtd convention.
 * A `[ ... ] || { ...; exit 1; }` guard on the CURRENT `HEAD`, matching
 * `set -euo pipefail` semantics: a tripped precondition must stop the script,
 * exactly like a failed builder line would.
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
 * The 9 `GitScript.ts` builders. Each branch checks a cheap literal PREFIX
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

  // The three multi-line if/case/fi builders below re-quote their message
  // (and `restoreStagedFrom`'s retry `printf '%s\n'` literal) past their
  // opening `if ! out=$(...` statement — tokens are extracted from THAT
  // statement only, or a quoted fragment further down (e.g. `'%s\n'`) would
  // pollute the extracted args. Sliced by its `2>&1); then` terminator rather
  // than taken as one LINE, because a commit message is routinely multi-line
  // (every trailer-carrying subject is) and its later lines are part of the
  // same quoted argument.
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

  if (block.startsWith("if ! out=$(git restore --staged --source=")) {
    const [source, ...paths] = extractQuotedTokens(conditionLine)
    if (source !== undefined && restoreStagedFrom(source, paths) === block) {
      repo.restoreStagedFrom(source, paths)
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
 * `src/Emit.ts`'s REAL `headAssertion` block — the current, non-placeholder
 * preamble every assembled script (`emitScripts`) opens with, right after
 * `set -euo pipefail`. Re-derives the block from the extracted hash and
 * compares full strings, exactly like a `GitScript.ts` builder — so this can
 * never silently drift from `headAssertion`'s actual template. The real
 * probe (`git rev-parse --verify --quiet HEAD 2>/dev/null`) reads an unborn
 * HEAD back as an empty string; `InMemRepo.resolveRef` models the same
 * repository state as `null`, so `(actual ?? "") === hash` is the fake's
 * exact mirror of that behavior — no special-casing a hash stand-in needed.
 */
const recognizeHeadAssertion = (repo: InMemRepo, block: string): BlockOutcome | undefined => {
  const [hash] = extractQuotedTokens(block)
  if (hash === undefined || headAssertion(hash) !== block) return undefined
  const actual = repo.resolveRef("HEAD")
  if ((actual ?? "") === hash) return { kind: "noop" }
  return {
    kind: "failed",
    error: `gtd: repository changed since this script was generated (expected HEAD ${hash}, got ${actual ?? "(no commits)"})`,
  }
}

/**
 * `src/Emit.ts`'s REAL `reviewWindowAssertion` block — present only when the
 * target state declares `reviewWindow: true` AND a window is currently open.
 * Same re-derive-and-compare discipline as `recognizeHeadAssertion`; the ref
 * itself (never a hash) is read back via `resolveRef`, which is `null` for a
 * missing ref exactly like the real `git rev-parse --verify --quiet ...
 * 2>/dev/null` the block runs.
 */
const recognizeReviewWindowRefAssertion = (
  repo: InMemRepo,
  block: string,
): BlockOutcome | undefined => {
  const [ref, hash] = extractQuotedTokens(block)
  if (ref === undefined || hash === undefined || reviewWindowAssertion(ref, hash) !== block) {
    return undefined
  }
  const actual = repo.resolveRef(ref)
  if (actual === hash) return { kind: "noop" }
  return {
    kind: "failed",
    error: `gtd: review window ref ${ref} changed since this script was generated (expected ${hash}, got ${actual ?? "(missing)"})`,
  }
}

/**
 * `src/Emit.ts`'s `gtd_retry` bash FUNCTION DEFINITION (`RETRY_HELPER`) —
 * present as its own block whenever any step is a `gitWrite`. Defining a
 * function is inert (it does nothing until called), so this is always a
 * no-op regardless of the helper's exact body — unlike every other
 * recognizer here, there is nothing to re-derive-and-compare: the actual
 * WORK happens at each `gtd_retry '<command>'` CALL site, which
 * `recognizeRetryWrappedGitWrite` below unwraps and re-dispatches.
 */
const recognizeRetryHelperDefinition = (block: string): BlockOutcome | undefined =>
  block.startsWith("gtd_retry() {") ? { kind: "noop" } : undefined

/**
 * `src/ReviewWindow.ts`'s `buildCloseWindowScript` — the compound `mixedResetTo
 * && deleteRef && deleteRef` sequence `openReviewWindow`'s script-emitting
 * twin writes to close a review checkout window. Its three `&&`-joined lines
 * split cleanly on the exact `" &&\n"` separator `buildCloseWindowScript`
 * itself joins with (no existing builder's OWN output contains that
 * substring), so each part is handed to `extractQuotedTokens` alone —
 * exactly like `recognizeGitBuilders`'s single-builder cases — then the whole
 * block is re-derived via `buildCloseWindowScript` and string-compared,
 * rather than validating each part's shape separately.
 */
const recognizeReviewWindowClose = (repo: InMemRepo, block: string): BlockOutcome | undefined => {
  const parts = block.split(" &&\n")
  if (parts.length !== 3) return undefined
  const [headHash] = extractQuotedTokens(parts[0]!)
  const [headRef] = extractQuotedTokens(parts[1]!)
  const [baseRef] = extractQuotedTokens(parts[2]!)
  if (headHash === undefined || headRef === undefined || baseRef === undefined) return undefined
  const refs: WindowRefs = { headRef, baseRef, headHash, legacy: false }
  if (buildCloseWindowScript(refs) !== block) return undefined
  repo.mixedResetTo(headHash)
  repo.deleteRef(headRef)
  repo.deleteRef(baseRef)
  return { kind: "applied" }
}

/**
 * `src/ReviewWindow.ts`'s `buildOpenWindowScript` — the compound
 * `updateRef(base) && updateRef(head) && mixedResetTo(base) &&
 * restoreStagedFrom(.gtd)` sequence a step landing at a `reviewWindow: true`
 * state emits alongside its commit. `program.ts` (concurrent work) always
 * renders the HEAD ref update with the LITERAL string `'HEAD'` rather than a
 * resolved hash — the real hash isn't known until the required script's own
 * commit has actually landed, and real `git update-ref <ref> HEAD` resolves
 * the symbolic name at run time — so this recognizer only ever needs to match
 * that one literal shape (never an arbitrary resolved head). `InMemRepo.
 * updateRef` already resolves a symbolic value itself (`resolveRef(hash) ??
 * hash`), so passing `"HEAD"` straight through applies correctly with no
 * special-casing here. Same split-on-`" &&\n"` + re-derive-and-compare
 * discipline as `recognizeReviewWindowClose`; the fourth part
 * (`restoreStagedFrom`) needs no separate extraction since
 * `buildOpenWindowScript` hard-codes its ref/paths (`REVIEW_HEAD_REF`,
 * `[".gtd"]`) — the whole-string comparison verifies it for free.
 */
const recognizeReviewWindowOpen = (repo: InMemRepo, block: string): BlockOutcome | undefined => {
  const parts = block.split(" &&\n")
  if (parts.length !== 4) return undefined
  const [, base] = extractQuotedTokens(parts[0]!)
  const [, head] = extractQuotedTokens(parts[1]!)
  if (base === undefined || head === undefined) return undefined
  if (buildOpenWindowScript({ base, head }) !== block) return undefined
  repo.updateRef(REVIEW_BASE_REF, base)
  repo.updateRef(REVIEW_HEAD_REF, head)
  repo.mixedResetTo(base)
  repo.restoreStagedFrom(REVIEW_HEAD_REF, [".gtd"])
  return { kind: "applied" }
}

/**
 * `src/Emit.ts`'s `renderStep` wraps every `"gitWrite"` step as `gtd_retry
 * '<shellQuote-escaped whole command>'` — a SINGLE quoted argument, however
 * many physical lines the escaped command itself spans (a compound builder's
 * `&&`-joined lines survive as literal newlines inside the one quoted
 * string). `extractQuotedTokens` reconstructs that one argument regardless of
 * its internal newlines (the same property the multi-line `if`/`case`/`fi`
 * builders already rely on), so unwrapping is: extract the one token,
 * confirm the round trip via `shellQuote` (never hand-parse the escaping a
 * second time), then re-dispatch the UNWRAPPED command through the ordinary
 * git-builder/review-window recognizers — exactly as if it had never been
 * wrapped.
 */
const GTD_RETRY_PREFIX = "gtd_retry "

const recognizeRetryWrappedGitWrite = (
  repo: InMemRepo,
  block: string,
): BlockOutcome | undefined => {
  if (!block.startsWith(GTD_RETRY_PREFIX)) return undefined
  const [inner] = extractQuotedTokens(block)
  if (inner === undefined || `${GTD_RETRY_PREFIX}${shellQuote(inner)}` !== block) return undefined
  return (
    recognizeGitBuilders(repo, inner) ??
    recognizeReviewWindowClose(repo, inner) ??
    recognizeReviewWindowOpen(repo, inner)
  )
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
  // (a case the sign-off guard owns) into a script failure.
  const content = repo.readFile(file)
  if (content === undefined) return { kind: "noop" }
  const findings = format.validate(content)
  if (findings.length > 0) {
    return { kind: "failed", error: `gtd check ${mode} ${file}: ${findings.join("; ")}` }
  }
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

const splitBlocks = (script: string): readonly string[] => {
  const blocks: string[] = []
  let current = ""
  let quoted = false
  for (const line of script.trim().split("\n")) {
    if (!quoted && line.trim().length === 0) {
      if (current.trim().length > 0) blocks.push(current.trim())
      current = ""
      continue
    }
    current += (current.length > 0 ? "\n" : "") + line
    quoted = trackQuoteState(line, quoted)
  }
  if (current.trim().length > 0) blocks.push(current.trim())
  return blocks
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
  const blocks = splitBlocks(script)

  for (const block of blocks) {
    const outcome =
      recognizeSetFlags(block) ??
      recognizePrecondition(repo, block) ??
      recognizeHeadAssertion(repo, block) ??
      recognizeReviewWindowRefAssertion(repo, block) ??
      recognizeRetryHelperDefinition(block) ??
      recognizeGitBuilders(repo, block) ??
      recognizeReviewWindowClose(repo, block) ??
      recognizeReviewWindowOpen(repo, block) ??
      recognizeRetryWrappedGitWrite(repo, block) ??
      recognizeGtdCheck(repo, block) ??
      recognizeScriptedCommand(repo, commands, block)

    if (outcome === undefined) {
      return { ok: false, error: `unrecognized script block: ${block.split("\n")[0]}` }
    }
    if (outcome.kind === "failed") {
      return { ok: false, error: outcome.error }
    }
  }

  return { ok: true }
}
