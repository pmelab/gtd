import type { GitWrite, LandStep, Outcome } from "../step/index.js"

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
const commitAllowEmpty = (message: string, only?: string): string =>
  commitWordAllowEmpty(shellQuote(message), only)

/** `commitAllowEmpty` over a message that is already a shell word. */
const commitWordAllowEmpty = (m: string, only?: string): string => {
  const paths = only === undefined ? "" : ` -- ${shellQuote(only)}`
  return [
    `if ! out=$(git commit --allow-empty -m ${m}${paths} 2>&1); then`,
    `  case "$out" in`,
    `    *"empty git commit"*) git commit --allow-empty --no-verify -m ${m}${paths} || exit 1 ;;`,
    `    *) printf '%s\\n' "$out" >&2; exit 1 ;;`,
    `  esac`,
    `fi`,
  ].join("\n")
}

export const CHANGED_SINCE_LAND =
  "gtd: the working tree changed since `gtd land` — revert the edits and run `gtd land` again to approve"

/** `git add -A || exit 1` (an `&&` left side would not abort under `set -e`) then `commitAllowEmpty`. */
export const commitAll = (message: string): string =>
  `git add -A || exit 1\n${commitAllowEmpty(message)}`

/** Commits `path` alone, as the worktree has it; every other pending change stays pending. */
export const commitPath = (path: string, message: string): string =>
  `git add -A -- ${shellQuote(path)} || exit 1\n${commitAllowEmpty(message, path)}`

/**
 * A `run()` body that records its own failure instead of failing the beat: the
 * status and the last 50 output lines go to `path`, and the script exits zero
 * so the turn lands. The file is COMMITTED (and force-pushed with a history
 * remote), hence the cap.
 */
export const failRestScript = (body: string, path: string): string => {
  const p = shellQuote(path)
  const slash = path.lastIndexOf("/")
  return [
    `rm -f -- ${p}`,
    `gtd_run_status=0`,
    `gtd_run_out="$( {`,
    body,
    `} 2>&1 )" || gtd_run_status=$?`,
    `printf '%s\\n' "$gtd_run_out"`,
    `if [ "$gtd_run_status" -ne 0 ]; then`,
    `  mkdir -p ${shellQuote(path.slice(0, slash))}`,
    `  printf 'exit %s\\n%s\\n' "$gtd_run_status" "$(printf '%s\\n' "$gtd_run_out" | tail -n 50)" >${p}`,
    `fi`,
  ].join("\n")
}

/** A pin beat's script. A failed `gtd bundle` leaves no half-written pin behind. */
export const pinScript = (path: string): string => {
  const p = shellQuote(path)
  const slash = path.lastIndexOf("/")
  const mkdir = slash === -1 ? "" : `mkdir -p ${shellQuote(path.slice(0, slash))}\n`
  return `${mkdir}gtd bundle >${p} || { rm -f -- ${p}; exit 1; }`
}

/** `gtd repin`'s pin write: a failed `gtd bundle` leaves the committed pin in place. */
export const repinScript = (path: string): string => {
  const p = shellQuote(path)
  const next = shellQuote(`${path}.new`)
  return `gtd bundle >${next} || { rm -f -- ${next}; exit 1; }\nmv -f -- ${next} ${p}`
}

/** An unpin beat's script, and `gtd abandon`'s removal of the pin. */
export const unpinScript = (path: string): string => `rm -f -- ${shellQuote(path)}`

/**
 * An approval records exactly the judged tree: HEAD is pinned before the
 * clean check and the commit is built over its tree with `commit-tree`, so no
 * hook runs and none can add to it. A HEAD that moved fails the guarded
 * `update-ref`. `commit-tree` ignores `commit.gpgSign`, so it is read here.
 */
export const commitClean = (message: string): string =>
  [
    `gtd_head=$(git rev-parse --verify HEAD) || exit 1`,
    `if [ -n "$(git status --porcelain --untracked-files=all --ignore-submodules=none)" ]; then`,
    `  printf '%s\\n' ${shellQuote(CHANGED_SINCE_LAND)} >&2`,
    `  exit 1`,
    `fi`,
    `gtd_sign_cfg=$(git config --type=bool --default=false commit.gpgSign) || exit 1`,
    `if [ "$gtd_sign_cfg" = true ]; then gtd_sign=-S; else gtd_sign=--no-gpg-sign; fi`,
    `gtd_tip=$(git commit-tree "$gtd_sign" "$gtd_head^{tree}" -p "$gtd_head" -m ${shellQuote(message)}) || exit 1`,
    `git update-ref -m ${shellQuote(`commit: ${message}`)} HEAD "$gtd_tip" "$gtd_head" || exit 1`,
  ].join("\n")

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

