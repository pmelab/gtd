import { Button } from "../Button.js"
import { Pauses } from "./Pauses.js"
import type { DrivesView, FeedView, InboxItem, PauseScope } from "./view.js"

type ItemPress = "start" | "retry" | "dismiss"

type OnPress = (press: ItemPress, item: InboxItem) => void

/** Why the supervisor turned down the last Start, Retry or Dismiss of an item. */
export interface PressFailure {
  readonly feed: string
  readonly key: string
  readonly message: string
}

// Start on a proposed item, Retry on a failed one; both can be dismissed.
const PRESSES: Partial<Record<InboxItem["state"], readonly [ItemPress, string][]>> = {
  proposed: [
    ["start", "Start"],
    ["dismiss", "Dismiss"],
  ],
  failed: [
    ["retry", "Retry"],
    ["dismiss", "Dismiss"],
  ],
}

const Presses = ({ item, onPress }: { readonly item: InboxItem; readonly onPress: OnPress }) => {
  const presses = PRESSES[item.state]
  if (presses === undefined) return null
  return (
    <div className="flex gap-2 pt-1">
      {presses.map(([press, label]) => (
        <Button
          key={press}
          variant={press === "dismiss" ? "ghost" : "primary"}
          onClick={() => {
            onPress(press, item)
          }}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}

const Title = ({ item }: { readonly item: InboxItem }) =>
  item.url === undefined ? (
    item.title
  ) : (
    <a className="text-link" href={item.url} target="_blank" rel="noreferrer">
      {item.title}
    </a>
  )

// Where the item stands, and why it waits or failed.
const Facts = ({ item }: { readonly item: InboxItem }) => (
  <>
    <span className="text-small text-muted">
      {item.state} · {item.feed} · {item.project}
      {item.blockedBy.length > 0 ? ` · blocked by ${item.blockedBy.join(", ")}` : ""}
    </span>
    {item.message !== undefined && (
      <span
        className={`text-small ${item.state === "failed" ? "text-danger" : "text-muted"}`}
        data-testid="inbox-message"
      >
        {item.message}
      </span>
    )}
  </>
)

const Failure = ({
  message,
  testId,
}: {
  readonly message?: string | undefined
  readonly testId: string
}) =>
  message === undefined ? null : (
    <span className="text-small text-danger" data-testid={testId}>
      {message}
    </span>
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
  <article className="flex flex-col gap-1 rounded-lg bg-surface p-3" data-testid="inbox-item">
    <span>
      <Title item={item} />
    </span>
    <Facts item={item} />
    <Presses item={item} onPress={onPress} />
    <Failure message={failure} testId="press-error" />
  </article>
)

/** What waits in the inbox, the drives in use, the pauses, and the feeds whose last poll failed. */
export const Inbox = ({
  items,
  feeds,
  drives,
  paused,
  onPress,
  onPause,
  pressFailures = [],
  pauseFailure,
}: {
  readonly items: readonly InboxItem[]
  readonly feeds: readonly FeedView[]
  readonly drives: DrivesView
  readonly paused: readonly PauseScope[]
  readonly onPress: OnPress
  readonly onPause: (scope: PauseScope, pause: boolean) => void
  readonly pressFailures?: readonly PressFailure[]
  readonly pauseFailure?: string | undefined
}) => (
  <div className="flex flex-col gap-3">
    <p className="text-small text-muted" data-testid="drives">
      {drives.max === undefined
        ? `${drives.inUse} drives in use`
        : `${drives.inUse} of ${drives.max} drives in use`}
    </p>
    <Pauses feeds={feeds} paused={paused} onPause={onPause} />
    <Failure message={pauseFailure} testId="pause-error" />
    {feeds
      .filter((f) => f.failing !== undefined)
      .map((f) => (
        <p
          key={f.feed}
          className="rounded border border-danger bg-surface p-3 text-small text-danger"
          data-testid="feed-failing"
        >
          feed {f.feed} failing: {f.failing}
        </p>
      ))}
    {items.length === 0 && <p className="py-12 text-center text-muted">The inbox is empty.</p>}
    {items.map((item) => (
      <Item
        key={`${item.feed}/${item.key}`}
        item={item}
        onPress={onPress}
        failure={pressFailures.find((f) => f.feed === item.feed && f.key === item.key)?.message}
      />
    ))}
  </div>
)
