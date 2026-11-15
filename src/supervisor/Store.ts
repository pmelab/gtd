import { readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Entry } from "../workspace/internal.js"

/**
 * `state.json` in the state directory. Everything in it can be rebuilt: a
 * deleted or unreadable store loses only what a person decided, such as
 * dismissals, the notes and the pauses.
 */
export interface Store {
  readonly dismissed: () => readonly string[]
  readonly saveDismissed: (ids: Iterable<string>) => void
  /** The items a person started, and those gtd dispatched. */
  readonly items: () => readonly Entry[]
  readonly saveItems: (entries: readonly Entry[]) => void
  /** Notes by worktree path, unchecked. */
  readonly notes: () => Readonly<Record<string, unknown>>
  readonly saveNotes: (notes: Readonly<Record<string, unknown>>) => void
  /** The scopes where dispatch is paused, unchecked. */
  readonly paused: () => readonly unknown[]
  readonly savePaused: (scopes: readonly unknown[]) => void
}

type StoreData = Record<string, unknown>

// gtd writes this file itself: a shape check is enough to skip a hand-edited entry.
const isEntry = (value: unknown): value is Entry => {
  const entry = value as Partial<Entry> | null
  return (
    typeof entry?.feed === "string" &&
    typeof entry.project === "string" &&
    typeof entry.item?.key === "string" &&
    typeof entry.dispatch?.state === "string"
  )
}

export const openStore = (directory: string): Store => {
  const path = join(directory, "state.json")
  const read = (): StoreData => {
    try {
      const data: unknown = JSON.parse(readFileSync(path, "utf8"))
      return typeof data === "object" && data !== null && !Array.isArray(data)
        ? (data as StoreData)
        : {}
    } catch {
      return {}
    }
  }
  const write = (data: StoreData): void => {
    const temporary = `${path}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, path)
  }
  return {
    dismissed: () => {
      const ids = read()["dismissed"]
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []
    },
    saveDismissed: (ids) => write({ ...read(), dismissed: [...ids].sort() }),
    items: () => {
      const entries = read()["items"]
      return Array.isArray(entries) ? entries.filter(isEntry) : []
    },
    saveItems: (entries) => write({ ...read(), items: entries }),
    notes: () => {
      const notes = read()["notes"]
      return typeof notes === "object" && notes !== null && !Array.isArray(notes)
        ? (notes as Record<string, unknown>)
        : {}
    },
    saveNotes: (notes) => write({ ...read(), notes }),
    paused: () => {
      const scopes = read()["paused"]
      return Array.isArray(scopes) ? scopes : []
    },
    savePaused: (paused) => write({ ...read(), paused }),
  }
}
