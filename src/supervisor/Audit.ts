import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs"
import { join } from "node:path"

/** One state change a person asked for. Field values never go in: they may hold anything. */
export interface AuditEntry {
  /** The tailnet login, or the peer address when the request carries none. */
  readonly identity: string
  /** The API procedure, for example `removeWorktree`. */
  readonly endpoint: string
  readonly project: string
  /** The worktree's branch, else its directory name. */
  readonly worktree: string
  readonly action?: string
}

export type Audit = (entry: AuditEntry) => void

// One rotated file is kept: the log answers "who did what lately", not forever.
const ROTATE_BYTES = 1024 * 1024

/** `audit.log` in the state directory: one JSON line per state change. */
export const auditLog =
  (stateDirectory: string, now: () => number): Audit =>
  (entry) => {
    const file = join(stateDirectory, "audit.log")
    mkdirSync(stateDirectory, { recursive: true, mode: 0o700 })
    try {
      if (statSync(file).size >= ROTATE_BYTES) renameSync(file, `${file}.1`)
    } catch {
      // No log yet.
    }
    const line = JSON.stringify({ time: new Date(now()).toISOString(), ...entry })
    appendFileSync(file, `${line}\n`, { mode: 0o600 })
  }
