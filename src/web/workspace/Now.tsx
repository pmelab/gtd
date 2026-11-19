import { Button } from "../Button.js"
import { cn } from "../cn.js"
import { PressButton, Refused } from "./Press.js"
import {
  detailText,
  nowView,
  STATUS_COLOR,
  STATUS_ICON,
  statusText,
  worktreeName,
  type Entry,
  type ProjectView,
} from "./view.js"

const Card = ({ entry, onOpen }: { readonly entry: Entry; readonly onOpen: () => void }) => {
  const { project, worktree } = entry
  return (
    <article
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-surface p-4",
        worktree.status === "needsYou" ? "border-warning" : "border-danger",
        worktree.unavailable !== undefined && "opacity-60",
      )}
      data-testid="now-card"
    >
      <span
        data-icon={STATUS_ICON[worktree.status]}
        className={cn(
          "before:mr-1 before:content-[attr(data-icon)] text-small font-medium uppercase tracking-wide",
          STATUS_COLOR[worktree.status],
        )}
      >
        {statusText(worktree)}
      </span>
      <span className="text-large">{detailText(worktree)}</span>
      <span className="text-small text-muted">
        {project.name} / {worktreeName(worktree)}
      </span>
      <Refused worktree={worktree} />
      <div className="flex items-start gap-2">
        <PressButton worktree={worktree} className="w-full" />
        <Button onClick={onOpen}>Open</Button>
      </div>
    </article>
  )
}

/**
 * The Now view: only gates and errors, across all projects, each with its one
 * primary button. Working worktrees stay collapsed into one line each.
 */
export const Now = ({
  projects,
  onOpen,
}: {
  readonly projects: readonly ProjectView[]
  readonly onOpen: (entry: Entry) => void
}) => {
  const { attention, working } = nowView(projects)
  return (
    <div className="flex flex-col gap-3">
      {attention.length === 0 && (
        <p className="py-12 text-center text-muted" data-testid="now-empty">
          Nothing needs you.
        </p>
      )}
      {attention.map((entry) => (
        <Card
          key={entry.worktree.path}
          entry={entry}
          onOpen={() => {
            onOpen(entry)
          }}
        />
      ))}
      {working.length > 0 && (
        <details className="rounded-lg border border-divider p-3" data-testid="now-working">
          <summary className="min-h-11 cursor-pointer content-center text-small text-muted">
            {working.length} working
          </summary>
          {working.map((entry) => (
            <button
              type="button"
              key={entry.worktree.path}
              className="flex min-h-11 w-full items-center justify-between gap-2 text-left text-small"
              onClick={() => {
                onOpen(entry)
              }}
            >
              <span>
                {entry.project.name} / {worktreeName(entry.worktree)}
              </span>
              <span className="shrink-0 text-link">{entry.worktree.label}</span>
            </button>
          ))}
        </details>
      )}
    </div>
  )
}
