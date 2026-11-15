import type { FeedItem, FeedMode } from "./feed.js"

export type ItemState = "proposed" | "queued" | "blocked" | "starting" | "started" | "failed"

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
  /** Why a failed item failed, or why a queued one waits. */
  readonly message?: string
}

/** How far gtd got with dispatching an item. */
export type Dispatch =
  /** A person pressed Start or Retry; `waits` says why it has not started yet. */
  | { readonly state: "approved"; readonly waits?: string }
  | { readonly state: "starting"; readonly worktree?: string }
  | { readonly state: "started"; readonly worktree: string }
  | { readonly state: "failed"; readonly message: string }

export interface Entry {
  readonly feed: string
  readonly project: string
  readonly mode: FeedMode
  readonly item: FeedItem
  /** The item's place in its feed's last poll result. */
  readonly order: number
  readonly firstSeen: number
  readonly dispatch?: Dispatch
}

export interface Inbox {
  /** Items by `<feed>/<key>`: the waiting ones, and those gtd dispatched. */
  readonly entries: ReadonlyMap<string, Entry>
  /** `<feed>/<key>` of every dismissed item its feed still returns. */
  readonly dismissed: ReadonlySet<string>
}

export interface FeedSource {
  readonly feed: string
  readonly project: string
  readonly mode: FeedMode
}

export const idOf = (feed: string, key: string): string => `${feed}/${key}`

export const emptyInbox = (
  dismissed: Iterable<string> = [],
  kept: Iterable<Entry> = [],
): Inbox => ({
  entries: new Map([...kept].map((entry) => [idOf(entry.feed, entry.item.key), entry])),
  dismissed: new Set(dismissed),
})

// A poll no longer returning these does not drop them: they left the waiting states.
const dispatched = (entry: Entry): boolean =>
  entry.dispatch !== undefined && entry.dispatch.state !== "approved"

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
    [...inbox.entries].filter(
      ([id, entry]) => !id.startsWith(prefix) || returned.has(id) || dispatched(entry),
    ),
  )
  const dismissed = new Set(
    [...inbox.dismissed].filter((id) => !id.startsWith(prefix) || returned.has(id)),
  )
  items.forEach((item, order) => {
    const id = idOf(source.feed, item.key)
    if (dismissed.has(id)) return
    const known = entries.get(id)
    // What a started or starting item's action got stays what the inbox shows.
    const state = known?.dispatch?.state
    if (state === "starting" || state === "started") return
    const firstSeen = known?.firstSeen ?? now
    const dispatch = known?.dispatch
    entries.set(id, { ...source, item, order, firstSeen, ...(dispatch ? { dispatch } : {}) })
  })
  return { entries, dismissed }
}

/** Hides a proposed or failed item until its feed stops returning it; `undefined` when there is none. */
export const dismiss = (inbox: Inbox, feed: string, key: string): Inbox | undefined => {
  const id = idOf(feed, key)
  const entry = inbox.entries.get(id)
  if (entry === undefined) return undefined
  const state = stateOf(entry, inbox)
  if (state !== "proposed" && state !== "failed") return undefined
  const entries = new Map(inbox.entries)
  entries.delete(id)
  return { entries, dismissed: new Set([...inbox.dismissed, id]) }
}

/** The inbox with the item's dispatch set, or the item gone when `dispatch` is `undefined`. */
export const setDispatch = (inbox: Inbox, id: string, dispatch: Dispatch | undefined): Inbox => {
  const entry = inbox.entries.get(id)
  if (entry === undefined) return inbox
  const entries = new Map(inbox.entries)
  if (dispatch === undefined) entries.delete(id)
  else entries.set(id, { ...entry, dispatch })
  return { entries, dismissed: inbox.dismissed }
}

const stateOf = (entry: Entry, inbox: Inbox): ItemState => {
  const dispatch = entry.dispatch?.state
  if (dispatch !== undefined && dispatch !== "approved") return dispatch
  if (entry.mode === "propose" && dispatch === undefined) return "proposed"
  // A bare key names an item of the same feed first.
  const waiting = (ref: string): boolean =>
    inbox.entries.has(idOf(entry.feed, ref)) || inbox.entries.has(ref)
  return (entry.item.blockedBy ?? []).some(waiting) ? "blocked" : "queued"
}

const messageOf = (dispatch: Dispatch | undefined): string | undefined =>
  dispatch?.state === "failed"
    ? dispatch.message
    : dispatch?.state === "approved"
      ? dispatch.waits
      : undefined

const view = (entry: Entry, inbox: Inbox): InboxItem => {
  const { key, title, url, action, priority, blockedBy, branch, data } = entry.item
  const message = messageOf(entry.dispatch)
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
    ...(message !== undefined ? { message } : {}),
  }
}

const startOrder = (inbox: Inbox): readonly Entry[] =>
  [...inbox.entries.values()].sort(
    (a, b) =>
      b.item.priority - a.item.priority ||
      a.order - b.order ||
      a.firstSeen - b.firstSeen ||
      idOf(a.feed, a.item.key).localeCompare(idOf(b.feed, b.item.key)),
  )

/** The items that have not started, in start order: priority, then poll order, then the time first seen. */
export const inboxItems = (inbox: Inbox): readonly InboxItem[] =>
  startOrder(inbox)
    .map((entry) => view(entry, inbox))
    .filter((item) => item.state !== "started")

/** The items a person started that may be dispatched now, in start order. */
export const approvedItems = (inbox: Inbox): readonly InboxItem[] =>
  startOrder(inbox)
    .filter((entry) => entry.dispatch?.state === "approved")
    .map((entry) => view(entry, inbox))
    .filter((item) => item.state === "queued")
