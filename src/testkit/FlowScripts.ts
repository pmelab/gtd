// The in-memory twin of `sh` for the scripts `src/flows/scripts.ts` builds.
// Each script is recognized by RE-RUNNING its builder on the values pulled
// out of it and comparing bytes, then applied to the `InMemRepo` the way the
// real shell would. `FlowScripts.test.ts` runs the same cases through real
// `sh` and this twin, so the two cannot drift apart silently.

import {
  checkScript,
  moveScript,
  removeScript,
  restoreScript,
  revertScript,
  showScript,
} from "../flows/index.js"
import type { InMemRepo } from "./InMemRepo.js"
import type { ScriptedCommand } from "./Layers.js"

export interface FlowScriptResult {
  readonly ok: boolean
  /** Present exactly when `ok` is `false`. */
  readonly error?: string
  /** What the script printed to output. */
  readonly output: string
}

const SHEBANG = "#!/usr/bin/env sh"

const words = (text: string): string[] =>
  [...text.matchAll(/'((?:[^']|'\\'')*)'/g)].map((m) => m[1]!.replaceAll("'\\''", "'"))

const ok = (output = ""): FlowScriptResult => ({ ok: true, output })

/** `rm -rf -- <paths>`. `InMemRepo.pathsUnder("")` is the whole tree, where a real `rm -- ''` removes nothing. */
const removeAll = (repo: InMemRepo, paths: readonly string[]): void => {
  if (paths.includes("")) throw new Error("testkit: rm: refusing an empty path")
  for (const path of paths) for (const file of repo.pathsUnder(path)) repo.deleteFile(file)
}

const deleteIfPresent = (repo: InMemRepo, path: string): void => {
  if (repo.readFile(path) !== undefined) repo.deleteFile(path)
}

const recognizeRemove = (repo: InMemRepo, script: string): FlowScriptResult | undefined => {
  const line = script.split("\n").find((l) => l.startsWith("rm -rf -- ")) ?? ""
  const paths = words(line)
  if (removeScript(paths) !== script) return undefined
  removeAll(repo, paths)
  return ok()
}

const recognizeMove = (repo: InMemRepo, script: string): FlowScriptResult | undefined => {
  const line = script.split("\n").find((l) => l.startsWith("mv -- ")) ?? ""
  const [from, to] = words(line)
  if (from === undefined || to === undefined || moveScript(from, to) !== script) return undefined
  const content = repo.readFile(from)
  if (content === undefined) return { ok: false, error: `mv: ${from}: No such file`, output: "" }
  repo.deleteFile(from)
  repo.writeFile(to, content)
  return ok()
}

const recognizeShow = (repo: InMemRepo, script: string): FlowScriptResult | undefined => {
  const line = script.split("\n").find((l) => l.startsWith("git show ")) ?? ""
  const [source, to] = words(line)
  const at = source?.indexOf(":") ?? -1
  if (source === undefined || to === undefined || at === -1) return undefined
  const ref = source.slice(0, at)
  const path = source.slice(at + 1)
  if (showScript(ref, path, to) !== script) return undefined
  const content = repo.fileAtRef(ref, path)
  if (content === null)
    return { ok: false, error: `git show: ${source} does not exist`, output: "" }
  repo.writeFile(to, content)
  return ok()
}

/** `git diff --quiet <commit> -- <path>`: the worktree copy of a tracked path, or nothing for an untracked one, against `commit`'s. */
const unchangedSince = (repo: InMemRepo, commit: string, path: string): boolean => {
  const current = repo.isTracked(path) ? (repo.readFile(path) ?? null) : null
  return current === repo.fileAtRef(commit, path)
}

const RESTORE_LINE = / && git restore --source=/
const REMOVE_LINE = / && rm -f -- /

interface RestoreLine {
  readonly commit: string
  readonly path: string
  /** Set on a restore line, absent on a removal. */
  readonly source?: string
}

const parseRestoreLine = (line: string): RestoreLine | undefined => {
  const [commit, path, source] = words(line)
  if (commit === undefined || path === undefined) return undefined
  if (RESTORE_LINE.test(line) && source !== undefined) return { commit, path, source }
  return REMOVE_LINE.test(line) ? { commit, path } : undefined
}

/** Applies one line, returning its exit status as `sh` would see it. */
const applyRestoreLine = (repo: InMemRepo, { commit, path, source }: RestoreLine): boolean => {
  if (!unchangedSince(repo, commit, path)) return false
  // `git restore` rejects a source that names no commit, touching nothing.
  if (source !== undefined && repo.resolveRef(source) === null) return false
  const content = source === undefined ? null : repo.fileAtRef(source, path)
  if (content !== null) repo.writeFile(path, content)
  else if (source === undefined || repo.isTracked(path)) deleteIfPresent(repo, path)
  return true
}

