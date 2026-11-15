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
}

/** Polls every feed on its own schedule and keeps the inbox from the results. */
export const feedRunner = (deps: FeedDeps): FeedRunner => {
  let inbox: Inbox = emptyInbox(deps.store.dismissed())
  const failing = new Map<string, string>()
  const polling = new Set<string>()

  const setInbox = (next: Inbox): void => {
    const changed =
      next.dismissed.size !== inbox.dismissed.size ||
      [...next.dismissed].some((id) => !inbox.dismissed.has(id))
    inbox = next
    if (changed) deps.store.saveDismissed(inbox.dismissed)
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
      setInbox(applyPoll(inbox, source, outcome.items, deps.now()))
      failing.delete(name)
    } finally {
      polling.delete(name)
    }
  }

  let cancels: (() => void)[] = []

  return {
    items: () => inboxItems(inbox),
    feeds: () =>
      [...deps.feeds].map(([name, feed]) => {
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
    start: () => {
      cancels = [...deps.feeds].map(([name, feed]) =>
        deps.every(durationMs(feed.every), () => poll(name, feed)),
      )
    },
    stop: () => {
      for (const cancel of cancels.splice(0)) cancel()
    },
  }
}
