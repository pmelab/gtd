import { execFile } from "node:child_process"
import { existsSync, readdirSync, statSync, watch, type FSWatcher } from "node:fs"
import { homedir } from "node:os"
import { basename, isAbsolute, join } from "node:path"
import {
  AdapterError,
  type Project,
  type RefreshResult,
  type WatchHint,
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

const run = (
  command: string,
  args: readonly string[],
  cwd?: string,
  env?: NodeJS.ProcessEnv,
): Promise<Ran> =>
  new Promise((resolve) => {
    execFile(command, args, { cwd, env, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = (error as NodeJS.ErrnoException | null)?.code
      resolve({
        status: error === null ? 0 : typeof code === "number" ? code : 127,
        stdout,
        stderr: error !== null && typeof code !== "number" ? error.message : stderr,
      })
    })
  })

// Reads must not rewrite a stale index under `index.lock`: that could fail a landing.
const readEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_OPTIONAL_LOCKS: "0",
})
const read = (command: string, args: readonly string[], cwd?: string): Promise<Ran> =>
  run(command, args, cwd, readEnv())

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
  readonly worktree?: {
    readonly path?: string
    readonly main?: boolean
    readonly changes?: Readonly<Record<string, unknown>>
  }
  readonly default_branch?: {
    readonly ahead?: number
    readonly integration?: unknown
  }
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
  const reflog = await read("git", ["reflog", "show", "--format=%H", `refs/heads/${branch}`], path)
  const created = reflog.stdout.trim().split("\n").at(-1)
  if (reflog.status !== 0 || created === undefined || created === "") return undefined
  const count = await read("git", ["rev-list", "--count", `${created}..refs/heads/${branch}`], path)
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

// The kinds of change `wt list` reports; `diff` is a count, not a kind.
const CHANGES = ["staged", "modified", "untracked", "renamed", "deleted", "conflicted"]

const dirtyOf = (item: ListItem): boolean | undefined => {
  const changes = item.worktree?.changes
  return changes === undefined ? undefined : CHANGES.some((kind) => changes[kind] === true)
}

// One read of the repository's config gives every branch's description.
const descriptionsOf = async (path: string): Promise<ReadonlyMap<string, string>> => {
  const got = await read(
    "git",
    ["config", "-z", "--get-regexp", "^branch\\..*\\.description$"],
    path,
  )
  const found = new Map<string, string>()
  if (got.status !== 0) return found
  // `-z`: entries end in NUL, each as `key\nvalue`, so a value may span lines.
  for (const entry of got.stdout.split("\0")) {
    const match = /^branch\.(.+)\.description\n(.*)$/s.exec(entry)
    const text = match?.[2]?.replace(/\n+$/, "")
    if (match !== null && text !== undefined && text !== "") found.set(match[1]!, text)
  }
  return found
}

const worktreesOf = async (project: Project): Promise<readonly Worktree[]> => {
  const listed = await read("wt", ["-C", project.path, "list", "--format=json"])
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
  const descriptions = await descriptionsOf(project.path)
  return Promise.all(
    items.map(async (item) => {
      const description =
        typeof item.branch === "string" ? descriptions.get(item.branch) : undefined
      return {
        path: item.worktree!.path!,
        branch: typeof item.branch === "string" ? item.branch : undefined,
        head: item.head?.sha ?? "",
        main: item.worktree!.main === true,
        integrated: await integratedOf(item, item.worktree!.path!),
        dirty: dirtyOf(item),
        ...(description !== undefined ? { description } : {}),
      }
    }),
  )
}

const allDirectories = (dir: string): readonly string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name))
  } catch {
    return []
  }
}

/** `refs/` and every directory below it but `refs/remotes`: a fetch is no change to a worktree. */
const refDirectories = (refs: string): readonly string[] => {
  const walk = (dir: string): readonly string[] => [dir, ...allDirectories(dir).flatMap(walk)]
  return [
    refs,
    ...allDirectories(refs)
      .filter((dir) => basename(dir) !== "remotes")
      .flatMap(walk),
  ]
}

