import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { TerminalAdapter, WorkspaceSettings } from "../workspace/index.js"
import type { DriverState } from "./Status.js"

/**
 * The pane handle of each worktree's driver, by worktree path, in the state
 * directory: a pane outlives the supervisor, so the next one must find it.
 */
export interface DriverPanes {
  readonly get: (worktree: string) => string | undefined
  readonly set: (worktree: string, handle: string) => void
  readonly delete: (worktree: string) => void
}

export const driverPanes = (stateDirectory: string): DriverPanes => {
  const file = join(stateDirectory, "drivers.json")
  const read = (): Record<string, string> => {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as Record<string, string>
    } catch {
      return {}
    }
  }
  const write = (handles: Record<string, string>): void => {
    mkdirSync(stateDirectory, { recursive: true, mode: 0o700 })
    writeFileSync(file, `${JSON.stringify(handles, null, 2)}\n`, { mode: 0o600 })
  }
  return {
    get: (worktree) => read()[worktree],
    set: (worktree, handle) => write({ ...read(), [worktree]: handle }),
    delete: (worktree) => {
      const { [worktree]: _gone, ...rest } = read()
      write(rest)
    },
  }
}

export interface Drivers {
  readonly state: (worktree: string) => Promise<DriverState>
  /** Opens a pane running the project's driver command; `false` when none is configured. */
  readonly start: (
    project: string,
    worktree: string,
    env?: Readonly<Record<string, string>>,
  ) => Promise<boolean>
  /** The handle of the worktree's driver pane, while gtd keeps one. */
  readonly pane: (worktree: string) => string | undefined
  /** Lets go of the worktree's driver pane, once the worktree is gone. */
  readonly forget: (worktree: string) => void
  /** The terminal's hints, each a pane handle whose status may have changed. */
  readonly watch?: () => AsyncIterable<string>
}

export const drivers = (
  terminal: TerminalAdapter,
  settings: () => WorkspaceSettings,
  panes: DriverPanes,
): Drivers => ({
  state: async (worktree) => {
    const handle = panes.get(worktree)
    if (handle === undefined) return { kind: "none" }
    try {
      const pane = await terminal.status(handle)
      return pane === undefined ? { kind: "none" } : { kind: "pane", pane }
    } catch {
      return { kind: "unknown" }
    }
  },
  start: async (project, worktree, env = {}) => {
    const { projects, driver } = settings()
    const argv = projects?.[project]?.driver ?? driver
    if (argv === undefined) return false
    panes.set(worktree, await terminal.run(project, worktree, argv, env))
    return true
  },
  pane: panes.get,
  forget: panes.delete,
  ...(terminal.watch !== undefined ? { watch: terminal.watch.bind(terminal) } : {}),
})
