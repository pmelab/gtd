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
  /**
   * `true` when the tree has changes that are not committed (untracked files
   * count), `undefined` or absent when the adapter cannot tell.
   */
  readonly dirty?: boolean | undefined
}

/**
 * A watch's word that something may have changed. It carries no data: gtd
 * reads the snapshot again to learn what changed.
 */
export interface WatchHint {
  /** The project that may have changed; absent when any project may have. */
  readonly project?: string
}

/** How a main checkout's refresh ended. */
export type RefreshResult =
  | { readonly state: "ok" }
  | { readonly state: "stale"; readonly reason: string }

/** The worktrees adapter: which projects exist, and the worktrees of each. */
export interface WorktreesAdapter {
  readonly projects: () => Promise<readonly Project[]>
  /** Fails with an adapter error for a project id `projects` does not report. */
  readonly list: (project: string) => Promise<readonly Worktree[]>
  /**
   * A new worktree on the new branch `branch`, made from `base` (default: the
   * default branch). Returns the worktree's path. Without it, the dashboard
   * creates no worktree.
   */
  readonly create?: (project: string, branch: string, base?: string) => Promise<string>
  /**
   * Removes the worktree at `worktree` (its path) and deletes its branch, and
   * returns when the removal is complete. Without `force`, it fails on a
   * dirty tree and keeps a branch that is not merged. Without it, the
   * dashboard removes no worktree.
   */
  readonly remove?: (
    project: string,
    worktree: string,
    options: { readonly force: boolean },
  ) => Promise<void>
  /**
   * Brings the project's main checkout up to date with its upstream, so that
   * `integrated` is told against a current default branch. It never resets or
   * rebases: what cannot be brought up to date is `stale`, with the reason.
   * Without it, gtd cleans against the main checkout as it is.
   */
  readonly refresh?: (project: string) => Promise<RefreshResult>
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

/** One input of an action. */
export interface ActionField {
  readonly name: string
  /** `flag` is on or off, `select` takes one of `choices`, `text` takes any string. */
  readonly type: "flag" | "select" | "text"
  readonly required: boolean
  /** With `select`: the values it accepts. */
  readonly choices?: readonly string[]
  readonly help?: string
}

/** The worktree status an action is offered in; `any` offers it in every status. */
export type ActionStatus = "idle" | "needsYou" | "error" | "any"

export interface Action {
  /** Unique among the worktree's actions. */
  readonly id: string
  readonly label: string
  /** An action for `idle` is a start action: when it exits 0, gtd starts the driver. */
  readonly status: ActionStatus
  readonly fields: readonly ActionField[]
}

/**
 * A value for each field that was filled in: `true` for a flag that is on, a
 * string otherwise. A field that is absent was left empty.
 */
export type ActionValues = Readonly<Record<string, string | true>>

/**
 * The actions adapter only describes actions. gtd runs the argv in a pane of
 * its own, never through a shell.
 */
export interface ActionsAdapter {
  readonly list: (worktree: string) => Promise<readonly Action[]>
  /**
   * The action's command line. gtd has checked `values` against the fields;
   * each value must reach the action unchanged.
   */
  readonly argv: (worktree: string, id: string, values: ActionValues) => Promise<readonly string[]>
}

export type NotificationPriority = "high" | "default" | "low"

/** One message to a person's phone. */
export interface Notification {
  /** gtd's own: no key is published twice. An adapter may ignore it. */
  readonly key: string
  readonly title: string
  readonly body: string
  /** Where a tap leads: the gate page or the worktree on the dashboard. */
  readonly url: string | undefined
  readonly priority: NotificationPriority
}

/** The notifications adapter: delivers what gtd publishes. */
export interface NotificationsAdapter {
  /** Resolves once delivered; fails with an adapter error. */
  readonly publish: (notification: Notification) => Promise<void>
}
