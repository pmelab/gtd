import { Button } from "../Button.js"
import type { DrivesView, FeedView, InboxItem } from "./view.js"

interface ItemActions {
  readonly onStart: (item: InboxItem) => void
  readonly onRetry: (item: InboxItem) => void
  readonly onDismiss: (item: InboxItem) => void
}

const Title = ({ item }: { readonly item: InboxItem }) =>
  item.url === undefined ? (
    item.title
  ) : (
    <a className="text-link" href={item.url} target="_blank" rel="noreferrer">
      {item.title}
    </a>
  )

// Start on a proposed item, Retry on a failed one, and Dismiss on both.
const Controls = ({
  item,
  onStart,
  onRetry,
  onDismiss,
}: ItemActions & { readonly item: InboxItem }) => {
  const start = item.state === "proposed"
  return (
    <div className="flex gap-2 pt-1">
      <Button
        onClick={() => {
          if (start) onStart(item)
          else onRetry(item)
        }}
      >
        {start ? "Start" : "Retry"}
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          onDismiss(item)
        }}
      >
        Dismiss
      </Button>
    </div>
  )
}

// Where the item stands, and why it waits or failed.
const Facts = ({ item }: { readonly item: InboxItem }) => (
  <>
    <span className="text-small text-muted">
      {item.state} · {item.feed} · {item.project}
      {item.blockedBy.length > 0 ? ` · blocked by ${item.blockedBy.join(", ")}` : ""}
    </span>
    {item.message !== undefined && (
      <span className="text-small text-muted" data-testid="inbox-message">
        {item.message}
      </span>
    )}
  </>
)

const Item = (props: ItemActions & { readonly item: InboxItem }) => {
  const { item } = props
  return (
    <article className="flex flex-col gap-1 rounded-lg bg-surface p-3" data-testid="inbox-item">
      <span>
        <Title item={item} />
      </span>
      <Facts item={item} />
      {(item.state === "proposed" || item.state === "failed") && <Controls {...props} />}
    </article>
  )
}

/** What waits in the inbox, and the feeds whose last poll failed. */
export const Inbox = ({
  items,
  feeds,
  drives,
  onStart,
  onRetry,
  onDismiss,
}: ItemActions & {
  readonly items: readonly InboxItem[]
  readonly feeds: readonly FeedView[]
  readonly drives: DrivesView
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
      <Item
        key={`${item.feed}/${item.key}`}
        item={item}
        onStart={onStart}
        onRetry={onRetry}
        onDismiss={onDismiss}
      />
    ))}
  </div>
)
