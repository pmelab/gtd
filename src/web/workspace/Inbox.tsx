import { CircleX, Gauge, Inbox as InboxIcon, Play, RotateCcw, X } from "lucide-react"
import { Button } from "../Button.js"
import { Badge } from "../ui/badge.js"
import { feedsByProject, isPaused, PauseControl, type OnPause } from "./Pauses.js"
import {
  waitText,
  type DrivesView,
  type FeedView,
  type InboxItem,
  type PauseScope,
} from "./view.js"

type ItemPress = "start" | "retry" | "dismiss"

type OnPress = (press: ItemPress, item: InboxItem) => void

/** Why the supervisor turned down the last Start, Retry or Dismiss of an item. */
export interface PressFailure {
  readonly feed: string
  readonly key: string
  readonly message: string
}

const PRESS = {
  start: { label: "Start", Icon: Play, variant: "secondary" },
  retry: { label: "Retry", Icon: RotateCcw, variant: "secondary" },
  dismiss: { label: "Dismiss", Icon: X, variant: "ghost" },
} as const

// Start on a proposed item, Retry on a failed one; both can be dismissed.
const PRESSES: Partial<Record<InboxItem["state"], readonly ItemPress[]>> = {
  proposed: ["start", "dismiss"],
  failed: ["retry", "dismiss"],
}

const STATE_VARIANT: Readonly<Record<InboxItem["state"], "outline" | "muted" | "destructive">> = {
  proposed: "outline",
  queued: "muted",
  blocked: "muted",
  starting: "muted",
  started: "muted",
  failed: "destructive",
}

const Presses = ({ item, onPress }: { readonly item: InboxItem; readonly onPress: OnPress }) => {
  const presses = PRESSES[item.state]
  if (presses === undefined) return null
  return (
    <div className="flex shrink-0 gap-2">
      {presses.map((press) => {
        const { label, Icon, variant } = PRESS[press]
        return (
          <Button
            key={press}
            variant={variant}
            size="sm"
            onClick={() => {
              onPress(press, item)
            }}
          >
            <Icon aria-hidden="true" />
            {label}
          </Button>
        )
      })}
    </div>
  )
}

const Title = ({ item }: { readonly item: InboxItem }) =>
  item.url === undefined ? (
    item.title
  ) : (
    <a
      className="underline decoration-muted-foreground underline-offset-4 hover:decoration-foreground"
      href={item.url}
      target="_blank"
      rel="noreferrer"
    >
      {item.title}
    </a>
  )

/** A plain title for why an item failed or waits, with the raw reason under it. */
const Message = ({ item }: { readonly item: InboxItem }) => {
  if (item.message === undefined) return null
  const title = item.state === "failed" ? "Start failed" : waitText(item.message)
  if (title === undefined) {
    return (
      <span className="text-sm text-muted-foreground" data-testid="inbox-message">
        {item.message}
      </span>
    )
  }
  return (
    <span className="flex flex-col gap-0.5">
      <span
        className={`text-sm ${item.state === "failed" ? "text-destructive" : "text-foreground"}`}
        data-testid="inbox-reason"
      >
        {title}
      </span>
      <span
        className="font-mono text-xs break-words text-muted-foreground"
        data-testid="inbox-message"
      >
        {item.message}
      </span>
    </span>
  )
}

const Failure = ({
  message,
  testId,
}: {
  readonly message?: string | undefined
  readonly testId: string
}) =>
  message === undefined ? null : (
    <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
      <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span data-testid={testId}>{message}</span>
    </p>
  )

const Item = ({
  item,
  onPress,
  failure,
}: {
  readonly item: InboxItem
  readonly onPress: OnPress
  readonly failure?: string | undefined
}) => (
  <li className="flex flex-col gap-2 border-t border-border px-4 py-3" data-testid="inbox-item">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-medium">
          <Title item={item} />
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <Badge variant={STATE_VARIANT[item.state]} data-testid="inbox-state">
            {item.state}
          </Badge>
          {item.blockedBy.length > 0 && <span>blocked by {item.blockedBy.join(", ")}</span>}
        </span>
        <Message item={item} />
      </div>
      <Presses item={item} onPress={onPress} />
    </div>
    <Failure message={failure} testId="press-error" />
  </li>
)

