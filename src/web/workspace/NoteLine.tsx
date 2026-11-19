import { CircleX, StickyNote } from "lucide-react"
import { cn } from "../cn.js"
import { noteText, type WorktreeView } from "./view.js"

/** The last note a script put on the worktree. */
export const NoteLine = ({ worktree }: { readonly worktree: WorktreeView }) => {
  const text = noteText(worktree)
  if (text === undefined) return null
  const error = worktree.note?.error === true
  const Icon = error ? CircleX : StickyNote
  return (
    <p
      className={cn(
        "flex items-start gap-2 text-sm",
        error ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span data-testid="note">{text}</span>
    </p>
  )
}
