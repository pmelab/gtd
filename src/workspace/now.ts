/** What the Now view needs of a worktree: shared by the dashboard and the terminal. */
export interface NowWorktree {
  readonly status: "needsYou" | "working" | "error" | "idle" | "waiting"
  readonly kind?: string | undefined
  readonly errorKind?: string | undefined
  readonly label?: string | undefined
  readonly message?: string | undefined
  readonly branch?: string | undefined
  readonly description?: string | undefined
  readonly path: string
  readonly signal?: { readonly kinds: readonly string[]; readonly timeout?: string } | undefined
  /** When the wait began, in ms since the epoch. */
  readonly waitingSince?: number | undefined
}

export interface NowProject<W extends NowWorktree = NowWorktree> {
  readonly worktrees: readonly W[]
}

export interface NowEntry<P extends NowProject<NowWorktree>> {
  readonly project: P
  readonly worktree: P["worktrees"][number]
}

export const nowView = <P extends NowProject<NowWorktree>>(
  projects: readonly P[],
): {
  readonly attention: readonly NowEntry<P>[]
  readonly working: readonly NowEntry<P>[]
  readonly waiting: readonly NowEntry<P>[]
} => {
  const all = projects.flatMap((project) =>
    project.worktrees.map((worktree) => ({ project, worktree })),
  )
  return {
    attention: all.filter(
      ({ worktree }) => worktree.status === "needsYou" || worktree.status === "error",
    ),
    working: all.filter(({ worktree }) => worktree.status === "working"),
    waiting: all.filter(({ worktree }) => worktree.status === "waiting"),
  }
}

export const worktreeName = (w: NowWorktree): string =>
  w.branch ?? w.path.split("/").at(-1) ?? w.path

/** Line 1 of the description, else the branch or directory name. */
export const worktreeTitle = (w: NowWorktree): string =>
  w.description?.split("\n")[0]?.trim() || worktreeName(w)

/** Line 2 of the description, when there is one. */
export const worktreeSubtitle = (w: NowWorktree): string =>
  w.description?.split("\n")[1]?.trim() ?? ""

const STATUS_TEXT: Readonly<Record<NowWorktree["status"], string>> = {
  needsYou: "needs you",
  working: "working",
  error: "error",
  idle: "idle",
  waiting: "waiting",
}

/** The status in words: `needs you (question)`, `error (crashed)`. */
export const statusText = (w: NowWorktree): string => {
  const kind = w.errorKind ?? w.kind
  return kind === undefined ? STATUS_TEXT[w.status] : `${STATUS_TEXT[w.status]} (${kind})`
}

/** What the worktree waits for, and why: its label, then its message. */
export const detailText = (w: NowWorktree): string =>
  [w.label, w.message].filter((s) => s !== undefined && s !== "").join(" — ")

/** The detail, unless it only repeats the status ("Idle" beside "idle"): empty then. */
export const reasonText = (w: NowWorktree): string => {
  const detail = detailText(w)
  return detail.toLowerCase() === statusText(w) ? "" : detail
}

/** The branch shown beside the title, when the title is not the branch. */
export const worktreeBranch = (w: NowWorktree): string | undefined =>
  w.description?.split("\n")[0]?.trim() ? w.branch : undefined

const DURATION_UNITS: readonly (readonly [string, number])[] = [
  ["d", 86_400_000],
  ["h", 3_600_000],
  ["m", 60_000],
]

/** Whole days, hours and minutes: `1h 30m`; `<1m` below a minute. */
const duration = (ms: number): string => {
  let rest = Math.max(ms, 0)
  const parts: string[] = []
  for (const [unit, size] of DURATION_UNITS) {
    const n = Math.floor(rest / size)
    rest -= n * size
    if (n > 0) parts.push(`${n}${unit}`)
  }
  return parts.slice(0, 2).join(" ") || "<1m"
}

const TIMEOUT_UNITS: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

/** What a waiting worktree waits for: label, accepted kinds, time waited, time to timeout. */
export const waitingText = (w: NowWorktree, now: number): string => {
  const parts = [w.label ?? "", w.signal?.kinds.join(", ") ?? ""]
  if (w.waitingSince !== undefined) {
    parts.push(`waiting ${duration(now - w.waitingSince)}`)
    const match = /^(\d+)(ms|s|m|h|d)$/.exec(w.signal?.timeout ?? "")
    if (match !== null) {
      const left = w.waitingSince + Number(match[1]) * TIMEOUT_UNITS[match[2]!]! - now
      parts.push(left > 0 ? `times out in ${duration(left)}` : "timed out")
    }
  }
  return parts.filter((s) => s !== "").join(" — ")
}
