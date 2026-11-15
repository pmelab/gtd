/**
 * Every adapter operation fails with this shape. A userland adapter may throw
 * the class, or any object with these fields.
 */
export interface AdapterFailure {
  /** The adapter's slot: `worktrees`, `terminal`, `services`, `actions` or `notifications`. */
  readonly adapter: string
  /** The operation that failed, as the interface names it: `list`, `create`, … */
  readonly op: string
  readonly message: string
  /** Anything that helps: a tool's stderr, an exit code. */
  readonly detail?: unknown
}

export class AdapterError extends Error implements AdapterFailure {
  readonly adapter: string
  readonly op: string
  readonly detail?: unknown

  constructor(failure: AdapterFailure) {
    super(failure.message)
    this.name = "AdapterError"
    this.adapter = failure.adapter
    this.op = failure.op
    if (failure.detail !== undefined) this.detail = failure.detail
  }
}

export const isAdapterFailure = (value: unknown): value is AdapterFailure =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as AdapterFailure).adapter === "string" &&
  typeof (value as AdapterFailure).op === "string" &&
  typeof (value as AdapterFailure).message === "string"

/** One repository of the workspace. */
export interface Project {
  /** Unique in the workspace; `projects` settings are keyed by it. */
  readonly id: string
  /** The main checkout. */
  readonly path: string
}

export interface Worktree {
  readonly path: string
  /** `undefined` for a detached HEAD. */
  readonly branch: string | undefined
  /** The full HEAD commit. */
  readonly head: string
  /** The project's main checkout. */
  readonly main: boolean
  /**
   * `true` when the branch has commits of its own and all of them are on the
   * default branch (squash merges count), `undefined` when the adapter cannot
   * tell.
   */
  readonly integrated: boolean | undefined
}

/** The worktrees adapter: which projects exist, and the worktrees of each. */
export interface WorktreesAdapter {
  readonly projects: () => Promise<readonly Project[]>
  /** Fails with an adapter error for a project id `projects` does not report. */
  readonly list: (project: string) => Promise<readonly Worktree[]>
}
