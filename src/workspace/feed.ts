import { durationMs, type Duration } from "./config.js"

/** What a feed's poll returns for one piece of work. */
export interface FeedItem {
  /** Unique for the feed. */
  readonly key: string
  readonly title: string
  readonly url?: string
  /** The `start:*` action that begins the work. */
  readonly action: string
  /** A higher number starts first. */
  readonly priority: number
  /** Keys of items that must finish first; `<feed>/<key>` names another feed's item. */
  readonly blockedBy?: readonly string[]
  /** Start the work in the existing worktree of this branch. */
  readonly branch?: string
  /** Any JSON; gtd passes it on and never reads it. */
  readonly data?: unknown
}

export interface ExecResult {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

export interface FeedContext {
  /** Runs argv without a shell, in the project's main checkout unless `cwd` says otherwise. A non-zero exit does not throw. */
  readonly exec: (
    argv: readonly string[],
    options?: { readonly cwd?: string },
  ) => Promise<ExecResult>
  readonly fetch: typeof globalThis.fetch
  readonly log: (message: string) => void
}

export type FeedMode = "propose" | "queue"

export interface FeedSpec {
  /** The project id. */
  readonly project: string
  /** How often `poll` runs. */
  readonly every: Duration
  /** `propose`: a person starts or dismisses each item; `queue`: items start without one. */
  readonly mode: FeedMode
  /** Every item that matches now. */
  readonly poll: (ctx: FeedContext) => Promise<readonly FeedItem[]> | readonly FeedItem[]
  /** Return `false` to hold an item at dispatch. */
  readonly canStart?: (item: FeedItem, ctx: FeedContext) => Promise<boolean> | boolean
}

// A registered symbol: the config module may load its own copy of this file.
const FEED = Symbol.for("@pmelab/gtd/workspace/feed")

export type Feed = FeedSpec & { readonly [FEED]: true }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const isText = (v: unknown): v is string => typeof v === "string" && v !== ""

const SPEC_CHECKS: Readonly<Record<string, readonly [(v: unknown) => boolean, string, boolean]>> = {
  project: [isText, "must be a non-empty string", true],
  every: [
    (v) => typeof v === "string" && /^\d+(ms|s|m|h)$/.test(v) && durationMs(v as Duration) > 0,
    'must be a positive duration like "30s", "5m" or "1h"',
    true,
  ],
  mode: [(v) => v === "propose" || v === "queue", 'must be "propose" or "queue"', true],
  poll: [(v) => typeof v === "function", "must be a function", true],
  canStart: [(v) => typeof v === "function", "must be a function", false],
}

const checkFields = (
  value: Record<string, unknown>,
  checks: Readonly<Record<string, readonly [(v: unknown) => boolean, string, boolean]>>,
): string[] => [
  ...Object.keys(value)
    .filter((key) => !Object.hasOwn(checks, key))
    .map((key) => `${key}: is not a known key`),
  ...Object.entries(checks).flatMap(([key, [ok, message, required]]) =>
    value[key] === undefined
      ? required
        ? [`${key}: is required`]
        : []
      : ok(value[key])
        ? []
        : [`${key}: ${message}`],
  ),
]

/** A named `feed()` export of `gtd.workspace.ts` files items into the inbox. */
export const feed = (spec: FeedSpec): Feed => {
  const problems = isRecord(spec) ? checkFields(spec, SPEC_CHECKS) : ["must be an object"]
  if (problems.length > 0) throw new Error(problems.map((p) => `feed.${p}`).join("; "))
  return { ...spec, [FEED]: true }
}

export const isFeed = (value: unknown): value is Feed =>
  isRecord(value) && (value as Partial<Feed>)[FEED] === true

const ITEM_CHECKS: Readonly<Record<string, readonly [(v: unknown) => boolean, string, boolean]>> = {
  key: [isText, "must be a non-empty string", true],
  title: [isText, "must be a non-empty string", true],
  url: [(v) => typeof v === "string", "must be a string", false],
  action: [isText, "must be a non-empty string", true],
  priority: [(v) => typeof v === "number" && Number.isFinite(v), "must be a number", true],
  blockedBy: [(v) => Array.isArray(v) && v.every(isText), "must be an array of item keys", false],
  branch: [isText, "must be a non-empty string", false],
  data: [() => true, "", false],
}

/** Every way a poll result is not a list of items with unique keys. */
const pollProblems = (result: unknown): readonly string[] => {
  if (!Array.isArray(result)) return ["poll must return an array of items"]
  const seen = new Set<string>()
  return result.flatMap((item: unknown, index) => {
    if (!isRecord(item)) return [`item ${index}: must be an object`]
    const problems = checkFields(item, ITEM_CHECKS).map((p) => `item ${index}: ${p}`)
    if (typeof item["key"] === "string") {
      if (seen.has(item["key"]))
        problems.push(`item ${index}: key: "${item["key"]}" is returned twice`)
      seen.add(item["key"])
    }
    return problems
  })
}

export type PollOutcome = { readonly items: readonly FeedItem[] } | { readonly failure: string }

/** One poll: its items, or why the feed fails (`feedFailing`) — a throw or a malformed result. */
export const runPoll = async (feed: FeedSpec, ctx: FeedContext): Promise<PollOutcome> => {
  let result: unknown
  try {
    result = await feed.poll(ctx)
  } catch (error) {
    return { failure: error instanceof Error ? error.message : String(error) }
  }
  const problems = pollProblems(result)
  return problems.length > 0
    ? { failure: problems.join("; ") }
    : { items: result as readonly FeedItem[] }
}
