import { cn } from "../cn.js"
import { NoteLine } from "./NoteLine.js"
import { Refused } from "./Press.js"
import { ServiceChips } from "./ServiceChips.js"
import {
  detailText,
  STATUS_COLOR,
  statusText,
  worktreeName,
  type Entry,
  type ProjectView,
  type WorktreeView,
} from "./view.js"

const Row = ({
  worktree,
  selected,
  onOpen,
}: {
  readonly worktree: WorktreeView
  readonly selected: boolean
  readonly onOpen: () => void
}) => (
  <li
    className={cn(
      "flex flex-col gap-1 border-b border-divider py-2",
      worktree.unavailable !== undefined && "opacity-60",
    )}
    data-testid="worktree-row"
  >
    <button
      type="button"
      className={cn("flex min-h-11 items-baseline gap-3 text-left", selected && "text-link")}
      aria-current={selected}
      onClick={onOpen}
    >
      <span className={cn("w-24 shrink-0 text-small", STATUS_COLOR[worktree.status])}>
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

/** The Projects view: every worktree, grouped by project. */
export const Projects = ({
  projects,
  selected,
  onOpen,
}: {
  readonly projects: readonly ProjectView[]
  readonly selected: string | undefined
  readonly onOpen: (entry: Entry) => void
}) => (
  <div className="flex flex-col gap-5">
    {projects.map((project) => (
      <section key={project.id} className="flex flex-col" data-testid="project">
        <h2 className="font-medium">{project.name}</h2>
        {project.failure !== undefined && (
          <p className="text-small text-danger">
            {project.failure.adapter} unavailable: {project.failure.message}
          </p>
        )}
        <ul>
          {project.worktrees.map((worktree) => (
            <Row
              key={worktree.path}
              worktree={worktree}
              selected={selected === worktree.path}
              onOpen={() => {
                onOpen({ project, worktree })
              }}
            />
          ))}
        </ul>
      </section>
    ))}
  </div>
)
