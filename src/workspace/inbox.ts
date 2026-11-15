import type { FeedItem, FeedMode } from "./feed.js"

export type ItemState = "proposed" | "queued" | "blocked"

/** An item as the inbox shows it: the feed's fields, plus `feed`, `project` and where it stands. */
export interface InboxItem {
  readonly feed: string
  readonly project: string
  readonly key: string
  readonly title: string
  readonly url?: string
  readonly action: string
  readonly priority: number
  readonly blockedBy: readonly string[]
  readonly branch?: string
  readonly data: unknown
  readonly state: ItemState
  /** When gtd first saw the key, as an ISO date. */
  readonly firstSeen: string
}

interface Entry {
  readonly feed: string
  readonly project: string
  readonly mode: FeedMode
  readonly item: FeedItem
  /** The item's place in its feed's last poll result. */
  readonly order: number
  readonly firstSeen: number
}

export interface Inbox {
  /** Waiting items by `<feed>/<key>`. */
  readonly entries: ReadonlyMap<string, Entry>
  /** `<feed>/<key>` of every dismissed item its feed still returns. */
  readonly dismissed: ReadonlySet<string>
}

export interface FeedSource {
  readonly feed: string
  readonly project: string
  readonly mode: FeedMode
}

const idOf = (feed: string, key: string): string => `${feed}/${key}`

export const emptyInbox = (dismissed: Iterable<string> = []): Inbox => ({
  entries: new Map(),
  dismissed: new Set(dismissed),
})

/**
 * The inbox after one successful poll of `source`: new keys are added, known
 * ones updated, and the feed's waiting items it no longer returns dropped. A
 * dismissal lasts while the feed keeps returning its key.
 */
export const applyPoll = (
  inbox: Inbox,
  source: FeedSource,
  items: readonly FeedItem[],
  now: number,
): Inbox => {
  const returned = new Set(items.map((item) => idOf(source.feed, item.key)))
  const prefix = idOf(source.feed, "")
  const entries = new Map(
    [...inbox.entries].filter(([id]) => !id.startsWith(prefix) || returned.has(id)),
  )
  const dismissed = new Set(
    [...inbox.dismissed].filter((id) => !id.startsWith(prefix) || returned.has(id)),
  )
  items.forEach((item, order) => {
    const id = idOf(source.feed, item.key)
    if (dismissed.has(id)) return
    const firstSeen = entries.get(id)?.firstSeen ?? now
    entries.set(id, { ...source, item, order, firstSeen })
  })
  return { entries, dismissed }
}

/** Hides a proposed item until its feed stops returning it; `undefined` when no such item is proposed. */
export const dismiss = (inbox: Inbox, feed: string, key: string): Inbox | undefined => {
  const id = idOf(feed, key)
  if (inbox.entries.get(id)?.mode !== "propose") return undefined
  const entries = new Map(inbox.entries)
  entries.delete(id)
  return { entries, dismissed: new Set([...inbox.dismissed, id]) }
}

const stateOf = (entry: Entry, inbox: Inbox): ItemState => {
  if (entry.mode === "propose") return "proposed"
  // A bare key names an item of the same feed first.
  const waiting = (ref: string): boolean =>
    inbox.entries.has(idOf(entry.feed, ref)) || inbox.entries.has(ref)
  return (entry.item.blockedBy ?? []).some(waiting) ? "blocked" : "queued"
}

const view = (entry: Entry, inbox: Inbox): InboxItem => {
  const { key, title, url, action, priority, blockedBy, branch, data } = entry.item
  return {
    feed: entry.feed,
    project: entry.project,
    key,
    title,
    ...(url !== undefined ? { url } : {}),
    action,
    priority,
    blockedBy: blockedBy ?? [],
    ...(branch !== undefined ? { branch } : {}),
    data: data ?? null,
    state: stateOf(entry, inbox),
    firstSeen: new Date(entry.firstSeen).toISOString(),
  }
}

/** The waiting items in start order: priority, then poll order, then the time first seen. */
export const inboxItems = (inbox: Inbox): readonly InboxItem[] =>
  [...inbox.entries.values()]
    .sort(
      (a, b) =>
        b.item.priority - a.item.priority ||
        a.order - b.order ||
        a.firstSeen - b.firstSeen ||
        idOf(a.feed, a.item.key).localeCompare(idOf(b.feed, b.item.key)),
    )
    .map((entry) => view(entry, inbox))
