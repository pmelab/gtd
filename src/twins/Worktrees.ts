import {
  AdapterError,
  type Project,
  type RefreshResult,
  type WatchHint,
  type Worktree,
  type WorktreesAdapter,
} from "../workspace/index.js"
import type { WorktreesHarness } from "../workspace-testkit/index.js"

interface Branch {
  readonly path: string
  head: string
  /** Commits made on this branch since it was created. */
  readonly own: string[]
  dirty: boolean
  /** The branch exists, its worktree is gone. */
  bare?: boolean
}

interface ProjectState {
  readonly path: string
  readonly defaultBranch: string
  readonly branches: Map<string, Branch>
  /** Commits whose change the default branch carries: merged in, or squashed in. */
  readonly integrated: Set<string>
}

export interface InMemoryWorktrees {
  readonly adapter: WorktreesAdapter
  /** A project with its main checkout at `path`, on `defaultBranch`, with one commit. */
  readonly addProject: (id: string, path: string, defaultBranch?: string) => void
  /** A linked worktree on a new branch from the default branch's tip; `path` defaults to `<project>.wt/<branch>`. */
  readonly addWorktree: (project: string, branch: string, path?: string) => string
  readonly commit: (project: string, branch: string) => void
  readonly merge: (project: string, branch: string) => void
  /** The worktree's tree has changes that are not committed, or no longer has them. */
  readonly dirty: (project: string, branch: string, dirty: boolean) => void
  /** A hint on every open watch stream. Each change above gives one, as a real tool's watch would. */
  readonly hint: (project?: string) => void
  /** The worktree on `branch` is on `to` from now on, as a start action may leave it. */
  readonly rename: (project: string, branch: string, to: string) => void
  /** The worktree of `branch` is gone, the branch stays. */
  readonly leave: (project: string, branch: string) => void
  /** The commits made on `branch` are on a remote. */
  readonly push: (project: string, branch: string) => void
  /** Ends every open watch stream. */
  readonly endWatch: () => void
  /** How many times the adapter has been watched. */
  readonly watched: () => number
  /** `list(project)` fails with `message`; `undefined` makes it answer again. */
  readonly failList: (project: string, message: string | undefined) => void
  /** The branch's `integrated` is `value` from now on, whatever its commits say. */
  readonly reportIntegrated: (project: string, branch: string, value: boolean | undefined) => void
  /** `refresh(project)` reports the main checkout stale with `reason`; `undefined` makes it current again. */
  readonly stale: (project: string, reason: string | undefined) => void
}

interface Stream {
  readonly hints: WatchHint[]
  ended: boolean
  wake: () => void
}

