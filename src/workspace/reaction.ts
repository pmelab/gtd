import type { ActionValues, NotificationPriority } from "./adapters.js"
import type { ExecResult } from "./feed.js"

export type ReactionStatus = "needsYou" | "working" | "error" | "idle"

export type ReactionErrorKind = "stalled" | "crashed" | "driver" | "note"

/** A worktree status change, as a reaction gets it. */
export interface WorktreeChange {
  /** The project id. */
  readonly project: string
  /** The worktree's path. */
  readonly worktree: string
  readonly branch?: string
  /** The status before; absent for a worktree gtd had not seen. */
  readonly from?: ReactionStatus
  /** `cleaned` when auto-clean removed the worktree. */
  readonly to: ReactionStatus | "cleaned"
  readonly errorKind?: ReactionErrorKind
  /** What the driver waits for when it needs you: `permission`, `question`, `auth`. */
  readonly kind?: string
  readonly label: string
  readonly message?: string
  /** The worktree's HEAD commit at the change. */
  readonly commit: string
  /** The change happened while no supervisor ran, and was found at startup. */
  readonly atStartup: boolean
}

type OneOrMore<T> = T | readonly T[]

/** Each key given must match; an array matches any of its values. */
export interface ReactionFilter {
  readonly project?: OneOrMore<string>
  readonly from?: OneOrMore<ReactionStatus>
  readonly to?: OneOrMore<ReactionStatus | "cleaned">
  readonly errorKind?: OneOrMore<ReactionErrorKind>
  readonly kind?: OneOrMore<string>
}

/** How gtd answered a reaction's action, Proceed or Retry, as it answers a person. */
export type ReactionOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }

export interface ReactionNotification {
  readonly title: string
  readonly body?: string
  readonly priority?: NotificationPriority
}

export interface ReactionContext {
  /** Runs the worktree's action in a pane of its own, as the action picker does. */
  readonly action: (id: string, values?: ActionValues) => Promise<ReactionOutcome>
  /** Proceed from the rest at `commit`, as the dashboard does. */
  readonly proceed: (commit: string) => Promise<ReactionOutcome>
  /** Retry the rest at `commit`, as the dashboard does. */
  readonly retry: (commit: string) => Promise<ReactionOutcome>
  /** Sends a notification that links to the worktree's detail. */
  readonly notify: (notification: ReactionNotification) => Promise<void>
  /** Runs argv without a shell, in the worktree unless `cwd` says otherwise. A non-zero exit does not throw. */
  readonly exec: (
    argv: readonly string[],
    options?: { readonly cwd?: string },
  ) => Promise<ExecResult>
  readonly fetch: typeof globalThis.fetch
  readonly log: (message: string) => void
}

export interface ReactionSpec {
  readonly on: ReactionFilter
  readonly run: (change: WorktreeChange, ctx: ReactionContext) => Promise<void> | void
}

// A registered symbol: the config module may load its own copy of this file.
const REACTION = Symbol.for("@pmelab/gtd/workspace/reaction")

export type Reaction = ReactionSpec & { readonly [REACTION]: true }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const STATUSES = ["needsYou", "working", "error", "idle"]

// The values each filter key allows; `undefined` = any non-empty string.
const FILTER_VALUES: Readonly<Record<keyof ReactionFilter, readonly string[] | undefined>> = {
  project: undefined,
  from: STATUSES,
  to: [...STATUSES, "cleaned"],
  errorKind: ["stalled", "crashed", "driver", "note"],
  kind: undefined,
}

const filterProblems = (on: unknown): string[] => {
  if (!isRecord(on)) return ["on: must be an object"]
  return Object.entries(on).flatMap(([key, value]) => {
    if (!Object.hasOwn(FILTER_VALUES, key)) return [`on.${key}: is not a known key`]
    const allowed = FILTER_VALUES[key as keyof ReactionFilter]
    const valid = (v: unknown): boolean =>
      typeof v === "string" && v !== "" && (allowed === undefined || allowed.includes(v))
    const ok = Array.isArray(value) ? value.length > 0 && value.every(valid) : valid(value)
    if (ok) return []
    const what = allowed === undefined ? "a non-empty string" : `one of ${allowed.join(", ")}`
    return [`on.${key}: must be ${what}, or an array of them`]
  })
}

const specProblems = (spec: unknown): string[] => {
  if (!isRecord(spec)) return ["must be an object"]
  return [
    ...Object.keys(spec)
      .filter((key) => key !== "on" && key !== "run")
      .map((key) => `${key}: is not a known key`),
    ...(spec["on"] === undefined ? ["on: is required"] : filterProblems(spec["on"])),
    ...(typeof spec["run"] === "function" ? [] : ["run: must be a function"]),
  ]
}

/** A named `reaction()` export of `gtd.workspace.ts` runs on each matching worktree status change. */
export const reaction = (spec: ReactionSpec): Reaction => {
  const problems = specProblems(spec)
  if (problems.length > 0) throw new Error(problems.map((p) => `reaction.${p}`).join("; "))
  return { ...spec, [REACTION]: true }
}

export const isReaction = (value: unknown): value is Reaction =>
  isRecord(value) && (value as Partial<Reaction>)[REACTION] === true

const allows = (wanted: OneOrMore<string> | undefined, value: string | undefined): boolean =>
  wanted === undefined ||
  (value !== undefined && (typeof wanted === "string" ? wanted === value : wanted.includes(value)))

export const matches = (on: ReactionFilter, change: WorktreeChange): boolean =>
  allows(on.project, change.project) &&
  allows(on.from, change.from) &&
  allows(on.to, change.to) &&
  allows(on.errorKind, change.errorKind) &&
  allows(on.kind, change.kind)

/** Runs the reaction when the change matches: whether it ran, and why it failed when it threw. */
export const runReaction = async (
  reaction: ReactionSpec,
  change: WorktreeChange,
  ctx: ReactionContext,
): Promise<{ readonly ran: boolean; readonly failure?: string }> => {
  if (!matches(reaction.on, change)) return { ran: false }
  try {
    await reaction.run(change, ctx)
    return { ran: true }
  } catch (error) {
    return { ran: true, failure: error instanceof Error ? error.message : String(error) }
  }
}
