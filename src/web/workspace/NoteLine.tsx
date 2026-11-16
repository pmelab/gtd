import { cn } from "../cn.js"
import { noteText, type WorktreeView } from "./view.js"

/** The last note a script put on the worktree. */
export const NoteLine = ({ worktree }: { readonly worktree: WorktreeView }) => {
  const text = noteText(worktree)
  if (text === undefined) return null
  return (
    <span
      className={cn("text-small", worktree.note?.error === true ? "text-danger" : "text-muted")}
      data-testid="note"
    >
      {text}
    </span>
  )
}
