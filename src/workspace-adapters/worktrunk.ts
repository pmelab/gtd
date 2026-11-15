import { execFile } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, isAbsolute, join } from "node:path"
import {
  AdapterError,
  type Project,
  type Worktree,
  type WorktreesAdapter,
} from "../workspace/index.js"

export interface WorktrunkOptions {
  /**
   * Where the projects' main checkouts are: absolute paths or `~/…`, where a
   * `*` segment matches any directory. A project's id is what its `*`
   * segments matched, joined by `/`; with no `*`, the directory's name.
   */
  readonly roots: readonly string[]
}

interface Ran {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

const run = (command: string, args: readonly string[], cwd?: string): Promise<Ran> =>
  new Promise((resolve) => {
    execFile(command, args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = (error as NodeJS.ErrnoException | null)?.code
      resolve({
        status: error === null ? 0 : typeof code === "number" ? code : 127,
        stdout,
        stderr: error !== null && typeof code !== "number" ? error.message : stderr,
      })
    })
  })

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

const subdirectories = (dir: string): readonly string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/** Every directory a root matches, with what its `*` segments matched. */
const expand = (root: string): readonly { path: string; matched: readonly string[] }[] => {
  const [first, ...segments] = root.split("/")
  let found = [{ path: first === "" ? "/" : first!, matched: [] as string[] }]
  for (const segment of segments.filter((s) => s !== "")) {
    found = found.flatMap(({ path, matched }) =>
      segment === "*"
        ? subdirectories(path).map((name) => ({
            path: join(path, name),
            matched: [...matched, name],
          }))
        : [{ path: join(path, segment), matched }],
    )
  }
  return found
}

const resolveRoot = (root: string): string => {
  if (root === "~" || root.startsWith("~/")) return join(homedir(), root.slice(1))
  if (isAbsolute(root)) return root
  throw new Error(`worktrunk: root "${root}" must be an absolute path or start with ~/`)
}

interface ListItem {
  readonly branch?: string | null
  readonly head?: { readonly sha?: string }
  readonly worktree?: { readonly path?: string; readonly main?: boolean }
  readonly default_branch?: { readonly ahead?: number; readonly integration?: unknown }
}

const failure = (op: string, message: string, detail?: unknown): AdapterError =>
  new AdapterError({
    adapter: "worktrees",
    op,
    message,
    ...(detail !== undefined ? { detail } : {}),
  })

/**
 * Whether a branch whose tip is already on the default branch has commits of
 * its own: worktrunk counts a fresh branch as integrated too. The branch's
 * reflog says where it was created; `undefined` when there is none.
 */
const hasOwnCommits = async (path: string, branch: string): Promise<boolean | undefined> => {
  const reflog = await run("git", ["reflog", "show", "--format=%H", `refs/heads/${branch}`], path)
  const created = reflog.stdout.trim().split("\n").at(-1)
  if (reflog.status !== 0 || created === undefined || created === "") return undefined
  const count = await run("git", ["rev-list", "--count", `${created}..refs/heads/${branch}`], path)
  return count.status === 0 ? Number(count.stdout.trim()) > 0 : undefined
}

const integratedOf = async (item: ListItem, path: string): Promise<boolean | undefined> => {
  if (item.worktree?.main === true || typeof item.branch !== "string") return false
  const against = item.default_branch
  if (against === undefined) return undefined
  if (against.integration === undefined) return false
  if ((against.ahead ?? 0) > 0) return true
  return hasOwnCommits(path, item.branch)
}

const worktreesOf = async (project: Project): Promise<readonly Worktree[]> => {
  const listed = await run("wt", ["-C", project.path, "list", "--format=json"])
  if (listed.status !== 0) {
    throw failure("list", `wt list failed in ${project.path}`, listed.stderr.trim())
  }
  let parsed: { schema?: unknown; items?: readonly ListItem[] }
  try {
    parsed = JSON.parse(listed.stdout) as typeof parsed
  } catch {
    throw failure("list", "wt list printed no JSON", listed.stdout)
  }
  if (parsed.schema !== 2 || !Array.isArray(parsed.items)) {
    throw failure("list", `wt list printed schema ${String(parsed.schema)}, not 2`)
  }
  const items = parsed.items.filter((item) => typeof item.worktree?.path === "string")
  return Promise.all(
    items.map(async (item) => ({
      path: item.worktree!.path!,
      branch: typeof item.branch === "string" ? item.branch : undefined,
      head: item.head?.sha ?? "",
      main: item.worktree!.main === true,
      integrated: await integratedOf(item, item.worktree!.path!),
    })),
  )
}

/** The bundled worktrees adapter: worktrunk (`wt`) for the worktrees, `git` for the branch history. */
export const worktrunk = (options: WorktrunkOptions): WorktreesAdapter => {
  const roots = options.roots.map(resolveRoot)
  const projects = async (): Promise<readonly Project[]> => {
    const found = new Map<string, Project>()
    for (const { path, matched } of roots.flatMap(expand)) {
      // A linked worktree's `.git` is a file; only a main checkout is a project.
      if (!isDirectory(join(path, ".git"))) continue
      const id = matched.length > 0 ? matched.join("/") : basename(path)
      const known = found.get(id)
      if (known !== undefined && known.path !== path) {
        throw failure("projects", `two projects have the id "${id}": ${known.path} and ${path}`)
      }
      found.set(id, { id, path })
    }
    return [...found.values()]
  }
  return {
    projects,
    list: async (id) => {
      const project = (await projects()).find((p) => p.id === id)
      if (project === undefined) throw failure("list", `no project "${id}"`)
      return worktreesOf(project)
    },
  }
}
