import { cn } from "../cn.js"
import { NoteLine } from "./NoteLine.js"
import { Refused } from "./Press.js"
import { ServiceChips } from "./ServiceChips.js"
import { NewWorktree } from "./WorktreeChanges.js"
import {
  attentionCount,
  detailText,
  STATUS_COLOR,
  STATUS_ICON,
  statusText,
  worktreeName,
  type Entry,
  type ProjectView,
  type WorktreeView,
} from "./view.js"

const Row = ({
  worktree,
  onOpen,
}: {
  readonly worktree: WorktreeView
  readonly onOpen: () => void
}) => (
  <li
    className={cn(
      "flex flex-col gap-1 border-b border-divider py-2",
      worktree.unavailable !== undefined && "opacity-60",
    )}
    data-testid="worktree-row"
  >
    <button type="button" className="flex min-h-11 items-baseline gap-3 text-left" onClick={onOpen}>
      <span
        data-icon={STATUS_ICON[worktree.status]}
        className={cn(
          "w-28 shrink-0 text-small before:mr-1 before:content-[attr(data-icon)]",
          STATUS_COLOR[worktree.status],
        )}
      >
        {statusText(worktree)}
      </span>
      <span className="font-medium">{worktreeName(worktree)}</span>
      <span className="min-w-0 flex-1 text-small text-muted">{detailText(worktree)}</span>
    </button>
    {worktree.unavailable !== undefined && (
      <span className="text-small text-muted">{worktree.unavailable.adapter} unavailable</span>
    )}
    <NoteLine worktree={worktree} />
    <Refused worktree={worktree} />
    <ServiceChips worktree={worktree} />
  </li>
)

// fallow-ignore-next-line complexity
const Group = ({
  project,
  expanded,
  onToggle,
  onOpen,
}: {
  readonly project: ProjectView
  readonly expanded: boolean
  readonly onToggle: (expanded: boolean) => void
  readonly onOpen: (entry: Entry) => void
}) => {
  const attention = attentionCount(project)
  return (
    <section
      className="flex flex-col gap-1 rounded-lg border border-divider p-3"
      aria-label={project.name}
      data-testid="project"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex min-h-11 items-center gap-2 text-left"
          aria-expanded={expanded}
          onClick={() => {
            onToggle(!expanded)
          }}
        >
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          <h2 className="font-medium">{project.name}</h2>
          {!expanded && attention > 0 && (
            <span className="text-small text-warning" data-testid="project-attention">
              {attention} need you
            </span>
          )}
        </button>
        <NewWorktree project={project.id} />
      </div>
      {project.mainStale !== undefined && (
        <p className="text-small text-danger" data-testid="main-stale">
          main checkout stale: {project.mainStale}
        </p>
      )}
      {project.failure !== undefined && (
        <p className="text-small text-danger">
          {project.failure.adapter} unavailable: {project.failure.message}
        </p>
      )}
      {expanded && (
        <ul>
          {project.worktrees.map((worktree) => (
            <Row
              key={worktree.path}
              worktree={worktree}
              onOpen={() => {
                onOpen({ project, worktree })
              }}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

/** The Projects view: every worktree, grouped by project. */
export const Projects = ({
  projects,
  expanded,
  onToggle,
  onOpen,
}: {
  readonly projects: readonly ProjectView[]
  /** Expand state by project id, from `useExpanded`; kept by the caller so it outlives this view. */
  readonly expanded: Readonly<Record<string, boolean>>
  readonly onToggle: (project: string, expanded: boolean) => void
  readonly onOpen: (entry: Entry) => void
}) => (
  <div className="flex flex-col gap-5">
    {projects.map((project) => (
      <Group
        key={project.id}
        project={project}
        expanded={expanded[project.id] === true}
        onToggle={(expanded) => {
          onToggle(project.id, expanded)
        }}
        onOpen={onOpen}
      />
    ))}
  </div>
)
