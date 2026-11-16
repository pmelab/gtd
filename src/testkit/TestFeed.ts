import type { ExecResult, Feed, FeedContext, FeedItem, InboxItem } from "../workspace/index.js"
import { applyPoll, dismiss, emptyInbox, inboxItems, runPoll } from "../workspace/internal.js"

export interface TestFeedOptions {
  /** Answers `ctx.exec`; without it, any exec fails the poll. */
  readonly exec?: (
    argv: readonly string[],
    options?: { readonly cwd?: string },
  ) => ExecResult | Promise<ExecResult>
  /** Answers `ctx.fetch`; without it, any fetch fails the poll. */
  readonly fetch?: typeof globalThis.fetch
  /** The time of each poll, which an item's `firstSeen` records. Default: the epoch. */
  readonly clock?: () => Date
  /** The feed's export name, which each item carries as `feed`. Default: `"feed"`. */
  readonly name?: string
}

export interface FeedPollResult {
  /** The inbox after this poll, in start order. */
  readonly items: readonly InboxItem[]
  /** Why the poll failed; the inbox then stays as it was. */
  readonly failure?: string
  /** What the poll passed to `ctx.log`. */
  readonly logs: readonly string[]
}

export interface TestFeed {
  /** Polls once and applies the result to the inbox, as the supervisor does. */
  readonly poll: () => Promise<FeedPollResult>
  /** Dismisses a proposed item, as the dashboard does. */
  readonly dismiss: (key: string) => void
  /** The feed's `canStart`; `true` when it has none. */
  readonly canStart: (item: FeedItem) => Promise<boolean>
}

const urlOf = (input: string | URL | Request): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url

/** Runs a feed against scripted `exec`, `fetch` and clock, and an inbox of its own. */
export const testFeed = (feed: Feed, options: TestFeedOptions = {}): TestFeed => {
  const name = options.name ?? "feed"
  const clock = options.clock ?? (() => new Date(0))
  let inbox = emptyInbox()
  let logs: string[] = []
  const ctx: FeedContext = {
    exec: async (argv, execOptions) => {
      if (options.exec === undefined)
        throw new Error(`testFeed: no exec given for ${argv.join(" ")}`)
      return options.exec(argv, execOptions)
    },
    fetch: async (input, init) => {
      if (options.fetch === undefined)
        throw new Error(`testFeed: no fetch given for ${urlOf(input)}`)
      return options.fetch(input, init)
    },
    log: (message) => void logs.push(message),
  }
  return {
    poll: async () => {
      logs = []
      const outcome = await runPoll(feed, ctx)
      if ("failure" in outcome) return { items: inboxItems(inbox), failure: outcome.failure, logs }
      const source = { feed: name, project: feed.project, mode: feed.mode }
      inbox = applyPoll(inbox, source, outcome.items, clock().getTime())
      return { items: inboxItems(inbox), logs }
    },
    dismiss: (key) => {
      const next = dismiss(inbox, name, key)
      if (next === undefined) throw new Error(`testFeed: no proposed item ${key}`)
      inbox = next
    },
    canStart: async (item) => (feed.canStart === undefined ? true : feed.canStart(item, ctx)),
  }
}
