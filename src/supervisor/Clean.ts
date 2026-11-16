import {
  durationMs,
  isAdapterFailure,
  type Duration,
  type RefreshResult,
  type WorkspaceSettings,
  type WorktreesAdapter,
} from "../workspace/index.js"
import type { ProjectView } from "./Scan.js"
import type { Banner } from "./Snapshot.js"
import type { WorktreeChanges } from "./WorktreeChanges.js"

export interface CleanDeps {
  readonly settings: () => WorkspaceSettings
  readonly worktrees: WorktreesAdapter
  /** The ids of the projects gtd lists now. */
  readonly projects: () => readonly string[]
  readonly changes: Pick<WorktreeChanges, "clean">
  /** A main checkout refreshed: `reason` is why it is stale, or `undefined`. */
  readonly refreshed: (project: string, reason: string | undefined) => void
  readonly after: (ms: number, run: () => void) => () => void
  readonly log: (line: string) => void
}

export interface Cleaner {
  /** Follows `clean.every` as the settings say now: call it after each reload. */
  readonly schedule: () => void
  readonly banners: () => readonly Banner[]
  /** The projects with each stale main checkout's reason. */
  readonly withStale: (projects: readonly ProjectView[]) => readonly ProjectView[]
  readonly stop: () => void
}

const messageOf = (error: unknown): string =>
  isAdapterFailure(error) || error instanceof Error ? error.message : String(error)

/** Auto-clean: a pass each `clean.every`, while `clean` is set. */
export const cleaner = (deps: CleanDeps): Cleaner => {
  let stale = new Map<string, string>()
  let every: Duration | undefined
  let cancel = (): void => {}
  let stopped = false
  // A pass that ends after a reload changed `every` must not arm the old timer again.
  let generation = 0

  const refresh = async (project: string): Promise<RefreshResult> => {
    if (deps.worktrees.refresh === undefined) return { state: "ok" }
    try {
      return await deps.worktrees.refresh(project)
    } catch (error) {
      return { state: "stale", reason: messageOf(error) }
    }
  }

  const pass = async (): Promise<void> => {
    const settings = deps.settings()
    const next = new Map<string, string>()
    for (const project of deps.projects()) {
      if (settings.projects?.[project]?.clean === false) continue
      // Integration is told against the default branch: bring it up to date first.
      const refreshed = await refresh(project)
      const reason = refreshed.state === "stale" ? refreshed.reason : undefined
      if (reason !== undefined) next.set(project, reason)
      deps.refreshed(project, reason)
      try {
        for (const { worktree, message } of await deps.changes.clean(project)) {
          deps.log(`clean ${project}/${worktree}: ${message}\n`)
        }
      } catch (error) {
        deps.log(`clean ${project}: ${messageOf(error)}\n`)
      }
    }
    stale = next
  }

  const arm = (): void => {
    if (stopped || every === undefined) return
    const armed = generation
    cancel = deps.after(durationMs(every), () => {
      void pass().finally(() => {
        if (armed === generation) arm()
      })
    })
  }

  return {
    schedule: () => {
      const wanted = deps.settings().clean?.every
      if (wanted === every) return
      cancel()
      generation++
      every = wanted
      if (every === undefined) stale = new Map()
      arm()
    },
    withStale: (projects) =>
      projects.map((project) => {
        const reason = stale.get(project.id)
        return reason === undefined ? project : { ...project, mainStale: reason }
      }),
    banners: () =>
      [...stale].map(([project, reason]) => ({
        kind: "mainStale" as const,
        message: `${project}: the main checkout is stale: ${reason}`,
      })),
    stop: () => {
      stopped = true
      cancel()
    },
  }
}
