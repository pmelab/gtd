import { Button } from "../Button.js"
import type { DrivesView, FeedView, InboxItem } from "./view.js"

export type ItemPress = "start" | "retry" | "dismiss"

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

const Presses = ({
  item,
  onPress,
}: {
  readonly item: InboxItem
  readonly onPress: (press: ItemPress, item: InboxItem) => void
}) => {
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

const Item = ({
  item,
  onPress,
}: {
  readonly item: InboxItem
  readonly onPress: (press: ItemPress, item: InboxItem) => void
}) => (
  <article className="flex flex-col gap-1 rounded-lg bg-surface p-3" data-testid="inbox-item">
    <span>
      {item.url === undefined ? (
        item.title
      ) : (
        <a className="text-link" href={item.url} target="_blank" rel="noreferrer">
          {item.title}
        </a>
      )}
    </span>
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
    <Presses item={item} onPress={onPress} />
  </article>
)

/** What waits in the inbox, the drives in use, and the feeds whose last poll failed. */
export const Inbox = ({
  items,
  feeds,
  drives,
  onPress,
}: {
  readonly items: readonly InboxItem[]
  readonly feeds: readonly FeedView[]
  readonly drives: DrivesView
  readonly onPress: (press: ItemPress, item: InboxItem) => void
}) => (
  <div className="flex flex-col gap-3">
    <p className="text-small text-muted" data-testid="drives">
      {drives.max === undefined
        ? `${drives.inUse} drives in use`
        : `${drives.inUse} of ${drives.max} drives in use`}
    </p>
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
      <Item key={`${item.feed}/${item.key}`} item={item} onPress={onPress} />
    ))}
  </div>
)
