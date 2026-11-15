import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs"
import { join } from "node:path"

/** One state change. It never carries field values: they may hold secrets. */
export interface AuditEntry {
  /** ISO time. */
  readonly time: string
  /** The tailnet login, or `-` when gtd cannot know it. */
  readonly identity: string
  /** Where the change came in, such as `/trpc/proceed`. */
  readonly endpoint: string
  readonly project?: string
  readonly worktree?: string
  /** The action id: `proceed`, `retry`, `dismiss`, … */
  readonly action: string
  readonly outcome: string
}

export interface AuditLog {
  readonly write: (entry: AuditEntry) => void
}

const MAX_BYTES = 1024 * 1024

const sizeOf = (file: string): number => {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

/** `audit.log` in the state directory; a full one moves to `audit.log.1`, which keeps one generation. */
export const auditLog = (
  stateDirectory: string,
  { maxBytes = MAX_BYTES }: { readonly maxBytes?: number } = {},
): AuditLog => {
  const file = join(stateDirectory, "audit.log")
  return {
    write: (entry) => {
      const line = `${JSON.stringify(entry)}\n`
      mkdirSync(stateDirectory, { recursive: true, mode: 0o700 })
      const size = sizeOf(file)
      if (size > 0 && size + Buffer.byteLength(line) > maxBytes) renameSync(file, `${file}.1`)
      appendFileSync(file, line, { mode: 0o600 })
    },
  }
}
