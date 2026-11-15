import { Button } from "../Button.js"
import { workspaceTrpc } from "./api.js"
import { pressFor, type WorktreeView } from "./view.js"

const LABEL = { proceed: "Proceed", retry: "Retry" } as const

/**
 * Proceed at a gate, Retry on an error: the worktree's one primary button.
 * It sends the HEAD the page shows, so gtd refuses it once HEAD moved.
 */
// fallow-ignore-next-line complexity
export const PressButton = ({
  worktree,
  className,
}: {
  readonly worktree: WorktreeView
  readonly className?: string
}) => {
  const utils = workspaceTrpc.useUtils()
  const settled = { onSettled: () => utils.projects.invalidate() }
  const proceed = workspaceTrpc.proceed.useMutation(settled)
  const retry = workspaceTrpc.retry.useMutation(settled)
  const action = pressFor(worktree)
  if (action === undefined) return null
  const mutation = action === "proceed" ? proceed : retry
  const failed = mutation.error?.message
  return (
    <div className="flex flex-1 flex-col gap-1">
      <Button
        variant="primary"
        className={className}
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ worktree: worktree.path, commit: worktree.head })}
      >
        {LABEL[action]}
      </Button>
      {failed !== undefined && failed !== worktree.refusal && (
        <span className="text-small text-danger" data-testid="press-error">
          {failed}
        </span>
      )}
    </div>
  )
}

/** Why gtd or the driver refused the last press at this HEAD. */
export const Refused = ({ worktree }: { readonly worktree: WorktreeView }) =>
  worktree.refusal === undefined ? null : (
    <p className="text-small text-danger" data-testid="refusal">
      refused: {worktree.refusal}
    </p>
  )
