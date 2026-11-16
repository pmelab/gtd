import type { AuditLog } from "./Audit.js"
import type { FeedView } from "./Feeds.js"
import type { Store } from "./Store.js"
import type { Caller } from "./WorktreeChanges.js"

/** Where dispatch stops: the workspace (`{}`), one project, or one feed of a project. */
export interface PauseScope {
  readonly project?: string
  readonly feed?: string
}

export interface PausesDeps {
  readonly store: Store
  /** The ids of the projects as of now. */
  readonly projects: () => readonly string[]
  readonly feeds: () => readonly FeedView[]
  readonly audit: AuditLog
  readonly now: () => number
}

export interface Pauses {
  /** Every pause, the workspace first, then by project and feed. */
  readonly list: () => readonly PauseScope[]
  /** Pauses or resumes dispatch in the scope; the refusal, if any. */
  readonly set: (scope: PauseScope, paused: boolean, caller: Caller) => string | undefined
  /** Why a pause holds an item of the feed; none when no pause does. */
  readonly holds: (item: { readonly project: string; readonly feed: string }) => string | undefined
}

const keyOf = (scope: PauseScope): string => `${scope.project ?? ""}/${scope.feed ?? ""}`

/** The scope `value` names, or `undefined` when it names none. */
export const pauseScope = (value: unknown): PauseScope | undefined => {
  if (typeof value !== "object" || value === null) return undefined
  const { project, feed } = value as Record<string, unknown>
  if (project !== undefined && typeof project !== "string") return undefined
  if (feed !== undefined && (typeof feed !== "string" || project === undefined)) return undefined
  return {
    ...(project !== undefined ? { project } : {}),
    ...(feed !== undefined ? { feed } : {}),
  }
}

const sorted = (scopes: Iterable<PauseScope>): PauseScope[] =>
  [...scopes].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))

export const pauses = (deps: PausesDeps): Pauses => {
  const raw = deps.store.paused()
  const kept = new Map(
    raw.flatMap((value) => {
      const scope = pauseScope(value)
      return scope === undefined ? [] : [[keyOf(scope), scope] as const]
    }),
  )

  const refusal = ({ project, feed }: PauseScope): string | undefined => {
    if (project === undefined) return undefined
    const feeds = deps.feeds()
    if (feed !== undefined) {
      return feeds.some((f) => f.feed === feed && f.project === project)
        ? undefined
        : `no feed ${feed} in ${project}`
    }
    const known = deps.projects().includes(project) || feeds.some((f) => f.project === project)
    return known ? undefined : `no project ${project}`
  }

  return {
    list: () => sorted(kept.values()),
    set: (scope, paused, caller) => {
      // A stored pause can be lifted after its project or feed left the config.
      const refused = !paused && kept.has(keyOf(scope)) ? undefined : refusal(scope)
      if (refused !== undefined) return refused
      if (paused) kept.set(keyOf(scope), scope)
      else kept.delete(keyOf(scope))
      deps.store.savePaused(sorted(kept.values()))
      deps.audit.write({
        time: new Date(deps.now()).toISOString(),
        ...caller,
        ...(scope.project !== undefined ? { project: scope.project } : {}),
        action: paused ? "pause" : "resume",
        outcome: "accepted",
      })
      return undefined
    },
    holds: ({ project, feed }) => {
      if (kept.has(keyOf({}))) return "dispatch is paused in workspace"
      if (kept.has(keyOf({ project }))) return `dispatch is paused in ${project}`
      if (kept.has(keyOf({ project, feed }))) return `dispatch is paused for the feed ${feed}`
      return undefined
    },
  }
}

/** Resolves once `drives()` counts none, checking again every `ms`. */
export const whenNoDrive = (
  drives: () => Promise<number>,
  after: (ms: number, run: () => void) => () => void,
  ms = 1000,
): Promise<void> =>
  new Promise((done, failed) => {
    const check = (): void => {
      drives().then((n) => (n === 0 ? done() : void after(ms, check)), failed)
    }
    check()
  })
