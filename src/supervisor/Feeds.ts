import {
  durationMs,
  type ExecResult,
  type Feed,
  type FeedContext,
  type FeedMode,
  type InboxItem,
  type WorktreesAdapter,
} from "../workspace/index.js"
import {
  applyPoll,
  dismiss,
  emptyInbox,
  idOf,
  inboxItems,
  runPoll,
  type Entry,
  type Inbox,
} from "../workspace/internal.js"
import type { Store } from "./Store.js"

export interface FeedView {
  readonly feed: string
  readonly project: string
  readonly mode: FeedMode
  readonly every: string
  /** Why the last poll failed (`feedFailing`); absent once a poll succeeds. */
  readonly failing?: string
}

export interface FeedRunner {
  readonly items: () => readonly InboxItem[]
  readonly feeds: () => readonly FeedView[]
  /** `false` when no such item is proposed. */
  readonly dismiss: (feed: string, key: string) => boolean
  /** Polls each feed now, then once per its `every`. */
  readonly start: () => void
  readonly stop: () => void
  /** Polls these feeds from now on, each at once, keeping the inbox. */
  readonly replace: (feeds: ReadonlyMap<string, Feed>) => void
  readonly inbox: () => Inbox
  /** Changes the inbox; what a person decided is saved. */
  readonly change: (next: (inbox: Inbox) => Inbox) => void
  /** Why the item's feed holds it (its `canStart`, or the feed is gone); `undefined` when it may start. */
  readonly canStart: (item: InboxItem) => Promise<string | undefined>
  /** Every feed has polled once since it was added: a blocker of another feed is in the inbox. */
  readonly ready: () => boolean
}

export interface FeedDeps {
  readonly feeds: ReadonlyMap<string, Feed>
  readonly root: string
  readonly worktrees: WorktreesAdapter
  readonly exec: (argv: readonly string[], cwd: string) => Promise<ExecResult>
  readonly fetch: typeof globalThis.fetch
  readonly now: () => number
  readonly every: (ms: number, task: () => Promise<void>) => () => void
  readonly store: Store
  readonly log: (line: string) => void
  /** Drops the items that ended, before a poll applies, so the poll can file their keys anew. */
  readonly ended?: (inbox: Inbox) => Inbox
  /** Runs after each successful poll; the poll ends when it returns. */
  readonly polled?: () => Promise<void>
  /** Runs after each poll, also one that failed. */
  readonly afterPoll?: (feed: string) => void
}

const keptJson = (inbox: Inbox): string =>
  JSON.stringify([...inbox.entries.values()].filter((entry) => entry.dispatch !== undefined))

/** Polls every feed on its own schedule and keeps the inbox from the results. */
export const feedRunner = (deps: FeedDeps): FeedRunner => {
  let inbox: Inbox = emptyInbox(deps.store.dismissed(), deps.store.items())
  let saved = keptJson(inbox)
  let feeds = deps.feeds
  const failing = new Map<string, string>()
  // By feed, not name: a reload's new feed polls while the old one's poll runs out.
  const polling = new Set<Feed>()
  const polled = new Set<string>()

  const setInbox = (next: Inbox): void => {
    const changed =
      next.dismissed.size !== inbox.dismissed.size ||
      [...next.dismissed].some((id) => !inbox.dismissed.has(id))
    inbox = next
    if (changed) deps.store.saveDismissed(inbox.dismissed)
    const kept = keptJson(inbox)
    if (kept !== saved) deps.store.saveItems(JSON.parse(kept) as Entry[])
    saved = kept
  }

  // The project's main checkout, where a feed's commands run by default.
  const projectPath = async (project: string): Promise<string> => {
    try {
      return (await deps.worktrees.projects()).find((p) => p.id === project)?.path ?? deps.root
    } catch {
      return deps.root
    }
  }

  const contextOf = async (name: string, feed: Feed): Promise<FeedContext> => {
    const cwd = await projectPath(feed.project)
    return {
      exec: (argv, options) => deps.exec(argv, options?.cwd ?? cwd),
      fetch: deps.fetch,
      log: (message) => deps.log(`feed ${name}: ${message}\n`),
    }
  }

  const poll = async (name: string, feed: Feed): Promise<void> => {
    // A slow poll is not stacked on itself.
    if (polling.has(feed)) return
    polling.add(feed)
    try {
      const outcome = await runPoll(feed, await contextOf(name, feed))
      // A reload changed or removed the feed meanwhile: its result is stale.
      if (feeds.get(name) !== feed) return
      polled.add(name)
      if ("failure" in outcome) {
        if (failing.get(name) !== outcome.failure)
          deps.log(`feed ${name} failing: ${outcome.failure}\n`)
        failing.set(name, outcome.failure)
        return
      }
      const source = { feed: name, project: feed.project, mode: feed.mode }
      setInbox(applyPoll(deps.ended?.(inbox) ?? inbox, source, outcome.items, deps.now()))
      failing.delete(name)
      await deps.polled?.()
    } finally {
      if (feeds.get(name) === feed) deps.afterPoll?.(name)
      polling.delete(feed)
    }
  }

  let cancels: (() => void)[] | undefined
  const start = (): void => {
    cancels = [...feeds].map(([name, feed]) =>
      deps.every(durationMs(feed.every), () => poll(name, feed)),
    )
  }
  const stop = (): void => {
    for (const cancel of cancels ?? []) cancel()
    cancels = undefined
  }

  return {
    items: () => inboxItems(inbox),
    feeds: () =>
      [...feeds].map(([name, feed]) => {
        const failure = failing.get(name)
        return {
          feed: name,
          project: feed.project,
          mode: feed.mode,
          every: feed.every,
          ...(failure !== undefined ? { failing: failure } : {}),
        }
      }),
    dismiss: (feed, key) => {
      const next = dismiss(inbox, feed, key)
      if (next === undefined) return false
      setInbox(next)
      return true
    },
    start,
    stop,
    inbox: () => inbox,
    change: (next) => setInbox(next(inbox)),
    canStart: async (item) => {
      const feed = feeds.get(item.feed)
      if (feed === undefined) return `its feed ${item.feed} is not in the config`
      const filed = inbox.entries.get(idOf(item.feed, item.key))?.item
      if (feed.canStart === undefined || filed === undefined) return undefined
      try {
        if (await feed.canStart(filed, await contextOf(item.feed, feed))) return undefined
        return "its feed's canStart holds it"
      } catch (error) {
        return `its feed's canStart failed: ${error instanceof Error ? error.message : String(error)}`
      }
    },
    ready: () => [...feeds.keys()].every((name) => polled.has(name)),
    replace: (next) => {
      const started = cancels !== undefined
      stop()
      feeds = next
      for (const name of failing.keys()) if (!feeds.has(name)) failing.delete(name)
      if (started) start()
    },
  }
}
