import { CircleAlert, CircleX, type LucideIcon } from "lucide-react"
import { cn } from "../cn.js"
import { Badge } from "../ui/badge.js"
import { projectCounts, type ProjectView } from "./view.js"

export interface ViewTab<Id extends string> {
  readonly id: Id
  readonly label: string
  readonly icon: LucideIcon
  /** Shown as a badge when above zero; `attention` makes it yellow. */
  readonly count?: number
  readonly attention?: boolean
}

const CountBadge = ({
  count,
  attention,
}: {
  readonly count: number
  readonly attention: boolean
}) => (
  <span
    aria-hidden="true"
    className={cn(
      "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
      attention ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
    )}
  >
    {count}
  </span>
)

/**
 * The views: a bottom tab bar on a phone, a sidebar list on desktop. A
 * button's name carries its count, "Now (2)".
 */
interface ItemProps {
  readonly tab: ViewTab<string>
  readonly selected: boolean
  readonly onSelect: () => void
}

const FOCUS = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"

const Spoken = ({ count = 0 }: { readonly count?: number | undefined }) =>
  count > 0 ? <span className="sr-only"> ({count})</span> : null

const SideItem = ({
  tab: { label, icon: Icon, count = 0, attention = false },
  selected,
  onSelect,
}: ItemProps) => (
  <button
    type="button"
    aria-current={selected}
    className={cn(
      FOCUS,
      "flex min-h-9 items-center gap-3 rounded-md px-3 text-left text-sm",
      selected
        ? "bg-accent font-semibold text-foreground"
        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
    )}
    onClick={onSelect}
  >
    <Icon aria-hidden="true" className="size-4 shrink-0" />
    <span className="flex-1">
      {label}
      <Spoken count={count} />
    </span>
    {count > 0 && <CountBadge count={count} attention={attention} />}
  </button>
)

const BottomItem = ({
  tab: { label, icon: Icon, count = 0, attention = false },
  selected,
  onSelect,
}: ItemProps) => (
  <button
    type="button"
    aria-current={selected}
    className={cn(
      FOCUS,
      "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-xs",
      selected ? "font-semibold text-foreground" : "text-muted-foreground",
    )}
    onClick={onSelect}
  >
    <span
      className={cn(
        "relative flex h-7 w-14 items-center justify-center rounded-full",
        selected && "bg-accent",
      )}
    >
      <Icon aria-hidden="true" className="size-5" />
      {count > 0 && (
        <span className="absolute -top-1 left-8">
          <CountBadge count={count} attention={attention} />
        </span>
      )}
    </span>
    <span>
      {label}
      <Spoken count={count} />
    </span>
  </button>
)

export const ViewNav = <Id extends string>({
  tabs,
  current,
  onSelect,
  vertical,
  className,
}: {
  readonly tabs: readonly ViewTab<Id>[]
  readonly current: Id
  readonly onSelect: (id: Id) => void
  readonly vertical: boolean
  readonly className?: string
}) => (
  <nav
    className={cn("flex", vertical ? "flex-col gap-0.5" : "flex-row", className)}
    aria-label="Views"
  >
    {tabs.map((tab) => {
      const Item = vertical ? SideItem : BottomItem
      return (
        <Item
          key={tab.id}
          tab={tab}
          selected={current === tab.id}
          onSelect={() => {
            onSelect(tab.id)
          }}
        />
      )
    })}
  </nav>
)

/** The sidebar's projects, each with how many of its worktrees need you and are in error. */
export const ProjectNav = ({
  projects,
  onSelect,
}: {
  readonly projects: readonly ProjectView[]
  readonly onSelect: (project: string) => void
}) => (
  <nav className="flex flex-col gap-0.5 px-3" aria-labelledby="sidebar-projects">
    <h2 id="sidebar-projects" className="px-3 pt-4 pb-1 text-xs font-medium text-muted-foreground">
      Projects
    </h2>
    {projects.map((project) => {
      const { needsYou, error } = projectCounts(project)
      return (
        <button
          type="button"
          key={project.id}
          data-testid="sidebar-project"
          className="flex min-h-8 items-center gap-2 rounded-md px-3 text-left text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          onClick={() => {
            onSelect(project.id)
          }}
        >
          <span className="min-w-0 flex-1 truncate">{project.name}</span>
          {needsYou > 0 && (
            <Badge data-testid="sidebar-needs-you">
              <CircleAlert aria-hidden="true" />
              {needsYou}
              <span className="sr-only"> need you</span>
            </Badge>
          )}
          {error > 0 && (
            <Badge variant="destructive" data-testid="sidebar-error">
              <CircleX aria-hidden="true" />
              {error}
              <span className="sr-only"> in error</span>
            </Badge>
          )}
        </button>
      )
    })}
  </nav>
)
