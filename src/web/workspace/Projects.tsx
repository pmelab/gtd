import { ChevronRight, CircleX, TriangleAlert } from "lucide-react"
import { cn } from "../cn.js"
import { Badge } from "../ui/badge.js"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.js"
import { NoteLine } from "./NoteLine.js"
import { Refused } from "./Press.js"
import { ServiceChips } from "./ServiceChips.js"
import { StatusBadge } from "./Status.js"
import { NewWorktree } from "./WorktreeChanges.js"
import {
  attentionCount,
  noteText,
  reasonText,
  worktreeName,
  type Entry,
  type ProjectView,
  type WorktreeView,
} from "./view.js"

const Problem = ({
  tone,
  children,
  testId,
}: {
  readonly tone: "warning" | "error"
  readonly children: React.ReactNode
  readonly testId?: string
}) => {
  const Icon = tone === "error" ? CircleX : TriangleAlert
  return (
    <p
      className={cn(
        "flex items-start gap-2 px-4 py-2 text-sm",
        tone === "error" ? "text-destructive" : "text-warning",
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span data-testid={testId}>{children}</span>
    </p>
  )
}

// fallow-ignore-next-line complexity
const Row = ({
  worktree,
  selected,
  onOpen,
}: {
  readonly worktree: WorktreeView
  readonly selected: boolean
  readonly onOpen: () => void
}) => {
  const detail = reasonText(worktree)
  const extras =
    worktree.unavailable !== undefined ||
    noteText(worktree) !== undefined ||
    worktree.refusal !== undefined ||
    worktree.servicesFailure !== undefined ||
    (worktree.services ?? []).length > 0
  return (
    <li
      className={cn(
        // The focus ring and the selection fill both cover the whole row, chips included.
        "border-t border-border has-[>button:focus-visible]:ring-2 has-[>button:focus-visible]:ring-ring has-[>button:focus-visible]:ring-inset",
        selected ? "bg-accent" : "has-[>button:hover]:bg-accent/60",
        worktree.unavailable !== undefined && "opacity-60",
      )}
      data-testid="worktree-row"
    >
      <button
        type="button"
        className={cn(
          "grid min-h-11 w-full grid-cols-[minmax(0,auto)_1fr] items-center gap-x-2 gap-y-0.5 px-4 pt-2.5 text-left focus-visible:outline-none",
          extras ? "pb-1.5" : "pb-2.5",
        )}
        aria-current={selected || undefined}
        onClick={onOpen}
      >
        <span className="font-semibold">{worktreeName(worktree)}</span>
        <StatusBadge worktree={worktree} />
        {detail !== "" && (
          <span className="col-span-2 text-sm text-muted-foreground">{detail}</span>
        )}
      </button>
      {extras && (
        <div className="flex flex-col gap-2 px-4 pb-3">
          {worktree.unavailable !== undefined && (
            <span className="text-sm text-muted-foreground">
              {worktree.unavailable.adapter} unavailable
            </span>
          )}
          <NoteLine worktree={worktree} />
          <Refused worktree={worktree} />
          <ServiceChips worktree={worktree} />
        </div>
      )}
    </li>
  )
}

// fallow-ignore-next-line complexity
const Group = ({
  project,
  expanded,
  selected,
  onToggle,
  onOpen,
}: {
  readonly project: ProjectView
  readonly expanded: boolean
  readonly selected: string | undefined
  readonly onToggle: (expanded: boolean) => void
  readonly onOpen: (entry: Entry) => void
}) => {
  const attention = attentionCount(project)
  return (
    <Collapsible open={expanded} onOpenChange={onToggle} asChild>
      <section
        className="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(21_26_29/0.05)]"
        aria-label={project.name}
        data-testid="project"
        data-project-id={project.id}
      >
        <div className="flex flex-wrap items-center gap-x-2 py-1 pr-2 pl-1">
          <h2 className="min-w-0 flex-1">
            <CollapsibleTrigger className="group flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left font-semibold hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <ChevronRight
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
              />
              {project.name}
            </CollapsibleTrigger>
          </h2>
          {!expanded && attention > 0 && (
            <Badge data-testid="project-attention">{attention} need you</Badge>
          )}
          <NewWorktree project={project.id} />
        </div>
        {project.mainStale !== undefined && (
          <Problem tone="warning" testId="main-stale">
            main checkout stale: {project.mainStale}
          </Problem>
        )}
        {project.failure !== undefined && (
          <Problem tone="error">
            {project.failure.adapter} unavailable: {project.failure.message}
          </Problem>
        )}
        <CollapsibleContent asChild>
          <ul>
            {project.worktrees.map((worktree) => (
              <Row
                key={worktree.path}
                worktree={worktree}
                selected={worktree.path === selected}
                onOpen={() => {
                  onOpen({ project, worktree })
                }}
              />
            ))}
          </ul>
        </CollapsibleContent>
      </section>
    </Collapsible>
  )
}

/** The Projects view: every worktree, grouped by project. */
export const Projects = ({
  projects,
  expanded,
  selected,
  onToggle,
  onOpen,
}: {
  readonly projects: readonly ProjectView[]
  /** Expand state by project id, from `useExpanded`; kept by the caller so it outlives this view. */
  readonly expanded: Readonly<Record<string, boolean>>
  /** The path of the worktree whose detail is open beside the list. */
  readonly selected?: string | undefined
  readonly onToggle: (project: string, expanded: boolean) => void
  readonly onOpen: (entry: Entry) => void
}) => (
  <div className="flex flex-col gap-4">
    {projects.map((project) => (
      <Group
        key={project.id}
        project={project}
        expanded={expanded[project.id] === true}
        selected={selected}
        onToggle={(expanded) => {
          onToggle(project.id, expanded)
        }}
        onOpen={onOpen}
      />
    ))}
  </div>
)