// The entries of a git dir whose change can move a worktree's HEAD or branch, or edit a branch description.
const COMMON_ENTRIES = /^(HEAD|packed-refs|refs|worktrees|reftable|config)/
const WORKTREE_ENTRIES = /^(HEAD|refs)/

/**
 * Hints from each project's git directories: the common dir, its `refs/`
 * directories but `refs/remotes`, `worktrees/` and each `worktrees/<n>/`. One
 * watch per directory, not a recursive one: Node's recursive watch on Linux
 * drops the tail of a burst. Nothing is installed into the checkouts.
 */
const watchGitDirs = (projects: readonly Project[]): AsyncIterator<WatchHint> => {
  const hints: WatchHint[] = []
  const watchers = new Map<string, FSWatcher>()
  let wake = (): void => {}
  let ended = false

  const hint = (project: string): void => {
    if (ended || hints.some((h) => h.project === project)) return
    hints.push({ project })
    wake()
  }
  const watchDir = (dir: string, onChange: (file: string | null) => void): void => {
    if (watchers.has(dir)) return
    try {
      const watcher = watch(dir, (_event, file) => onChange(file))
      watcher.on("error", () => {
        watcher.close()
        watchers.delete(dir)
      })
      watchers.set(dir, watcher)
    } catch {
      // A directory that is gone has nothing to watch.
    }
  }
  const arm = (project: Project): void => {
    const common = join(project.path, ".git")
    for (const [dir, watcher] of watchers) {
      if (dir.startsWith(common) && !existsSync(dir)) {
        watcher.close()
        watchers.delete(dir)
      }
    }
    // A new directory (a ref namespace, a worktree) is watched as soon as it appears.
    const changed = (): void => {
      arm(project)
      hint(project.id)
    }
    watchDir(common, (file) => {
      if (file === null || COMMON_ENTRIES.test(file)) changed()
    })
    for (const dir of refDirectories(join(common, "refs"))) watchDir(dir, changed)
    const worktrees = join(common, "worktrees")
    watchDir(worktrees, changed)
    for (const dir of allDirectories(worktrees)) {
      watchDir(dir, (file) => {
        if (file === null || WORKTREE_ENTRIES.test(file)) hint(project.id)
      })
    }
  }
  for (const project of projects) arm(project)

  return {
    next: async () => {
      while (hints.length === 0 && !ended) await new Promise<void>((resolve) => (wake = resolve))
      const value = hints.shift()
      return value === undefined ? { done: true, value: undefined } : { done: false, value }
    },
    return: async () => {
      ended = true
      for (const watcher of watchers.values()) watcher.close()
      watchers.clear()
      hints.length = 0
      wake()
      return { done: true, value: undefined }
    },
  }
}

