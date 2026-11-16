import {
  isAdapterFailure,
  type Action,
  type ActionField,
  type ActionsAdapter,
  type ActionValues,
  type TerminalAdapter,
  type Worktree,
  type WorktreesAdapter,
} from "../workspace/index.js"
import type { Drivers } from "./Drivers.js"
import type { OpenedPanes } from "./Panes.js"
import type { StatusName, WorktreeStatus } from "./Status.js"

/** The last action gtd ran in a worktree, while this supervisor runs. */
export interface ActionRun {
  readonly id: string
  readonly label: string
  /** The action's exit code, `null` while it runs. */
  readonly exit: number | null
  /** Why the action did not run, or why its exit is unknown. */
  readonly message?: string
}

export type ActionRefusalReason = "notFound" | "notOffered" | "invalid"

/** A request to run an action that gtd turns down before anything runs. */
export class ActionRefusal extends Error {
  constructor(
    readonly reason: ActionRefusalReason,
    message: string,
  ) {
    super(message)
    this.name = "ActionRefusal"
  }
}

export interface ActionRunsDeps {
  readonly worktrees: WorktreesAdapter
  readonly actions: ActionsAdapter
  readonly terminal: TerminalAdapter
  readonly drivers: Drivers
  readonly panes: Pick<OpenedPanes, "add" | "of">
  /** The worktree's status as of now. */
  readonly status: (worktree: string) => Promise<WorktreeStatus>
}

export interface ActionRuns {
  /** The actions offered in the worktree's status now. */
  readonly offered: (
    project: string,
    worktree: string,
  ) => Promise<{ readonly status: StatusName; readonly actions: readonly Action[] }>
  /** Opens a pane running the action; a start action that exits 0 then starts the driver. */
  readonly run: (
    project: string,
    worktree: string,
    id: string,
    values: unknown,
    env?: Readonly<Record<string, string>>,
    /** Told how the action ended, once its exit is known (`exit: null` when it is not). */
    ended?: (run: ActionRun) => void,
  ) => Promise<void>
  /**
   * Follows the newest action pane an earlier supervisor opened in the
   * worktree, as `run` does; `false` when that pane is gone.
   */
  readonly resume: (
    project: string,
    worktree: string,
    env: Readonly<Record<string, string>>,
    ended: (run: ActionRun) => void,
  ) => Promise<boolean>
  readonly last: (worktree: string) => ActionRun | undefined
  /** Stops waiting for the panes of running actions. */
  readonly stop: () => void
}

// How often a running action's pane is read when the terminal sends no hint.
const POLL_MS = 2_000

const refuse = (reason: ActionRefusalReason, message: string): never => {
  throw new ActionRefusal(reason, message)
}

const isOffered = (action: Action, status: StatusName): boolean =>
  action.status === "any" || action.status === status

const checkFlag = (field: ActionField, value: unknown): true | undefined => {
  if (typeof value !== "boolean" && value !== undefined) {
    refuse("invalid", `${field.name} must be true or false`)
  }
  return value === true ? true : undefined
}

const checkText = (field: ActionField, value: unknown): string | undefined => {
  if (value === undefined || value === "") return undefined
  if (typeof value !== "string") return refuse("invalid", `${field.name} must be a string`)
  const choices = field.choices ?? []
  if (field.type === "select" && !choices.includes(value)) {
    refuse("invalid", `${field.name} must be one of ${choices.join(", ")}`)
  }
  return value
}

const checkField = (field: ActionField, value: unknown): string | true | undefined =>
  field.type === "flag" ? checkFlag(field, value) : checkText(field, value)

/** The values a person gave, checked against the action's fields; empty ones left out. */
const checkValues = (fields: readonly ActionField[], values: unknown): ActionValues => {
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    return refuse("invalid", "values must be an object")
  }
  const given = values as Record<string, unknown>
  const unknown = Object.keys(given).filter((name) => !fields.some((f) => f.name === name))
  if (unknown.length > 0) refuse("invalid", `no field ${unknown.join(", ")}`)
  const checked: Record<string, string | true> = {}
  for (const field of fields) {
    const value = checkField(field, given[field.name])
    if (value !== undefined) checked[field.name] = value
    else if (field.required) refuse("invalid", `${field.name} is required`)
  }
  return checked
}

/** What `GTD_WORKSPACE_STATUS` tells an action. */
const statusVariable = (status: WorktreeStatus, worktree: Worktree): string =>
  JSON.stringify({
    status: status.status,
    ...(status.errorKind === undefined ? {} : { errorKind: status.errorKind }),
    ...(status.message === undefined ? {} : { message: status.message }),
    commit: worktree.head,
  })

