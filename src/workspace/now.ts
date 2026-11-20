/** What the Now view needs of a worktree: shared by the dashboard and the terminal. */
export interface NowWorktree {
  readonly status: "needsYou" | "working" | "error" | "idle"
  readonly kind?: string | undefined
  readonly errorKind?: string | undefined
  readonly label?: string | undefined
  readonly message?: string | undefined
  readonly branch?: string | undefined
  readonly path: string
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
} => {
  const all = projects.flatMap((project) =>
    project.worktrees.map((worktree) => ({ project, worktree })),
  )
  return {
    attention: all.filter(
      ({ worktree }) => worktree.status === "needsYou" || worktree.status === "error",
    ),
    working: all.filter(({ worktree }) => worktree.status === "working"),
  }
}

export const worktreeName = (w: NowWorktree): string =>
  w.branch ?? w.path.split("/").at(-1) ?? w.path

const STATUS_TEXT: Readonly<Record<NowWorktree["status"], string>> = {
  needsYou: "needs you",
  working: "working",
  error: "error",
  idle: "idle",
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
