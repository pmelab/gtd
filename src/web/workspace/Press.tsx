import { Ban, CircleX, Play, RotateCcw } from "lucide-react"
import { Button } from "../Button.js"
import { cn } from "../cn.js"
import { workspaceTrpc } from "./api.js"
import { pressFor, type WorktreeView } from "./view.js"

const PRESS = {
  proceed: { label: "Proceed", Icon: Play, variant: "warning" },
  retry: { label: "Retry", Icon: RotateCcw, variant: "secondary" },
} as const

/**
 * Proceed at a gate, Retry on an error: the worktree's one action.
 * It sends the HEAD the page shows, so gtd refuses it once HEAD moved.
 */
// fallow-ignore-next-line complexity
export const PressButton = ({
  worktree,
  className,
  hideProceed = false,
}: {
  readonly worktree: WorktreeView
  readonly className?: string
  /** The Gate tab's page has its own Proceed. */
  readonly hideProceed?: boolean
}) => {
  const utils = workspaceTrpc.useUtils()
  const settled = { onSettled: () => utils.projects.invalidate() }
  const proceed = workspaceTrpc.proceed.useMutation(settled)
  const retry = workspaceTrpc.retry.useMutation(settled)
  const action = pressFor(worktree)
  if (action === undefined || (hideProceed && action === "proceed")) return null
  const mutation = action === "proceed" ? proceed : retry
  const failed = mutation.error?.message
  const { label, Icon, variant } = PRESS[action]
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 lg:flex-none">
      <Button
        variant={variant}
        className={className}
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ worktree: worktree.path, commit: worktree.head })}
      >
        <Icon aria-hidden="true" />
        {label}
      </Button>
      {failed !== undefined && failed !== worktree.refusal && (
        <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
          <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span data-testid="press-error">{failed}</span>
        </p>
      )}
    </div>
  )
}

/** Why gtd or the driver refused the last press at this HEAD. */
export const Refused = ({
  worktree,
  className,
}: {
  readonly worktree: WorktreeView
  readonly className?: string
}) =>
  worktree.refusal === undefined ? null : (
    <div
      className={cn("flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm", className)}
      data-testid="refusal"
    >
      <Ban aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0">
        <span className="font-medium">Last press refused. </span>
        <span className="text-muted-foreground" data-testid="refusal-reason">
          {worktree.refusal}
        </span>
      </p>
    </div>
  )