const recognizeRestore = (repo: InMemRepo, script: string): FlowScriptResult | undefined => {
  const parsed = script.split("\n").slice(2, -1).map(parseRestoreLine)
  if (parsed.includes(undefined)) return undefined
  const lines = parsed as RestoreLine[]
  const restoring = lines.filter((l) => l.source !== undefined)
  const paths = {
    restore: restoring.map((l) => l.path),
    remove: lines.filter((l) => l.source === undefined).map((l) => l.path),
  }
  const commit = lines[0]?.commit ?? ""
  if (restoreScript(commit, paths, restoring[0]?.source) !== script) return undefined
  // `sh` exits with the last line's status: a final path left alone fails it.
  const statuses = lines.map((line) => applyRestoreLine(repo, line))
  if (statuses.at(-1) === false) {
    return { ok: false, error: "the last path changed since the commit", output: "" }
  }
  return ok()
}

const PATCH_FAILED = "error: patch does not apply"

/**
 * `git diff C^ C | git apply -R`, which is all or nothing. A file still
 * exactly as `C` left it reverts; a file gone, or one `C` added and that
 * changed since, fails the whole patch. A file `C` modified and that changed
 * since may still apply through its context — that needs real git, so it
 * throws rather than guess.
 */
const reverseApply = (repo: InMemRepo, commit: string): string | undefined => {
  const parent = `${commit}^`
  const paths = new Set([...repo.pathsAtRef(parent), ...repo.pathsAtRef(commit)])
  const changed = [...paths].filter((p) => repo.fileAtRef(parent, p) !== repo.fileAtRef(commit, p))
  for (const path of changed) {
    const after = repo.fileAtRef(commit, path)
    const current = repo.readFile(path) ?? null
    if (current === after) continue
    if (current === null || after === null || repo.fileAtRef(parent, path) === null) {
      return `${PATCH_FAILED}: ${path}`
    }
    throw new Error(
      `testkit: cannot tell in memory whether reverting ${commit} applies to the hand-edited ${path} — run this @live`,
    )
  }
  for (const path of changed) {
    const before = repo.fileAtRef(parent, path)
    if (before === null) repo.deleteFile(path)
    else repo.writeFile(path, before)
  }
  return undefined
}

const recognizeRevert = (repo: InMemRepo, script: string): FlowScriptResult | undefined => {
  const lines = script.split("\n")
  const [, commit] = words(lines.find((l) => l.startsWith("if ! git diff --quiet ")) ?? "")
  const [, failure] = words(lines.find((l) => l.includes("printf '%s\\n\\n' ")) ?? "")
  const [report] = words(lines.find((l) => l.startsWith("    } > ")) ?? "")
  if (commit === undefined || failure === undefined || report === undefined) return undefined
  if (revertScript(commit, report, failure) !== script) return undefined
  const error = reverseApply(repo, commit)
  if (error !== undefined) repo.writeFile(report, `${failure}\n\n${error}\n`)
  return ok()
}

type PreambleOutcome = { readonly exit: boolean; readonly output: string }

/** One preamble line — the closed vocabulary the bundled workflows write there. */
const runPreambleLine = (repo: InMemRepo, line: string): PreambleOutcome => {
  const quoted = words(line)
  if (line === "exit 0") return { exit: true, output: "" }
  if (line.startsWith("mkdir -p ")) return { exit: false, output: "" }
  if (line.startsWith("rm -f ")) {
    for (const path of quoted) deleteIfPresent(repo, path)
    return { exit: false, output: "" }
  }
  if (line.startsWith("rm -rf -- ")) {
    removeAll(repo, quoted)
    return { exit: false, output: "" }
  }
  const printf = /^printf '%s\\n' '(?:[^']|'\\'')*' (>&2|> '(?:[^']|'\\'')*')$/.exec(line)
  if (printf !== null) {
    const [, text, file] = quoted
    if (printf[1] === ">&2") return { exit: false, output: `${text}\n` }
    repo.writeFile(file!, `${text}\n`)
    return { exit: false, output: "" }
  }
  throw new Error(`testkit: cannot run the preamble line \`${line}\` in memory`)
}

