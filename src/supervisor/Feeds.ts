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
}

// An item the last supervisor left starting never reports how its start ended.
const restored = (entry: Entry): Entry =>
  entry.dispatch?.state === "starting"
    ? { ...entry, dispatch: { state: "failed", message: "gtd stopped while the item started" } }
    : entry

const keptJson = (inbox: Inbox): string =>
  JSON.stringify([...inbox.entries.values()].filter((entry) => entry.dispatch !== undefined))

/** Polls every feed on its own schedule and keeps the inbox from the results. */
export const feedRunner = (deps: FeedDeps): FeedRunner => {
  let inbox: Inbox = emptyInbox(deps.store.dismissed(), deps.store.items().map(restored))
  let saved = keptJson(inbox)
  let feeds = deps.feeds
  const failing = new Map<string, string>()
  const polling = new Set<string>()

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

  const poll = async (name: string, feed: Feed): Promise<void> => {
    // A slow poll is not stacked on itself.
    if (polling.has(name)) return
    polling.add(name)
    try {
      const cwd = await projectPath(feed.project)
      const ctx: FeedContext = {
        exec: (argv, options) => deps.exec(argv, options?.cwd ?? cwd),
        fetch: deps.fetch,
        log: (message) => deps.log(`feed ${name}: ${message}\n`),
      }
      const outcome = await runPoll(feed, ctx)
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
      polling.delete(name)
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
    replace: (next) => {
      const started = cancels !== undefined
      stop()
      feeds = next
      for (const name of failing.keys()) if (!feeds.has(name)) failing.delete(name)
      if (started) start()
    },
  }
}