/** The worktrees adapter's in-memory twin: projects and branches as a small commit model. */
export const inMemoryWorktrees = (): InMemoryWorktrees => {
  const projects = new Map<string, ProjectState>()
  const failing = new Map<string, string>()
  const stale = new Map<string, string>()
  // By `<project>/<branch>`.
  const integration = new Map<string, boolean | undefined>()
  const streams = new Set<Stream>()
  const pushed = new Set<string>()
  let subscriptions = 0
  let commits = 0
  const nextCommit = (): string => (++commits).toString(16).padStart(40, "0")

  const hint = (project?: string): void => {
    for (const stream of streams) {
      stream.hints.push(project === undefined ? {} : { project })
      stream.wake()
    }
  }
  const end = (stream: Stream): void => {
    stream.ended = true
    streams.delete(stream)
    stream.wake()
  }

  const watch = (): AsyncIterable<WatchHint> => ({
    [Symbol.asyncIterator]: () => {
      subscriptions++
      const stream: Stream = { hints: [], ended: false, wake: () => {} }
      streams.add(stream)
      return {
        next: async (): Promise<IteratorResult<WatchHint>> => {
          while (stream.hints.length === 0 && !stream.ended) {
            await new Promise<void>((resolve) => (stream.wake = resolve))
          }
          const value = stream.hints.shift()
          return value === undefined ? { done: true, value: undefined } : { done: false, value }
        },
        return: async (): Promise<IteratorResult<WatchHint>> => {
          end(stream)
          return { done: true, value: undefined }
        },
      }
    },
  })

  const projectOf = (id: string, op: string): ProjectState => {
    const project = projects.get(id)
    if (project === undefined) {
      throw new AdapterError({
        adapter: "worktrees",
        op,
        message: `no project "${id}"`,
      })
    }
    return project
  }
  const branchOf = (project: ProjectState, branch: string): Branch => {
    const found = project.branches.get(branch)
    if (found === undefined) throw new Error(`no branch "${branch}"`)
    return found
  }
  const worktreeOf = (
    id: string,
    project: ProjectState,
    name: string,
    branch: Branch,
  ): Worktree => {
    const main = name === project.defaultBranch
    const ref = `${id}/${name}`
    return {
      path: branch.path,
      branch: name,
      head: branch.head,
      main,
      integrated: integration.has(ref)
        ? integration.get(ref)
        : !main && branch.own.length > 0 && branch.own.every((c) => project.integrated.has(c)),
      dirty: branch.dirty,
    }
  }
  const failure = (op: string, message: string): AdapterError =>
    new AdapterError({ adapter: "worktrees", op, message })
  const addBranch = (id: string, project: ProjectState, branch: string, path?: string): string => {
    // A worktree that moved to another branch keeps its path: the default one may be taken.
    const taken = new Set([...project.branches.values()].map((b) => b.path))
    let at = path ?? `${project.path}.wt/${branch}`
    for (let n = 2; path === undefined && taken.has(at); n++)
      at = `${project.path}.wt/${branch}-${n}`
    const base = branchOf(project, project.defaultBranch)
    project.branches.set(branch, { path: at, head: base.head, own: [], dirty: false })
    hint(id)
    return at
  }

  const adapter: WorktreesAdapter = {
    projects: async () =>
      [...projects].map(
        ([id, project]): Project => ({
          id,
          path: project.path,
        }),
      ),
    list: async (id) => {
      const project = projectOf(id, "list")
      const message = failing.get(id)
      if (message !== undefined)
        throw new AdapterError({ adapter: "worktrees", op: "list", message })
      return [...project.branches]
        .filter(([, branch]) => branch.bare !== true)
        .map(([name, branch]) => worktreeOf(id, project, name, branch))
    },
    switch: async (id, branch) => {
      const project = projectOf(id, "switch")
      const found = project.branches.get(branch)
      if (found === undefined) throw failure("switch", `no branch named ${branch}`)
      if (found.bare !== true) throw failure("switch", `${branch} has a worktree`)
      delete found.bare
      hint(id)
      return found.path
    },
    unpushed: async (id, branch) => {
      const found = projectOf(id, "unpushed").branches.get(branch)
      return found === undefined ? undefined : found.own.some((c) => !pushed.has(c))
    },
    create: async (id, branch) => {
      const project = projectOf(id, "create")
      if (project.branches.has(branch)) throw failure("create", `a branch named ${branch} exists`)
      return addBranch(id, project, branch)
    },
    remove: async (id, path, { force }) => {
      const project = projectOf(id, "remove")
      const found = [...project.branches].find(([, branch]) => branch.path === path)
      if (found === undefined) throw failure("remove", `no worktree at ${path}`)
      const [name, branch] = found
      if (name === project.defaultBranch) throw failure("remove", "the main checkout stays")
      if (branch.dirty && !force) throw failure("remove", `${path} has uncommitted changes`)
      const merged = branch.own.every((c) => project.integrated.has(c))
      if (!merged && !force) throw failure("remove", `${name} is not merged`)
      project.branches.delete(name)
      hint(id)
    },
    refresh: async (id): Promise<RefreshResult> => {
      projectOf(id, "refresh")
      const reason = stale.get(id)
      return reason === undefined ? { state: "ok" } : { state: "stale", reason }
    },
    watch,
  }

  return {
    adapter,
    addProject: (id, path, defaultBranch = "main") => {
      const head = nextCommit()
      projects.set(id, {
        path,
        defaultBranch,
        branches: new Map([[defaultBranch, { path, head, own: [], dirty: false }]]),
        integrated: new Set([head]),
      })
      hint()
    },
    addWorktree: (id, branch, path) => addBranch(id, projectOf(id, "create"), branch, path),
    commit: (id, name) => {
      const branch = branchOf(projectOf(id, "commit"), name)
      branch.head = nextCommit()
      branch.own.push(branch.head)
      hint(id)
    },
    // A squash commit and a merge commit both carry the branch's change; the
    // model needs no ancestry to tell `integrated`.
    merge: (id, name) => {
      const project = projectOf(id, "merge")
      for (const commit of branchOf(project, name).own) project.integrated.add(commit)
      const base = branchOf(project, project.defaultBranch)
      base.head = nextCommit()
      project.integrated.add(base.head)
      hint(id)
    },
    dirty: (id, name, dirty) => {
      branchOf(projectOf(id, "dirty"), name).dirty = dirty
    },
    hint,
    rename: (id, name, to) => {
      const project = projectOf(id, "rename")
      const branch = branchOf(project, name)
      project.branches.delete(name)
      project.branches.set(to, branch)
      hint(id)
    },
    leave: (id, name) => {
      branchOf(projectOf(id, "leave"), name).bare = true
      hint(id)
    },
    push: (id, name) => {
      for (const commit of branchOf(projectOf(id, "push"), name).own) pushed.add(commit)
    },
    endWatch: () => {
      for (const stream of streams) end(stream)
    },
    watched: () => subscriptions,
    failList: (id, message) => {
      if (message === undefined) failing.delete(id)
      else failing.set(id, message)
    },
    reportIntegrated: (id, branch, value) => {
      integration.set(`${id}/${branch}`, value)
      hint(id)
    },
    stale: (id, reason) => {
      if (reason === undefined) stale.delete(id)
      else stale.set(id, reason)
    },
  }
}

/** The contract kit's harness for the twin. */
export const inMemoryWorktreesHarness: WorktreesHarness = {
  setup: async () => {
    const twin = inMemoryWorktrees()
    twin.addProject("demo", "/workspace/demo")
    return {
      adapter: twin.adapter,
      project: "demo",
      defaultBranch: "main",
      addWorktree: async (branch) => void twin.addWorktree("demo", branch),
      commit: async (branch) => twin.commit("demo", branch),
      merge: async (branch) => twin.merge("demo", branch),
      makeDirty: async (branch) => twin.dirty("demo", branch, true),
      push: async (branch) => twin.push("demo", branch),
      leave: async (branch) => twin.leave("demo", branch),
      dispose: async () => {},
    }
  },
}
