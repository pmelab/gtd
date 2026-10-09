import { globMatches } from "../../src/replay/Glob.js"

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