const messageOf = (error: unknown): string =>
  isAdapterFailure(error) || error instanceof Error ? error.message : String(error)

export const actionRuns = (deps: ActionRunsDeps): ActionRuns => {
  const runs = new Map<string, ActionRun>()
  const waiting = new Map<string, Set<() => void>>()
  let hints: AsyncIterator<string> | undefined
  let stopped = false

  const listen = (): void => {
    if (hints !== undefined || deps.terminal.watch === undefined) return
    const iterator = deps.terminal.watch()[Symbol.asyncIterator]()
    hints = iterator
    void (async () => {
      for (;;) {
        const hint = await iterator.next()
        if (hint.done === true) break
        for (const wake of waiting.get(hint.value) ?? []) wake()
      }
    })()
      .catch(() => {})
      .finally(() => {
        if (hints === iterator) hints = undefined
      })
  }

  // Resolves on a hint for the pane, after POLL_MS, or when the runs stop.
  const wake = (handle: string): Promise<void> =>
    new Promise((resolve) => {
      const set = waiting.get(handle) ?? new Set()
      waiting.set(handle, set)
      const done = (): void => {
        clearTimeout(timer)
        set.delete(done)
        if (set.size === 0) waiting.delete(handle)
        resolve()
      }
      const timer = setTimeout(done, POLL_MS)
      set.add(done)
    })

  const exitOf = async (handle: string): Promise<number | undefined> => {
    listen()
    while (!stopped) {
      const pane = await deps.terminal.status(handle)
      if (pane === undefined) return undefined
      if (pane.exit !== null) return pane.exit.code
      await wake(handle)
    }
    return undefined
  }

  const worktreeOf = async (project: string, path: string): Promise<Worktree> => {
    const listed = await deps.worktrees.list(project).catch(() => [])
    return (
      listed.find((w) => w.path === path) ?? refuse("notFound", `no worktree ${path} in ${project}`)
    )
  }

  const offered = async (path: string) => {
    const status = await deps.status(path)
    const actions = (await deps.actions.list(path)).filter((a) => isOffered(a, status.status))
    return { status, actions }
  }

  const follow = async (
    project: string,
    path: string,
    action: Pick<Action, "id" | "label" | "status">,
    handle: string,
    env: Readonly<Record<string, string>>,
    ended: (run: ActionRun) => void,
  ): Promise<void> => {
    const set = (fields: Omit<ActionRun, "id" | "label">): void => {
      const run = { id: action.id, label: action.label, ...fields }
      runs.set(path, run)
      ended(run)
    }
    try {
      const code = await exitOf(handle)
      if (code === undefined) {
        if (!stopped) set({ exit: null, message: "the action's pane is gone" })
        return
      }
      if (code === 0 && action.status === "idle") await deps.drivers.start(project, path, env)
      set({ exit: code })
    } catch (error) {
      set({ exit: null, message: messageOf(error) })
    }
  }

  return {
    offered: async (project, path) => {
      await worktreeOf(project, path)
      const { status, actions } = await offered(path)
      return { status: status.status, actions }
    },
    run: async (project, path, id, values, env = {}, ended = () => {}) => {
      const worktree = await worktreeOf(project, path)
      const { status, actions } = await offered(path)
      const action =
        actions.find((a) => a.id === id) ??
        refuse("notOffered", `${id} is not offered while the worktree is ${status.status}`)
      const checked = checkValues(action.fields, values)
      try {
        const argv = await deps.actions.argv(path, id, checked)
        const handle = await deps.terminal.run(project, path, argv, {
          GTD_WORKSPACE_STATUS: statusVariable(status, worktree),
          ...env,
        })
        deps.panes.add(path, {
          handle,
          action: { id, label: action.label, status: action.status },
        })
        runs.set(path, { id, label: action.label, exit: null })
        void follow(project, path, action, handle, env, ended)
      } catch (error) {
        runs.set(path, { id, label: action.label, exit: null, message: messageOf(error) })
        throw error
      }
    },
    resume: async (project, path, env, ended) => {
      const pane = deps.panes.of(path).findLast((p) => p.action !== undefined)
      if (pane?.action === undefined) return false
      if ((await deps.terminal.status(pane.handle).catch(() => undefined)) === undefined)
        return false
      runs.set(path, { id: pane.action.id, label: pane.action.label, exit: null })
      void follow(project, path, pane.action, pane.handle, env, ended)
      return true
    },
    last: (path) => runs.get(path),
    stop: () => {
      stopped = true
      for (const set of waiting.values()) for (const wake of set) wake()
      void hints?.return?.()
    },
  }
}