/**
 * POSIX sh (runs under dash). The marker is a `commit-tree` over HEAD's own
 * tree, so no hook runs on it and its tree is the pre-turn tree by
 * construction; `commit-tree` ignores `commit.gpgSign`, hence the explicit
 * `-S`, read (and failing closed) before any object or ref is written; the
 * index is already staged by then, so an early exit leaves the turn staged.
 * The kept ref is deleted only after `reset -q` succeeds: it is then the
 * turn's only handle.
 * The branch moves before the final hard reset, so if that reset fails the
 * marker has landed and the turn is still in the working tree (kept ref
 * present); every other failure leaves the branch untouched.
 */
export const keepTurn = (refPrefix: string, message: string): string => {
  const keptRef = `${shellQuote(`${refPrefix}/`)}"$gtd_kept"`
  return [
    `git add -A || exit 1`,
    `gtd_sign_cfg=$(git config --type=bool --default=false commit.gpgSign) || exit 1`,
    `if [ "$gtd_sign_cfg" = true ]; then gtd_sign=-S; else gtd_sign=--no-gpg-sign; fi`,
    `gtd_head=$(git rev-parse --verify HEAD) || exit 1`,
    `gtd_tree=$(git write-tree) || exit 1`,
    `gtd_kept=$(git commit-tree "$gtd_tree" -p "$gtd_head" -m ${shellQuote(message)}) || exit 1`,
    `git update-ref ${keptRef} "$gtd_kept" || exit 1`,
    `gtd_marker=$(printf '%s\\nGtd-Kept: %s' ${shellQuote(message)} "$gtd_kept")`,
    `if ! gtd_tip=$(git commit-tree "$gtd_sign" "$gtd_head^{tree}" -p "$gtd_head" -m "$gtd_marker") || ! git update-ref -m ${shellQuote(`commit: ${message}`)} HEAD "$gtd_tip" "$gtd_head"; then`,
    `  git reset -q && git update-ref -d ${keptRef}`,
    `  exit 1`,
    `fi`,
    `git reset --hard HEAD`,
  ].join("\n")
}

/** `git switch -C <branch> [<start>]`: create or reset the branch, carrying pending changes over. */
export const switchBranchTo = (branch: string, start?: string): string =>
  `git switch -q -C ${shellQuote(branch)}${start === undefined ? "" : ` ${shellQuote(start)}`}`

/** `git switch <branch>`: an existing branch, carrying pending changes over. */
export const switchTo = (branch: string): string => `git switch -q ${shellQuote(branch)}`

/** `switchTo` that, when pending changes block it, stays put and says so: the landing already happened. */
export const switchBack = (branch: string): string =>
  [
    `if ! git switch -q ${shellQuote(branch)} 2>/dev/null; then`,
    `  printf '%s\\n' ${shellQuote(`gtd: pending changes keep HEAD off ${branch}; switch to it once they are committed or stashed`)}`,
    `fi`,
  ].join("\n")

export const deleteBranch = (branch: string): string => `git branch -q -D ${shellQuote(branch)}`

/**
 * Force-pushes one ref to a remote. A failed push exits non-zero with the retry
 * on stderr: it runs after the closing commit has landed, so the commit stands.
 */
export const pushRef = (remote: string, ref: string): string => {
  const retry = `git push --force ${shellQuote(remote)} ${shellQuote(`${ref}:${ref}`)}`
  return [
    `if ! ${retry}; then`,
    `  printf '%s\\n' ${shellQuote(`gtd: pushing ${ref} failed — retry: ${retry}`)} >&2`,
    `  exit 1`,
    `fi`,
  ].join("\n")
}

/**
 * A ship step's landing, in one block because the landing commit's
 * `Gtd-Shipped` trailer names the squash it makes first. The squash carries
 * the staged tree with `.gtd/` as `<branch>` has it, built in a scratch index; `<branch>` moves by
 * compare-and-swap against `parent`, so a branch moved since the decision
 * fails the script before the landing commits. `commit-tree` ignores
 * `commit.gpgSign`, so it is read here.
 */
