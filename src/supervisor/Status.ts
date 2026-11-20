import type { SpawnOutcome } from "../ui/index.js"
import type { PaneStatus } from "../workspace/index.js"

export type StatusName = "needsYou" | "working" | "error" | "idle"

/** Why a worktree is in error. */
export type ErrorKind = "stalled" | "crashed" | "driver" | "note"

export interface WorktreeStatus {
  readonly status: StatusName
  /** The rest's label, or what went wrong. */
  readonly label: string
  readonly errorKind?: ErrorKind
  /** What the driver waits for when it needs you: `permission`, `question`, `auth`. */
  readonly kind?: string
  readonly message?: string
  /** The rest names a steering file, so its gate page has its own Proceed. */
  readonly gated?: boolean | undefined
  /** The process rests on a person: the gate page has something to act on. */
  readonly humanRest?: boolean
}

/** What gtd knows of a worktree's driver pane. */
export type DriverState =
  /** gtd started no driver here, or its pane is gone. */
  | { readonly kind: "none" }
  /** The terminal adapter could not tell. */
  | { readonly kind: "unknown" }
  | { readonly kind: "pane"; readonly pane: PaneStatus }

interface NextFields {
  readonly kind?: unknown
  readonly idle?: unknown
  readonly actor?: unknown
  readonly file?: unknown
  readonly label?: unknown
  readonly state?: unknown
  readonly content?: unknown
}

type Next =
  | { readonly ok: false; readonly status: WorktreeStatus }
  | ({ readonly ok: true } & NextFields)

// An allowlist: any other actor (a person, a judge, one a workflow invents)
// waits for someone the driver cannot stand in for.
const DRIVEN_ACTORS: ReadonlySet<unknown> = new Set(["agent", "check"])

const failed = (message: string): Next => ({
  ok: false,
  status: { status: "error", label: "gtd next failed", message },
})

const firstLine = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim().split("\n")[0] : undefined

const parseNext = (outcome: SpawnOutcome): Next => {
  if (outcome.spawnError !== undefined) return failed(outcome.spawnError)
  if (outcome.status !== 0) return failed(outcome.stderr.trim())
  try {
    return { ok: true, ...(JSON.parse(outcome.stdout) as NextFields) }
  } catch {
    return failed(`no JSON: ${outcome.stdout.trim()}`)
  }
}

// Exit 0 while the process is mid-flow, 130 (SIGINT) and 143 (SIGTERM) are a
// person quitting; done (exit 0 once the process ended) shows as idle first.
const QUIT_CODES: ReadonlySet<number> = new Set([0, 130, 143])

const crashed = (driver: DriverState): number | undefined =>
  driver.kind === "pane" && driver.pane.exit !== null && !QUIT_CODES.has(driver.pane.exit.code)
    ? driver.pane.exit.code
    : undefined

/** The driver's pane runs, or the terminal could not tell. */
export const driverRuns = (driver: DriverState): boolean =>
  driver.kind === "unknown" || (driver.kind === "pane" && driver.pane.alive)

/**
 * The worktree status from `gtd next --json`, run in the worktree, and the
 * root OSC 7501 record and exit of its driver's pane.
 */
export const worktreeStatus = (outcome: SpawnOutcome, driver: DriverState): WorktreeStatus => {
  const next = parseNext(outcome)
  if (!next.ok) return next.status
  const status = restStatus(next, driver)
  return next.actor === "human" && typeof next.file === "string"
    ? { ...status, gated: true }
    : status
}

// fallow-ignore-next-line complexity
const restStatus = (next: NextFields, driver: DriverState): WorktreeStatus => {
  const label =
    typeof next.label === "string" ? next.label : typeof next.state === "string" ? next.state : ""
  if (next.kind === "stalled") {
    const message = firstLine(next.content)
    return { status: "error", errorKind: "stalled", label, ...(message ? { message } : {}) }
  }
  if (next.idle === true) return { status: "idle", label }
  const record = driver.kind === "pane" ? driver.pane.record : undefined
  const code = crashed(driver)
  if (code !== undefined) {
    const message =
      record?.state === "error" && record.msg ? record.msg : `the driver exited with ${code}`
    return { status: "error", errorKind: "crashed", label, message }
  }
  if (record?.state === "error") {
    return {
      status: "error",
      errorKind: "driver",
      label,
      ...(record.msg ? { message: record.msg } : {}),
    }
  }
  // A pane that ended may still hold its last working/blocked record.
  const live = driverRuns(driver)
  if (live && record?.state === "working")
    return { status: "working", label: record.title ?? label }
  if (live && record?.state === "blocked") {
    return {
      status: "needsYou",
      label: record.title ?? label,
      ...(record.kind ? { kind: record.kind } : {}),
      ...(DRIVEN_ACTORS.has(next.actor) ? {} : { humanRest: true }),
    }
  }
  if (!DRIVEN_ACTORS.has(next.actor)) return { status: "needsYou", label, humanRest: true }
  if (live) return { status: "working", label }
  return { status: "needsYou", label, message: "no driver runs" }
}

/**
 * A worktree whose process waits for an agent or a check while no driver
 * runs. A driver that crashed is not an orphan: it waits for Retry.
 */
export const isOrphan = (outcome: SpawnOutcome, driver: DriverState): boolean => {
  const next = parseNext(outcome)
  return (
    next.ok &&
    next.kind !== "stalled" &&
    next.idle !== true &&
    DRIVEN_ACTORS.has(next.actor) &&
    !driverRuns(driver) &&
    crashed(driver) === undefined
  )
}

/** The worktree has no process mid-flow: `gtd next` answered, and with `idle`. */
export const processEnded = (outcome: SpawnOutcome): boolean => {
  const next = parseNext(outcome)
  return next.ok && next.idle === true
}
