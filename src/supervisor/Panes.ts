import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** A pane gtd opened in a worktree besides the driver's. */
export interface OpenedPane {
  readonly handle: string
  /** The action the pane runs; none for a shell pane. */
  readonly action?: { readonly id: string; readonly label: string; readonly status: string }
}

/**
 * The action and shell panes gtd opened, by worktree path, in the state
 * directory: they outlive the supervisor, and still keep the worktree.
 */
export interface OpenedPanes {
  readonly of: (worktree: string) => readonly OpenedPane[]
  readonly add: (worktree: string, pane: OpenedPane) => void
  readonly forget: (worktree: string) => void
}

export const openedPanes = (stateDirectory: string): OpenedPanes => {
  const file = join(stateDirectory, "panes.json")
  const read = (): Record<string, readonly OpenedPane[]> => {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as Record<string, readonly OpenedPane[]>
    } catch {
      return {}
    }
  }
  const write = (panes: Record<string, readonly OpenedPane[]>): void => {
    mkdirSync(stateDirectory, { recursive: true, mode: 0o700 })
    writeFileSync(file, `${JSON.stringify(panes, null, 2)}\n`, { mode: 0o600 })
  }
  return {
    of: (worktree) => read()[worktree] ?? [],
    add: (worktree, pane) => {
      const panes = read()
      write({ ...panes, [worktree]: [...(panes[worktree] ?? []), pane] })
    },
    forget: (worktree) => {
      const { [worktree]: _gone, ...rest } = read()
      write(rest)
    },
  }
}