export const shipCommit = (
  branch: string,
  parent: string,
  shipMessage: string,
  historyRef: string,
  message: string,
): string =>
  [
    `gtd_ship_parent=${shellQuote(parent)}`,
    `gtd_ship_branch=${shellQuote(branch)}`,
    `gtd_ship_history=${shellQuote(historyRef)}`,
    `gtd_ship_message=${shellQuote(shipMessage)}`,
    `gtd_land_message=${shellQuote(message)}`,
    `git add -A || exit 1`,
    `gtd_sign_cfg=$(git config --type=bool --default=false commit.gpgSign) || exit 1`,
    `if [ "$gtd_sign_cfg" = true ]; then gtd_sign=-S; else gtd_sign=--no-gpg-sign; fi`,
    `gtd_head=$(git rev-parse --verify HEAD) || exit 1`,
    `gtd_tree=$(git write-tree) || exit 1`,
    `gtd_index=$(git rev-parse --git-path gtd-ship-index) || exit 1`,
    `rm -f -- "$gtd_index"`,
    `GIT_INDEX_FILE="$gtd_index" git read-tree "$gtd_tree" || exit 1`,
    `GIT_INDEX_FILE="$gtd_index" git rm -r -q --cached --ignore-unmatch -- .gtd || exit 1`,
    `git ls-tree -r "$gtd_ship_parent" -- .gtd | GIT_INDEX_FILE="$gtd_index" git update-index --index-info || exit 1`,
    `gtd_ship_tree=$(GIT_INDEX_FILE="$gtd_index" git write-tree) || exit 1`,
    `rm -f -- "$gtd_index"`,
    `gtd_ship_trailers=$(printf "Gtd-History: %s\\nGtd-Tip: %s" "$gtd_ship_history" "$gtd_head")`,
    `gtd_shipped=$(git commit-tree "$gtd_sign" "$gtd_ship_tree" -p "$gtd_ship_parent" -m "$gtd_ship_message" -m "$gtd_ship_trailers") || exit 1`,
    `git update-ref -m "gtd: ship" "refs/heads/$gtd_ship_branch" "$gtd_shipped" "$gtd_ship_parent" || exit 1`,
    `gtd_message=$(printf "%s\\nGtd-Shipped: %s" "$gtd_land_message" "$gtd_shipped")`,
    commitWordAllowEmpty(`"$gtd_message"`),
  ].join("\n")

export const updateRef = (ref: string, hash: string): string =>
  `git update-ref ${shellQuote(ref)} ${shellQuote(hash)}`

/** `git update-ref -d <ref>` — idempotent: deleting a missing ref is already a no-op in real git. */
export const deleteRef = (ref: string): string => `git update-ref -d ${shellQuote(ref)}`

/**
 * No `+` on the refspec: a local ref the remote's tip does not descend from
 * fails the fetch instead of being overwritten (a fast-forward still applies).
 */
export const fetchHistoryRefs = (remote: string): string =>
  [
    `set -eu`,
    `before=$(git for-each-ref --format='x' 'refs/gtd/history/' | wc -l)`,
    `git fetch ${shellQuote(remote)} 'refs/gtd/history/*:refs/gtd/history/*'`,
    `after=$(git for-each-ref --format='x' 'refs/gtd/history/' | wc -l)`,
    `printf '%s history refs arrived\\n' "$((after - before))"`,
  ].join("\n")

// ── ScriptSurface: LandStep[] → shell ────────────────────────────────────────
//
// The sole place `src/step/`'s `LandStep` data becomes runnable shell text.
// Deliberately does NOT import `src/emit/OutcomeScript.ts`/`src/emit/Emit.ts` (both
// import `shellQuote` from this file already) — a reverse import back into
// either would be a real cycle, not just a lint nit, so the two `printf`
// builders below are a small, load-bearing duplication of
// `OutcomeScript.ts`'s `transitionOutcome`/`commitOutcome`, not shared code.
// No test asserts the two stay byte-identical; a drift between them is a
// review-time risk this boundary accepts.

/** Marks an emitted block as print-only — mirrors `OutcomeScript.ts`'s `OUTCOME_MARKER` verbatim, so `src/twins/EmittedScriptRecognizer.ts` recognizes either path's output identically. */
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

type Renderers = {
  readonly [K in GitWrite["kind"]]: (write: Extract<GitWrite, { kind: K }>) => string
}

const GIT_WRITES: Renderers = {
  commitAll: (w) => commitAll(w.message),
  commitPath: (w) => commitPath(w.path, w.message),
  commitClean: (w) => commitClean(w.message),
  updateRef: (w) => updateRef(w.ref, w.target),
  keepTurn: (w) => keepTurn(w.ref, w.message),
  switchBranch: (w) => switchBranchTo(w.branch),
  switchTo: (w) => switchBack(w.branch),
  pushRef: (w) => pushRef(w.remote, w.ref),
  ship: (w) => shipCommit(w.branch, w.parent, w.shipMessage, w.historyRef, w.message),
}

const renderGitWrite = (write: GitWrite): string =>
  (GIT_WRITES[write.kind] as (write: GitWrite) => string)(write)

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
  // Its findings were decided before the script; here it only rewrites the file.
  if (step.kind === "format")
    return `gtd check --write ${shellQuote(step.file)} >/dev/null 2>&1 || :`
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
