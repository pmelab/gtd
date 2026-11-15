import { readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/**
 * `state.json` in the state directory. Everything in it can be rebuilt: a
 * deleted or unreadable store loses only what a person decided, such as
 * dismissals, and the notes.
 */
export interface Store {
  readonly dismissed: () => readonly string[]
  readonly saveDismissed: (ids: Iterable<string>) => void
  /** Notes by worktree path, unchecked. */
  readonly notes: () => Readonly<Record<string, unknown>>
  readonly saveNotes: (notes: Readonly<Record<string, unknown>>) => void
}

type StoreData = Record<string, unknown>

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
    notes: () => {
      const notes = read()["notes"]
      return typeof notes === "object" && notes !== null && !Array.isArray(notes)
        ? (notes as Record<string, unknown>)
        : {}
    },
    saveNotes: (notes) => write({ ...read(), notes }),
  }
}