/** Rejoins lines a single-quoted word spans, so a preamble entry carrying a newline stays one line. */
const shellLines = (lines: readonly string[]): string[] => {
  const joined: string[] = []
  let open = false
  for (const line of lines) {
    if (open) joined[joined.length - 1] += `\n${line}`
    else joined.push(line)
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "'" && (open || line[i - 1] !== "\\")) open = !open
    }
  }
  return joined
}

interface ParsedCheck {
  readonly command: string
  readonly report: string
  readonly stamp: string
  readonly sweep: readonly string[]
  readonly sweepOnGreen: readonly string[]
  readonly preamble: readonly string[]
}

const outsideCommand = (lines: readonly string[], mkdir: number) => {
  const before = shellLines(lines.slice(2, mkdir))
  const swept = before.at(-1)?.startsWith("rm -rf -- ") === true
  const green = lines.find((l) => l.startsWith("  rm -rf -- "))
  return {
    sweep: swept ? words(before.at(-1)!) : [],
    sweepOnGreen: green === undefined ? [] : words(green),
    preamble: swept ? before.slice(0, -1) : before,
  }
}

const parseCheck = (script: string): ParsedCheck | undefined => {
  const lines = script.split("\n")
  const mkdir = lines.findIndex((l) => l.startsWith('mkdir -p "$(dirname '))
  const close = lines.findIndex((l, i) => i > mkdir && /^\) > '.*' 2>&1$/.test(l))
  if (mkdir === -1 || lines[mkdir + 1] !== "(" || close === -1) return undefined
  const [report] = words(lines[mkdir]!)
  const [, stamp] = words(lines.find((l) => l.includes("<!-- gtd check %s -->")) ?? "")
  if (report === undefined || stamp === undefined) return undefined
  return {
    command: lines.slice(mkdir + 2, close).join("\n"),
    report,
    stamp,
    ...outsideCommand(lines, mkdir),
  }
}

const runCommand = (
  repo: InMemRepo,
  commands: ReadonlyMap<string, ScriptedCommand>,
  command: string,
): { readonly status: number; readonly output: string } => {
  const scripted = commands.get(command)
  if (scripted === undefined) {
    throw new Error(
      `testkit: cannot run \`${command}\` in memory — script it ("the shell command … exits …")`,
    )
  }
  if (scripted.kind === "exit") return scripted
  if (scripted.kind === "missing") return { status: 127, output: `sh: ${command}: not found\n` }
  repo.writeFile(scripted.file, rewritten(repo, scripted))
  return { status: 0, output: "" }
}

/** What a scripted rewrite leaves in its file. */
export const rewritten = (
  repo: InMemRepo,
  command: Extract<ScriptedCommand, { readonly kind: "rewrite" }>,
): string =>
  command.append === true
    ? `${repo.readFile(command.file) ?? ""}${command.content}`
    : command.content

const recognizeCheck = (
  repo: InMemRepo,
  commands: ReadonlyMap<string, ScriptedCommand>,
  script: string,
): FlowScriptResult | undefined => {
  const parsed = parseCheck(script)
  if (parsed === undefined) return undefined
  const { command, report, stamp, sweep, sweepOnGreen, preamble } = parsed
  if (checkScript(command, { report, stamp, sweep, sweepOnGreen, preamble }) !== script) {
    return undefined
  }
  let printed = ""
  for (const line of preamble) {
    const outcome = runPreambleLine(repo, line)
    printed += outcome.output
    if (outcome.exit) return ok(printed)
  }
  removeAll(repo, sweep)
  const { status, output } = runCommand(repo, commands, command)
  if (status === 0) {
    deleteIfPresent(repo, report)
    removeAll(repo, sweepOnGreen)
    return ok(printed)
  }
  const body =
    output.length > 0
      ? output
      : `the test command failed with exit code ${status} and produced no output.`
  repo.writeFile(report, `${body}\n<!-- gtd check ${stamp} -->\n`)
  return ok(printed)
}

/**
 * Applies a `src/flows/scripts.ts` script to `repo`, or `undefined` when
 * `script` is none of them. `commands` stands in for the real programs a
 * check runs, keyed by the exact command string.
 */
export const applyFlowScript = (
  repo: InMemRepo,
  commands: ReadonlyMap<string, ScriptedCommand>,
  script: string,
): FlowScriptResult | undefined => {
  if (!script.startsWith(`${SHEBANG}\n`)) return undefined
  return (
    recognizeRemove(repo, script) ??
    recognizeMove(repo, script) ??
    recognizeShow(repo, script) ??
    recognizeRevert(repo, script) ??
    recognizeRestore(repo, script) ??
    recognizeCheck(repo, commands, script)
  )
}