interface Groups {
  readonly feeds: readonly FeedView[]
  readonly items: readonly InboxItem[]
}

/** Each project with its feeds, in the order the pauses list them; a feed only an item names comes last. */
const groupsOf = ({ feeds, items }: Groups): [string, { feed: string; known: boolean }[]][] => {
  const groups = new Map(
    feedsByProject(feeds).map(([project, names]) => [
      project,
      names.map((feed) => ({ feed, known: true })),
    ]),
  )
  for (const item of items) {
    const group = groups.get(item.project) ?? []
    if (!group.some((g) => g.feed === item.feed)) group.push({ feed: item.feed, known: false })
    groups.set(item.project, group)
  }
  return [...groups]
}

// fallow-ignore-next-line complexity
const Feed = ({
  project,
  feed,
  known,
  view,
}: {
  readonly project: string
  readonly feed: string
  readonly known: boolean
  readonly view: InboxProps
}) => {
  const failing = view.feeds.find((f) => f.project === project && f.feed === feed)?.failing
  const items = view.items.filter((i) => i.project === project && i.feed === feed)
  const scope = { project, feed }
  return (
    <div className="border-t border-border">
      {known ? (
        <PauseControl
          scope={scope}
          paused={isPaused(view.paused, scope)}
          onPause={view.onPause}
          className="bg-muted/50 px-4 py-1"
        />
      ) : (
        <p className="bg-muted/50 px-4 py-2.5 text-sm font-medium">feed {feed}</p>
      )}
      {failing !== undefined && (
        <div className="flex items-start gap-2 border-t border-border px-4 py-2 text-sm">
          <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-destructive">Feed check failed</p>
            <p
              className="font-mono text-xs break-words text-muted-foreground"
              data-testid="feed-failing"
            >
              {failing}
            </p>
          </div>
        </div>
      )}
      {items.length > 0 && (
        <ul>
          {items.map((item) => (
            <Item
              key={`${item.feed}/${item.key}`}
              item={item}
              onPress={view.onPress}
              failure={
                view.pressFailures?.find((f) => f.feed === item.feed && f.key === item.key)?.message
              }
            />
          ))}
        </ul>
      )}
    </div>
  )
}

interface InboxProps {
  readonly items: readonly InboxItem[]
  readonly feeds: readonly FeedView[]
  readonly drives: DrivesView
  readonly paused: readonly PauseScope[]
  readonly onPress: OnPress
  readonly onPause: OnPause
  readonly pressFailures?: readonly PressFailure[]
  readonly pauseFailure?: string | undefined
}

/** What waits in the inbox, by project and feed, with the drives in use and the pauses. */
export const Inbox = (view: InboxProps) => (
  <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-border bg-card py-1 pr-2 pl-4 shadow-[0_1px_2px_rgb(21_26_29/0.05)]">
      <p className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground lg:min-h-9">
        <Gauge aria-hidden="true" className="size-4" />
        <span data-testid="drives" className="tabular-nums">
          {view.drives.max === undefined
            ? `${view.drives.inUse} drives in use`
            : `${view.drives.inUse} of ${view.drives.max} drives in use`}
        </span>
      </p>
      <PauseControl scope={{}} paused={isPaused(view.paused, {})} onPause={view.onPause} />
    </div>
    <Failure message={view.pauseFailure} testId="pause-error" />
    {view.items.length === 0 && (
      <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
        <InboxIcon aria-hidden="true" className="size-6" />
        <p>The inbox is empty.</p>
      </div>
    )}
    {groupsOf(view).map(([project, feeds]) => (
      <section
        key={project}
        className="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(21_26_29/0.05)]"
        aria-label={project}
      >
        <PauseControl
          scope={{ project }}
          paused={isPaused(view.paused, { project })}
          onPause={view.onPause}
          className="py-1 pr-2 pl-4"
          nameClassName="text-base font-semibold"
        />
        {feeds.map(({ feed, known }) => (
          <Feed key={feed} project={project} feed={feed} known={known} view={view} />
        ))}
      </section>
    ))}
  </div>
)
