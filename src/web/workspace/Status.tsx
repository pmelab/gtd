import { CircleAlert, CircleDashed, CircleX, Hourglass, LoaderCircle } from "lucide-react"
import { Badge } from "../ui/badge.js"
import { cn } from "../cn.js"
import { statusText, type StatusName, type WorktreeView } from "./view.js"

const ICON: Readonly<Record<StatusName, typeof CircleAlert>> = {
  needsYou: CircleAlert,
  working: LoaderCircle,
  error: CircleX,
  idle: CircleDashed,
  waiting: Hourglass,
}

const VARIANT = {
  needsYou: "default",
  working: "outline",
  error: "destructive",
  idle: "muted",
  waiting: "outline",
} as const

/** A worktree's status as a badge: icon, word and colour, never colour alone. */
export const StatusBadge = ({
  worktree,
  className,
}: {
  readonly worktree: WorktreeView
  readonly className?: string
}) => {
  const Icon = ICON[worktree.status]
  return (
    <Badge variant={VARIANT[worktree.status]} className={className} data-status={worktree.status}>
      <Icon
        aria-hidden="true"
        className={cn(worktree.status === "working" && "animate-spin motion-reduce:animate-none")}
      />
      {statusText(worktree)}
    </Badge>
  )
}
