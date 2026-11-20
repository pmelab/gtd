import { basename } from "node:path"
import type { AuditLog } from "./Audit.js"
import type { ProjectView } from "./Scan.js"
import type { WorktreeStatus } from "./Status.js"
import type { Store } from "./Store.js"

/** What a ship script reported on a worktree: a merge, a deploy, … */
export interface Note {
  readonly message: string
  readonly error: boolean
}

export interface NotesDeps {
  readonly store: Store
  readonly projects: () => readonly ProjectView[]
  readonly audit: AuditLog
  readonly now: () => number
}

export interface Notes {
  /** Puts the note on the worktree at `path`, or takes it off (`null`); the refusal, if any. */
  readonly note: (path: string, note: Note | null, endpoint: string) => string | undefined
  readonly errorNote: (path: string) => boolean
  readonly withNotes: (projects: readonly ProjectView[]) => readonly ProjectView[]
  /** The status with the worktree's error note applied. */
  readonly withNote: (path: string, status: WorktreeStatus) => WorktreeStatus
}

const isNote = (value: unknown): value is Note =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Note).message === "string" &&
  typeof (value as Note).error === "boolean"

type Noted<S> = Omit<S, "kind"> & WorktreeStatus & { readonly note?: Note }

// An error the worktree has already says more than the note: Retry stays.
const applied = <S extends WorktreeStatus>(status: S, note: Note | undefined): Noted<S> => {
  if (note === undefined) return status
  if (!note.error || status.status === "error") return { ...status, note }
  const { kind: _kind, ...rest } = status
  return {
    ...rest,
    note,
    status: "error",
    errorKind: "note",
    message: note.message,
  } as Noted<S>
}

export const notes = (deps: NotesDeps): Notes => {
  const kept = new Map(
    Object.entries(deps.store.notes()).filter((entry): entry is [string, Note] => isNote(entry[1])),
  )
  return {
    note: (path, note, endpoint) => {
      for (const project of deps.projects()) {
        const view = project.worktrees.find((w) => w.path === path)
        if (view === undefined) continue
        if (note === null) kept.delete(path)
        else kept.set(path, { message: note.message, error: note.error })
        deps.store.saveNotes(Object.fromEntries([...kept].sort(([a], [b]) => a.localeCompare(b))))
        deps.audit.write({
          time: new Date(deps.now()).toISOString(),
          identity: "-",
          endpoint,
          project: project.id,
          worktree: view.branch ?? basename(view.path),
          action: "note",
          outcome: "accepted",
        })
        return undefined
      }
      return `no worktree at ${path}`
    },
    errorNote: (path) => kept.get(path)?.error === true,
    withNotes: (projects) =>
      projects.map((project) => ({
        ...project,
        worktrees: project.worktrees.map((w) => applied(w, kept.get(w.path))),
      })),
    withNote: (path, status) => applied(status, kept.get(path)),
  }
}
