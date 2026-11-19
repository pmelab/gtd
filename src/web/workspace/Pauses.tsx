import { Pause, Play } from "lucide-react"
import { Button } from "../Button.js"
import { cn } from "../cn.js"
import type { FeedView, PauseScope } from "./view.js"

export type OnPause = (scope: PauseScope, pause: boolean) => void

const same = (a: PauseScope, b: PauseScope): boolean => a.project === b.project && a.feed === b.feed

export const isPaused = (paused: readonly PauseScope[], scope: PauseScope): boolean =>
  paused.some((p) => same(p, scope))

const nameOf = ({ project, feed }: PauseScope): string =>
  feed !== undefined ? `feed ${feed}` : (project ?? "workspace")

/** The projects that have feeds, in order, each with its feeds. */
export const feedsByProject = (feeds: readonly FeedView[]): [string, string[]][] =>
  [...new Set(feeds.map((f) => f.project))]
    .sort()
    .map((project) => [project, feeds.filter((f) => f.project === project).map((f) => f.feed)])

/** Whether the workspace, a project or a feed dispatches, and the press that flips it. */
export const PauseControl = ({
  scope,
  paused,
  onPause,
  className,
  nameClassName,
}: {
  readonly scope: PauseScope
  readonly paused: boolean
  readonly onPause: OnPause
  readonly className?: string
  readonly nameClassName?: string
}) => (
  <div
    className={cn("flex min-w-0 items-center justify-between gap-2", className)}
    data-testid="pause-scope"
  >
    <p className="min-w-0 text-sm">
      <span className={cn("font-medium", nameClassName)}>{nameOf(scope)}</span>
      <span className={paused ? "font-medium text-warning" : "text-muted-foreground"}>
        {paused ? " · paused" : " · dispatching"}
      </span>
    </p>
    <Button
      variant="ghost"
      size="sm"
      className="shrink-0"
      onClick={() => {
        onPause(scope, !paused)
      }}
    >
      {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
      {paused ? "Resume" : "Pause"}
    </Button>
  </div>
)
