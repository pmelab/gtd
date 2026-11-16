import { useState } from "react"
import { Button } from "../Button.js"
import { workspaceTrpc } from "./api.js"
import type { WorktreeView } from "./view.js"

const INPUT =
  "min-h-11 rounded border border-border bg-surface px-2 text-body text-text placeholder:text-disabled"

/** New worktree on a project: a branch name, then gtd creates the worktree and starts its services. */
export const NewWorktree = ({ project }: { readonly project: string }) => {
  const [open, setOpen] = useState(false)
  const [branch, setBranch] = useState("")
  // The worktree stays when its services do not start: this says why.
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const utils = workspaceTrpc.useUtils()
  const create = workspaceTrpc.createWorktree.useMutation({
    onSuccess: (answer) => {
      setOpen(false)
      setBranch("")
      setFailure(answer.failure)
    },
    onSettled: () => utils.projects.invalidate(),
  })
  if (!open) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button variant="ghost" className="text-small" onClick={() => setOpen(true)}>
          New worktree
        </Button>
        {failure !== undefined && (
          <span className="text-small text-danger" data-testid="new-worktree-failure">
            services did not start: {failure}
          </span>
        )}
      </div>
    )
  }
  return (
    <form
      className="flex flex-col gap-2 py-2"
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate({ project, branch })
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-small text-muted">Branch</span>
        <input
          className={INPUT}
          value={branch}
          autoFocus
          onChange={(e) => setBranch(e.target.value)}
        />
      </label>
      {create.error !== null && (
        <span className="text-small text-danger" data-testid="new-worktree-error">
          {create.error.message}
        </span>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={create.isPending || branch === ""}>
          Create
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/**
 * Remove: gtd first answers what would be lost (uncommitted changes, a branch
 * not integrated); a second press confirms it.
 */
export const RemoveButton = ({
  project,
  worktree,
  onRemoved,
}: {
  readonly project: string
  readonly worktree: WorktreeView
  readonly onRemoved: () => void
}) => {
  const [confirm, setConfirm] = useState<readonly string[] | undefined>(undefined)
  const utils = workspaceTrpc.useUtils()
  const remove = workspaceTrpc.removeWorktree.useMutation({
    onSuccess: (answer) => {
      if ("confirm" in answer) return setConfirm(answer.confirm)
      onRemoved()
    },
    onSettled: () => utils.projects.invalidate(),
  })
  if (worktree.main) return null
  const send = (confirmed: boolean): void =>
    remove.mutate({ project, worktree: worktree.path, confirmed })
  return (
    <div className="flex flex-col gap-1">
      {confirm === undefined ? (
        <Button
          variant="danger"
          className="self-start"
          disabled={remove.isPending}
          onClick={() => send(false)}
        >
          Remove
        </Button>
      ) : (
        <>
          <p className="text-small text-danger" data-testid="remove-confirm">
            Remove anyway? This loses: {confirm.join(", ")}
          </p>
          <div className="flex gap-2">
            <Button variant="danger" disabled={remove.isPending} onClick={() => send(true)}>
              Remove anyway
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(undefined)}>
              Keep
            </Button>
          </div>
        </>
      )}
      {remove.error !== null && (
        <span className="text-small text-danger" data-testid="remove-error">
          {remove.error.message}
        </span>
      )}
    </div>
  )
}
