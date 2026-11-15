import type { SpawnOutcome } from "../ui/index.js"

export type StatusName = "needsYou" | "working" | "error" | "idle"

/** Why a worktree is in error. */
export type ErrorKind = "stalled"

export interface WorktreeStatus {
  readonly status: StatusName
  /** The rest's label, or what went wrong. */
  readonly label: string
  readonly errorKind?: ErrorKind
  readonly message?: string
}

interface NextFields {
  readonly kind?: unknown
  readonly idle?: unknown
  readonly actor?: unknown
  readonly label?: unknown
  readonly state?: unknown
  readonly content?: unknown
}

// An allowlist: any other actor (a person, a judge, one a workflow invents)
// waits for someone the driver cannot stand in for.
const DRIVEN_ACTORS: ReadonlySet<unknown> = new Set(["agent", "check"])

const failed = (message: string): WorktreeStatus => ({
  status: "error",
  label: "gtd next failed",
  message,
})

const firstLine = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim().split("\n")[0] : undefined

/** The worktree status `gtd next --json`, run in the worktree, gives. */
export const worktreeStatus = (outcome: SpawnOutcome): WorktreeStatus => {
  if (outcome.spawnError !== undefined) return failed(outcome.spawnError)
  if (outcome.status !== 0) return failed(outcome.stderr.trim())
  let fields: NextFields
  try {
    fields = JSON.parse(outcome.stdout) as NextFields
  } catch {
    return failed(`no JSON: ${outcome.stdout.trim()}`)
  }
  const label =
    typeof fields.label === "string"
      ? fields.label
      : typeof fields.state === "string"
        ? fields.state
        : ""
  if (fields.kind === "stalled") {
    const message = firstLine(fields.content)
    return { status: "error", errorKind: "stalled", label, ...(message ? { message } : {}) }
  }
  if (fields.idle === true) return { status: "idle", label }
  if (DRIVEN_ACTORS.has(fields.actor)) return { status: "working", label }
  return { status: "needsYou", label }
}
