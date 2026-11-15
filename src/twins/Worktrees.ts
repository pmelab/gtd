import {
  AdapterError,
  type Project,
  type Worktree,
  type WorktreesAdapter,
} from "../workspace/index.js"
import type { WorktreesHarness } from "../workspace-testkit/index.js"

interface Branch {
  readonly path: string
  head: string
  /** Commits made on this branch since it was created. */
  readonly own: string[]
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
}

/** The worktrees adapter's in-memory twin: projects and branches as a small commit model. */
export const inMemoryWorktrees = (): InMemoryWorktrees => {
  const projects = new Map<string, ProjectState>()
  let commits = 0
  const nextCommit = (): string => (++commits).toString(16).padStart(40, "0")

  const projectOf = (id: string, op: string): ProjectState => {
    const project = projects.get(id)
    if (project === undefined) {
      throw new AdapterError({ adapter: "worktrees", op, message: `no project "${id}"` })
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
    }
  }

  const adapter: WorktreesAdapter = {
    projects: async () =>
      [...projects].map(([id, project]): Project => ({ id, path: project.path })),
    list: async (id) => {
      const project = projectOf(id, "list")
      return [...project.branches].map(([name, branch]) => worktreeOf(project, name, branch))
    },
  }

  return {
    adapter,
    addProject: (id, path, defaultBranch = "main") => {
      const head = nextCommit()
      projects.set(id, {
        path,
        defaultBranch,
        branches: new Map([[defaultBranch, { path, head, own: [] }]]),
        integrated: new Set([head]),
      })
    },
    addWorktree: (id, branch, path) => {
      const project = projectOf(id, "create")
      const at = path ?? `${project.path}.wt/${branch}`
      const base = branchOf(project, project.defaultBranch)
      project.branches.set(branch, { path: at, head: base.head, own: [] })
      return at
    },
    commit: (id, name) => {
      const branch = branchOf(projectOf(id, "commit"), name)
      branch.head = nextCommit()
      branch.own.push(branch.head)
    },
    // A squash commit and a merge commit both carry the branch's change; the
    // model needs no ancestry to tell `integrated`.
    merge: (id, name) => {
      const project = projectOf(id, "merge")
      for (const commit of branchOf(project, name).own) project.integrated.add(commit)
      const base = branchOf(project, project.defaultBranch)
      base.head = nextCommit()
      project.integrated.add(base.head)
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
      dispose: async () => {},
    }
  },
}
