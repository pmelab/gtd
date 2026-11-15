import { basename } from "node:path"
import type { TerminalAdapter, Worktree, WorktreesAdapter } from "../workspace/index.js"
import { ActionRefusal } from "./Actions.js"
import type { AuditLog } from "./Audit.js"
import type { DriverPanes } from "./Drivers.js"

/** What the Terminal tab shows: how to reach a pane, when the terminal adapter can say. */
export interface TerminalView {
  /** A command or URL from the terminal adapter's `attach`. */
  readonly attach?: string
}

export interface TerminalTabDeps {
  readonly worktrees: WorktreesAdapter
  readonly terminal: TerminalAdapter
  readonly panes: DriverPanes
  /** The person's login shell, the command of a shell pane. */
  readonly shell: string
  readonly audit: AuditLog
  readonly now: () => number
}

/** Who asked, for the audit log. */
export interface Origin {
  readonly identity?: string
  readonly endpoint: string
}

export interface TerminalTab {
  /** The driver's pane. */
  readonly driver: (project: string, worktree: string) => Promise<TerminalView>
  /** Opens a new pane running the login shell, beside the driver's. */
  readonly openShell: (project: string, worktree: string, origin: Origin) => Promise<TerminalView>
}

export const terminalTab = (deps: TerminalTabDeps): TerminalTab => {
  const check = async (project: string, path: string): Promise<Worktree> => {
    const listed = await deps.worktrees.list(project).catch(() => [])
    const found = listed.find((w) => w.path === path)
    if (found === undefined)
      throw new ActionRefusal("notFound", `no worktree ${path} in ${project}`)
    return found
  }
  const view = async (handle: string | undefined): Promise<TerminalView> =>
    handle === undefined || deps.terminal.attach === undefined
      ? {}
      : { attach: await deps.terminal.attach(handle) }
  return {
    driver: async (project, path) => {
      await check(project, path)
      return view(deps.panes.get(path))
    },
    openShell: async (project, path, origin) => {
      const worktree = await check(project, path)
      const handle = await deps.terminal.run(project, path, [deps.shell], {})
      deps.audit.write({
        time: new Date(deps.now()).toISOString(),
        identity: origin.identity ?? "-",
        endpoint: origin.endpoint,
        project,
        worktree: worktree.branch ?? basename(path),
        action: "shell",
        outcome: "accepted",
      })
      return view(handle)
    },
  }
}
