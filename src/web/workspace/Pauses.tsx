import { Button } from "../Button.js"
import type { FeedView, PauseScope } from "./view.js"

const same = (a: PauseScope, b: PauseScope): boolean => a.project === b.project && a.feed === b.feed

const nameOf = ({ project, feed }: PauseScope): string =>
  feed !== undefined ? `feed ${feed}` : (project ?? "workspace")

const indentOf = ({ project, feed }: PauseScope): string =>
  feed !== undefined ? "pl-6" : project !== undefined ? "pl-3" : ""

// The workspace, then each project with its feeds.
const scopesOf = (feeds: readonly FeedView[]): PauseScope[] => {
  const projects = [...new Set(feeds.map((f) => f.project))].sort()
  return [
    {},
    ...projects.flatMap((project) => [
      { project },
      ...feeds.filter((f) => f.project === project).map((f) => ({ project, feed: f.feed })),
    ]),
  ]
}

const ScopeRow = ({
  scope,
  paused,
  onPause,
}: {
  readonly scope: PauseScope
  readonly paused: boolean
  readonly onPause: (scope: PauseScope, pause: boolean) => void
}) => (
  <li
    className={`flex items-center justify-between gap-2 text-small ${indentOf(scope)}`}
    data-testid="pause-scope"
  >
    <span>
      {nameOf(scope)}
      <span className={paused ? "text-warning" : "text-muted"}>
        {paused ? " · paused" : " · dispatching"}
      </span>
    </span>
    <Button
      variant="secondary"
      onClick={() => {
        onPause(scope, !paused)
      }}
    >
      {paused ? "Resume" : "Pause"}
    </Button>
  </li>
)

/** Pause and resume dispatch in the workspace, a project, or a feed. */
export const Pauses = ({
  feeds,
  paused,
  onPause,
}: {
  readonly feeds: readonly FeedView[]
  readonly paused: readonly PauseScope[]
  readonly onPause: (scope: PauseScope, pause: boolean) => void
}) => (
  <ul className="flex flex-col gap-1" aria-label="Dispatch">
    {scopesOf(feeds).map((scope) => (
      <ScopeRow
        key={`${scope.project ?? ""}/${scope.feed ?? ""}`}
        scope={scope}
        paused={paused.some((p) => same(p, scope))}
        onPause={onPause}
      />
    ))}
  </ul>
)
