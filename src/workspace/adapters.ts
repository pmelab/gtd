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

/**
 * A watch's word that something may have changed. It carries no data: gtd
 * reads the snapshot again to learn what changed.
 */
export interface WatchHint {
  /** The project that may have changed; absent when any project may have. */
  readonly project?: string
}

/** The worktrees adapter: which projects exist, and the worktrees of each. */
export interface WorktreesAdapter {
  readonly projects: () => Promise<readonly Project[]>
  /** Fails with an adapter error for a project id `projects` does not report. */
  readonly list: (project: string) => Promise<readonly Worktree[]>
  /**
   * Hints while it is iterated, until gtd stops iterating. When the stream
   * ends or fails, gtd watches again and reads a full snapshot. Without it,
   * gtd reads the snapshot every `pollEvery`.
   */
  readonly watch?: () => AsyncIterable<WatchHint>
}

/**
 * The root OSC 7501 record of a pane: what the program in it last reported
 * about itself. Child records (with an `id`), `app` and `progress` are left out.
 */
export interface StatusRecord {
  /** `idle`, `working`, `done`, `blocked` or `error`; treat any other value as `idle`. */
  readonly state: string
  /** With `blocked`: `permission`, `question` or `auth`. */
  readonly kind?: string
  readonly title?: string
  readonly msg?: string
}

export interface PaneStatus {
  /** The root OSC 7501 record, while the terminal keeps one. */
  readonly record: StatusRecord | undefined
  /** The pane's own command still runs. */
  readonly alive: boolean
  /** A process other than the pane's own command is in the foreground. */
  readonly busy: boolean
  /**
   * How the pane's command ended, `null` while it runs. A command killed by a
   * signal reports `128 + signal`: 130 for `SIGINT`, 143 for `SIGTERM`.
   */
  readonly exit: { readonly code: number } | null
}

/**
 * The terminal adapter: panes that run one command each. A handle is an
 * opaque string that gtd keeps across its own restarts.
 */
export interface TerminalAdapter {
  /**
   * Opens a new pane in the worktree with `argv` as the pane's own top
   * process, in the person's login-shell environment, with `env` applied
   * after the shell's startup files. The pane stays open after `argv` exits.
   */
  readonly run: (
    project: string,
    worktree: string,
    argv: readonly string[],
    env: Readonly<Record<string, string>>,
  ) => Promise<string>
  /** `undefined` when the pane is gone: closed, or lost with its terminal. */
  readonly status: (handle: string) => Promise<PaneStatus | undefined>
  readonly close: (handle: string) => Promise<void>
  /** A command or URL that shows the pane to a person. */
  readonly attach?: (handle: string) => Promise<string>
  /** Hints, each a pane handle, that a pane's status may have changed. */
  readonly watch?: () => AsyncIterable<string>
}

/** One service of a worktree: a process, such as a dev server, that runs for it. */
export interface Service {
  /** Unique among the worktree's services. */
  readonly name: string
  /** Where the service answers; `undefined` when the adapter reports none. */
  readonly url: string | undefined
  readonly running: boolean
  /** Why the service failed; `undefined` when it did not fail. */
  readonly error: string | undefined
}

/** The services adapter: the services of each worktree. `worktree` is its path. */
export interface ServicesAdapter {
  /** The worktree's services, running or not; none when it has none. */
  readonly list: (project: string, worktree: string) => Promise<readonly Service[]>
  /** Starts the worktree's services. Fails when one of them does not start. */
  readonly up: (project: string, worktree: string) => Promise<void>
  /** Stops the worktree's services, and no other worktree's. */
  readonly down: (project: string, worktree: string) => Promise<void>
}
