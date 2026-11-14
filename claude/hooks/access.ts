import { globMatches } from "../../src/wire/Glob.js"

export type AccessDef = { read: string[] | null; write: string[] | null }

const READ = new Set(["Read"])
const WRITE: Record<string, string> = {
  Edit: "file_path",
  MultiEdit: "file_path",
  Write: "file_path",
  NotebookEdit: "notebook_path",
}

// Hand-rolled because a hooks module may not import `node:path`.
const segments = (p: string): string[] =>
  p.split("/").reduce<string[]>((out, s) => {
    if (s === "..") out.pop()
    else if (s && s !== ".") out.push(s)
    return out
  }, [])

// Repo-relative form of a path; undefined when it lies outside the repo.
const inRepo = (p: string, root: string): string | undefined => {
  const base = segments(root)
  const target = segments(p.startsWith("/") ? p : `${root}/${p}`)
  return base.every((s, i) => target[i] === s) ? target.slice(base.length).join("/") : undefined
}

const deny = (verb: string, path: string, globs: string[]) =>
  `gtd access: ${verb} of ${path} is outside this step's ${verb} access (${globs.join(", ") || "none"})`

// Bash is deliberately not inspected: access is best effort at the tool level,
// and `gtd land` is the backstop for writes.
export function accessDenial(
  tool: string,
  input: Record<string, unknown>,
  access: AccessDef,
  root: string,
): string | undefined {
  if (READ.has(tool)) return check("read", input.file_path, access.read, root)
  const key = WRITE[tool]
  if (key) return check("write", input[key], access.write, root)
  if (tool === "Glob" || tool === "Grep") return searchDenial(input.path, access.read, root)
  return undefined
}

function check(verb: string, raw: unknown, globs: string[] | null, root: string) {
  if (globs === null || typeof raw !== "string") return undefined
  const rel = inRepo(raw, root)
  if (rel === undefined || globs.some((g) => globMatches(rel, g))) return undefined
  return deny(verb, rel, globs)
}

// A search is allowed only from a root that sits inside the literal directory
// prefix of some read glob, so it cannot enumerate files outside the access.
function searchDenial(raw: unknown, globs: string[] | null, root: string) {
  if (globs === null) return undefined
  const rel = typeof raw === "string" && raw ? inRepo(raw, root) : ""
  if (rel === undefined) return undefined
  const inside = globs.some((g) => {
    const prefix = g.split("*")[0]!
    const dir = prefix.slice(0, prefix.lastIndexOf("/") + 1).replace(/\/$/, "")
    return dir === "" || rel === dir || rel.startsWith(`${dir}/`)
  })
  return inside ? undefined : deny("read", rel || ".", globs)
}

// What the main session may write while gtd drives: nothing while a step runs
// (gtd commits the tree when it ends), only the steering file at a person's
// gate that has one (ADR 0010: the file is the channel), anything otherwise.
export type MainPhase = { isRunning: boolean; file?: string | undefined }

export const RUNNING_DENIAL =
  "gtd is running a step and commits the working tree when it ends: don't edit files now. Answer read-only, or record the request with mcp__gtd__note for the next step that waits on the person. /gtd stop stops the run."

export function mainDenial(
  tool: string,
  input: Record<string, unknown>,
  phase: MainPhase,
  root: string,
): string | undefined {
  const key = WRITE[tool]
  if (!key) return undefined
  if (phase.isRunning) return RUNNING_DENIAL
  if (!phase.file) return undefined
  const raw = input[key]
  const rel = typeof raw === "string" ? inRepo(raw, root) : undefined
  return rel === phase.file
    ? undefined
    : `At this step only ${phase.file} may change: record the request there, as the step's instructions say.`
}

// A shell command that plainly writes: a redirect to a file, an in-place edit,
// a file-moving tool or a git command that changes the tree. Best effort: `gtd
// land` refuses whatever slips through.
const WRITING_SHELL =
  /(^|[^0-9&])>{1,2}\s*(?!\/dev\/null|&)[^\s]|\b(tee|touch|mv|cp|rm|mkdir|rmdir|ln|truncate|patch)\b|\bsed\s+(-[a-zA-Z]*i|--in-place)|\bperl\s+-[a-zA-Z]*i|\bgit\s+(add|commit|apply|checkout|restore|reset|stash|rm|mv|merge|rebase|cherry-pick)\b/

/** What a steering step's agent may not do: ask in chat, or write through the shell. */
export function steeringDenial(
  tool: string,
  input: Record<string, unknown>,
  file: string,
): string | undefined {
  if (tool === "AskUserQuestion")
    return `This step talks to the person only through ${file}: put the question there as a widget, and end your turn.`
  if (tool === "Bash" && typeof input.command === "string" && WRITING_SHELL.test(input.command))
    return `This step writes only ${file}, and only with Write or Edit: run read-only commands.`
  return undefined
}
