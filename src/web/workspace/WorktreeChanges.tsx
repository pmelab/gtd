import { Plus, Trash2, TriangleAlert } from "lucide-react"
import { useId, useState } from "react"
import { Button } from "../Button.js"
import { Input } from "../ui/input.js"
import { Label } from "../ui/label.js"
import { workspaceTrpc } from "./api.js"
import type { WorktreeView } from "./view.js"

const NewWorktreeForm = ({
  project,
  onCreated,
  onCancel,
}: {
  readonly project: string
  readonly onCreated: (failure: string | undefined) => void
  readonly onCancel: () => void
}) => {
  const [branch, setBranch] = useState("")
  const id = useId()
  const utils = workspaceTrpc.useUtils()
  const create = workspaceTrpc.createWorktree.useMutation({
    onSuccess: (answer) => onCreated(answer.failure),
    onSettled: () => utils.projects.invalidate(),
  })
  return (
    <form
      className="flex w-full flex-col gap-2 px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate({ project, branch })
      }}
    >
      <Label htmlFor={id} className="font-medium">
        Branch
      </Label>
      <Input id={id} value={branch} autoFocus onChange={(e) => setBranch(e.target.value)} />
      {create.error !== null && (
        <span className="text-sm text-destructive" data-testid="new-worktree-error">
          {create.error.message}
        </span>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={create.isPending || branch === ""}>
          Create
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** New worktree on a project: a branch name, then gtd creates the worktree and starts its services. */
export const NewWorktree = ({ project }: { readonly project: string }) => {
  const [open, setOpen] = useState(false)
  // The worktree stays when its services do not start: this says why.
  const [failure, setFailure] = useState<string | undefined>(undefined)
  if (open) {
    return (
      <NewWorktreeForm
        project={project}
        onCreated={(failed) => {
          setOpen(false)
          setFailure(failed)
        }}
        onCancel={() => setOpen(false)}
      />
    )
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        New worktree
      </Button>
      {failure !== undefined && (
        <span className="text-sm text-destructive" data-testid="new-worktree-failure">
          services did not start: {failure}
        </span>
      )}
    </div>
  )
}

const DESTRUCTIVE =
  "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/90 hover:text-destructive-foreground"

/**
 * Remove: gtd first answers what would be lost (uncommitted changes, a branch
 * not integrated); a second press confirms it.
 */
// fallow-ignore-next-line complexity
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
  const heading = useId()
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
    <section
      className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-card p-4"
      aria-labelledby={heading}
      data-testid="danger-zone"
    >
      <div className="flex flex-col gap-1">
        <h3 id={heading} className="flex items-center gap-2 text-sm font-semibold">
          {confirm !== undefined && (
            <TriangleAlert aria-hidden="true" className="size-4 text-destructive" />
          )}
          {confirm === undefined ? "Remove worktree" : "Remove anyway?"}
        </h3>
        <p className="max-w-prose text-sm text-muted-foreground">
          Stops its services, closes the terminal panes gtd opened in it, then deletes the worktree
          and its branch.
        </p>
      </div>
      {confirm === undefined ? (
        <Button
          variant="danger"
          className="self-start"
          disabled={remove.isPending}
          onClick={() => send(false)}
        >
          <Trash2 aria-hidden="true" />
          Remove
        </Button>
      ) : (
        <>
          <div className="text-sm" role="alert" data-testid="remove-confirm">
            <p className="font-medium">This loses:</p>
            <ul className="list-disc pl-5 text-foreground">
              {confirm.map((loss) => (
                <li key={loss}>{loss}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              className={DESTRUCTIVE}
              disabled={remove.isPending}
              onClick={() => send(true)}
            >
              <Trash2 aria-hidden="true" />
              Remove anyway
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(undefined)}>
              Keep
            </Button>
          </div>
        </>
      )}
      {remove.error !== null && (
        <span className="text-sm text-destructive" data-testid="remove-error">
          {remove.error.message}
        </span>
      )}
    </section>
  )
}
