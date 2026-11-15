import {
  AdapterError,
  type Project,
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
  /** Ends every open watch stream. */
  readonly endWatch: () => void
  /** How many times the adapter has been watched. */
  readonly watched: () => number
  /** `list(project)` fails with `message`; `undefined` makes it answer again. */
  readonly failList: (project: string, message: string | undefined) => void
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
  const streams = new Set<Stream>()
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
  const worktreeOf = (project: ProjectState, name: string, branch: Branch): Worktree => {
    const main = name === project.defaultBranch
    return {
      path: branch.path,
      branch: name,
      head: branch.head,
      main,
      integrated:
        !main && branch.own.length > 0 && branch.own.every((c) => project.integrated.has(c)),
      dirty: branch.dirty,
    }
  }
  const failure = (op: string, message: string): AdapterError =>
    new AdapterError({ adapter: "worktrees", op, message })
  const addBranch = (id: string, project: ProjectState, branch: string, path?: string): string => {
    const at = path ?? `${project.path}.wt/${branch}`
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
      return [...project.branches].map(([name, branch]) => worktreeOf(project, name, branch))
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
    endWatch: () => {
      for (const stream of streams) end(stream)
    },
    watched: () => subscriptions,
    failList: (id, message) => {
      if (message === undefined) failing.delete(id)
      else failing.set(id, message)
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
      dispose: async () => {},
    }
  },
}