// Fetch, then fast-forward only: a main checkout that has moved apart stays as it is.
const refreshMain = async (path: string): Promise<RefreshResult> => {
  const upstream = await read("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], path)
  if (upstream.status !== 0) return { state: "ok" }
  const fetched = await run("git", ["fetch", "--quiet"], path)
  if (fetched.status !== 0) {
    return {
      state: "stale",
      reason: `git fetch failed: ${fetched.stderr.trim()}`,
    }
  }
  const merged = await run("git", ["merge", "--ff-only", "--quiet", "@{upstream}"], path)
  if (merged.status !== 0) {
    const ref = upstream.stdout.trim()
    return {
      state: "stale",
      reason: `does not fast-forward to ${ref}: ${merged.stderr.trim()}`,
    }
  }
  return { state: "ok" }
}

// Sets the branch description; the returned function puts the previous value back.
const setDescription = async (
  cwd: string,
  key: string,
  description: string | undefined,
): Promise<() => Promise<void>> => {
  if (description === undefined) return async () => {}
  const old = (await read("git", ["config", "--get", key], cwd)).stdout
  const set = await run("git", ["config", key, description], cwd)
  if (set.status !== 0) throw failure("create", `git config ${key} failed`, set.stderr.trim())
  return async () => {
    await run(
      "git",
      old === "" ? ["config", "--unset", key] : ["config", key, old.replace(/\n$/, "")],
      cwd,
    )
  }
}

/** The bundled worktrees adapter: worktrunk (`wt`) for the worktrees, `git` for the branch history. */
export const worktrunk = (options: WorktrunkOptions): WorktreesAdapter => {
  const roots = options.roots.map(resolveRoot)
  const projectsNow = (): readonly Project[] => {
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
  const projects = async (): Promise<readonly Project[]> => projectsNow()
  const projectOf = async (id: string, op: string): Promise<Project> =>
    (await projects()).find((p) => p.id === id) ?? Promise.reject(failure(op, `no project "${id}"`))
  return {
    projects,
    // The projects of the moment it starts; a new one is found by the next full read.
    watch: () => ({
      [Symbol.asyncIterator]: () => watchGitDirs(projectsNow()),
    }),
    list: async (id) => worktreesOf(await projectOf(id, "list")),
    refresh: async (id) => refreshMain((await projectOf(id, "refresh")).path),
    // The person's worktrunk config decides where the worktree goes, and its hooks run.
    create: async (id, branch, base, options) => {
      const project = await projectOf(id, "create")
      const key = `branch.${branch}.description`
      const restore = await setDescription(project.path, key, options?.description)
      const args = ["-C", project.path, "switch", "--create", branch, "--yes", "--no-cd"]
      const created = await run("wt", [
        ...args,
        ...(base === undefined ? [] : ["--base", base]),
        "--format=json",
      ])
      if (created.status !== 0) {
        await restore()
        throw failure("create", `wt switch --create ${branch} failed`, created.stderr.trim())
      }
      try {
        return (JSON.parse(created.stdout) as { path: string }).path
      } catch {
        throw failure("create", "wt switch printed no JSON", created.stdout)
      }
    },
    switch: async (id, branch, options) => {
      const project = await projectOf(id, "switch")
      const key = `branch.${branch}.description`
      if (options?.description !== undefined) {
        const has = await read("git", ["config", "--get", key], project.path)
        if (has.stdout.trim() === "") {
          await run("git", ["config", key, options.description], project.path)
        }
      }
      const switched = await run("wt", [
        "-C",
        project.path,
        "switch",
        branch,
        "--yes",
        "--no-cd",
        "--format=json",
      ])
      if (switched.status !== 0) {
        throw failure("switch", `wt switch ${branch} failed`, switched.stderr.trim())
      }
      try {
        return (JSON.parse(switched.stdout) as { path: string }).path
      } catch {
        throw failure("switch", "wt switch printed no JSON", switched.stdout)
      }
    },
    unpushed: async (id, branch) => {
      const project = await projectOf(id, "unpushed")
      const ref = `refs/heads/${branch}`
      const exists = await read("git", ["rev-parse", "--verify", "--quiet", ref], project.path)
      if (exists.status !== 0) return undefined
      // The main checkout's HEAD is the default branch: its commits are not the branch's own.
      const count = await read(
        "git",
        ["rev-list", "--count", ref, "--not", "HEAD", "--remotes"],
        project.path,
      )
      if (count.status !== 0) throw failure("unpushed", `git rev-list failed for ${branch}`)
      return Number(count.stdout.trim()) > 0
    },
    remove: async (id, path, { force }) => {
      const project = await projectOf(id, "remove")
      const removed = await run("wt", [
        "-C",
        project.path,
        "remove",
        "--yes",
        "--foreground",
        ...(force ? ["--force", "--force-delete"] : []),
        path,
      ])
      if (removed.status !== 0) {
        throw failure("remove", `wt remove ${path} failed`, removed.stderr.trim())
      }
    },
  }
}
