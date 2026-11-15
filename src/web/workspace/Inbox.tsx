import { Button } from "../Button.js"
import type { FeedView, InboxItem } from "./view.js"

export type InboxPress = "start" | "retry" | "dismiss"

const pressesOf = (item: InboxItem): readonly (readonly [InboxPress, string])[] =>
  item.state === "proposed"
    ? [
        ["start", "Start"],
        ["dismiss", "Dismiss"],
      ]
    : item.state === "failed"
      ? [
          ["retry", "Retry"],
          ["dismiss", "Dismiss"],
        ]
      : []

/** What waits in the inbox, and the feeds whose last poll failed. */
export const Inbox = ({
  items,
  feeds,
  onPress,
}: {
  readonly items: readonly InboxItem[]
  readonly feeds: readonly FeedView[]
  readonly onPress: (press: InboxPress, item: InboxItem) => void
}) => (
  <div className="flex flex-col gap-3">
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
      <article
        key={`${item.feed}/${item.key}`}
        className="flex flex-col gap-1 rounded-lg bg-surface p-3"
        data-testid="inbox-item"
      >
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
          <span className="text-small text-muted" data-testid="inbox-message">
            {item.message}
          </span>
        )}
        {pressesOf(item).length > 0 && (
          <div className="flex gap-2 pt-1">
            {pressesOf(item).map(([press, label]) => (
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
        )}
      </article>
    ))}
  </div>
)
