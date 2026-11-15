import { Button } from "../Button.js"
import { workspaceTrpc } from "./api.js"
import type { TerminalView, WorktreeView } from "./view.js"

/** A URL opens in a new tab; a command is shown to copy into a terminal. */
const Attach = ({
  view,
  what,
  none,
}: {
  readonly view: TerminalView
  readonly what: string
  readonly none: string
}) => {
  if (view.attach === undefined) {
    return (
      <p className="text-small text-muted" data-testid="no-attach">
        {none}
      </p>
    )
  }
  return /^https?:\/\//.test(view.attach) ? (
    <a className="text-link" href={view.attach} target="_blank" rel="noreferrer">
      Open the {what} ↗
    </a>
  ) : (
    <div className="flex flex-col gap-1">
      <span className="text-small text-muted">Attach to the {what} with</span>
      <code className="rounded bg-surface p-2 text-small text-code">{view.attach}</code>
    </div>
  )
}

interface Target {
  readonly project: string
  readonly worktree: string
}

const DriverPane = ({ target }: { readonly target: Target }) => {
  const driver = workspaceTrpc.terminal.useQuery(target)
  if (driver.error !== null) return <p className="text-danger">{driver.error.message}</p>
  if (driver.data === undefined) return null
  return <Attach view={driver.data} what="driver's pane" none="No driver pane to attach to." />
}

const ShellPane = ({ target }: { readonly target: Target }) => {
  const shell = workspaceTrpc.openShell.useMutation()
  return (
    <>
      <Button
        disabled={shell.isPending}
        onClick={() => {
          shell.mutate(target)
        }}
      >
        Open a shell pane
      </Button>
      {shell.error !== null && <p className="text-small text-danger">{shell.error.message}</p>}
      {shell.data !== undefined && (
        <Attach view={shell.data} what="shell pane" none="A shell pane is open in the worktree." />
      )}
    </>
  )
}

/** Attaches to the driver's pane, or opens a separate shell pane in the worktree. */
export const TerminalTab = ({
  project,
  worktree,
}: {
  readonly project: string
  readonly worktree: WorktreeView
}) => {
  const target = { project, worktree: worktree.path }
  return (
    <div className="flex flex-col gap-4 p-4" data-testid="terminal-tab">
      <DriverPane target={target} />
      <ShellPane target={target} />
    </div>
  )
}
