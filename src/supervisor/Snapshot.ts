import {
  durationMs,
  type AdapterFailure,
  type WatchHint,
  type Worktree,
} from "../workspace/index.js"
import { gatePath } from "./Gate.js"
import { asFailure, byPath, recheck, type ProjectView, type ScanDeps } from "./Scan.js"
import type { WorktreeStatus } from "./Status.js"

/** A problem with the workspace itself, shown above every project. */
export interface Banner {
  readonly kind: "adapterUnavailable"
  readonly message: string
}

export interface SnapshotDeps extends ScanDeps {
  /** Runs `run` once after `ms`; the result cancels it. */
  readonly after: (ms: number, run: () => void) => () => void
}

/** The worktree statuses the supervisor keeps, and what keeps them current. */
export interface Snapshot {
  readonly projects: () => readonly ProjectView[]
  readonly banners: () => readonly Banner[]
  /** Runs `gtd next` in the worktree at once, in turn with its project's other rechecks. */
  readonly recheckWorktree: (path: string) => void
  /** Subscribes to the watch and reads the full snapshot. */
  readonly start: () => Promise<void>
  readonly close: () => void
}

// A commit raises many hints; one recheck after a short wait covers them.
const DEBOUNCE_MS = 500
// The safety rescan: it finds what no hint reports, such as an uncommitted edit.
const RESCAN_MS = 30_000
const RECONNECT_MS = 1_000
const DEFAULT_POLL = "10s"
// `gtd next` costs a process and a replay each; a few at a time keeps a large
// workspace from starving the machine.
const NEXT_CONCURRENCY = 4

interface Kept {
  readonly name: string
  readonly worktrees: readonly Worktree[]
  readonly statuses: ReadonlyMap<string, WorktreeStatus>
  readonly failure?: AdapterFailure
}

/** What one project recheck runs `gtd next` for, besides worktrees whose HEAD moved. */
interface Want {
  all: boolean
  readonly paths: Set<string>
}

const limiter = (limit: number) => {
  let active = 0
  const waiting: (() => void)[] = []
  return async <A>(run: () => Promise<A>): Promise<A> => {
    while (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve))
    active++
    try {
      return await run()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}

const moved = (before: Worktree | undefined, now: Worktree): boolean =>
  before === undefined || before.head !== now.head || before.branch !== now.branch

export const liveSnapshot = (deps: SnapshotDeps): Snapshot => {
  const kept = new Map<string, Kept>()
  let projectsFailure: AdapterFailure | undefined
  const running = new Map<string, Promise<void>>()
  const wanted = new Map<string, Want>()
  const debounced = new Set<string>()
  const timers = new Set<() => void>()
  const limited = limiter(NEXT_CONCURRENCY)
  let closed = false
  let stream: AsyncIterator<WatchHint> | undefined

  const later = (ms: number, run: () => void): void => {
    const cancel = deps.after(ms, () => {
      timers.delete(cancel)
      run()
    })
    timers.add(cancel)
  }
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => later(ms, resolve))

  const recheckProject = async (id: string, want: Want): Promise<void> => {
    const before = kept.get(id)
    const name = deps.settings.projects?.[id]?.name ?? id
    let listed: Worktree[]
    try {
      listed = [...(await deps.worktrees.list(id))].sort(byPath)
    } catch (error) {
      kept.set(id, {
        worktrees: [],
        statuses: new Map(),
        ...before,
        name,
        failure: asFailure("list", error),
      })
      return
    }
    const old = new Map(before?.worktrees.map((w) => [w.path, w]))
    const stale = listed.filter(
      (w) => want.all || want.paths.has(w.path) || moved(old.get(w.path), w),
    )
    const fresh = await Promise.all(stale.map((w) => limited(() => recheck(deps, w.path))))
    const statuses = new Map(
      listed.flatMap((w) => {
        const status = before?.statuses.get(w.path)
        return status === undefined ? [] : [[w.path, status] as const]
      }),
    )
    stale.forEach((w, i) => statuses.set(w.path, fresh[i]!))
    if (!closed) kept.set(id, { name, worktrees: listed, statuses })
  }

  // One recheck per project at a time: what is asked meanwhile runs once after it.
  const drain = async (id: string): Promise<void> => {
    for (let want = wanted.get(id); want !== undefined; want = wanted.get(id)) {
      wanted.delete(id)
      await recheckProject(id, want).catch(() => {})
    }
    running.delete(id)
  }
  const request = (id: string, all: boolean, path?: string): Promise<void> => {
    const want = wanted.get(id) ?? { all: false, paths: new Set<string>() }
    want.all ||= all
    if (path !== undefined) want.paths.add(path)
    wanted.set(id, want)
    const busy = running.get(id)
    if (busy !== undefined) return busy
    const started = drain(id)
    running.set(id, started)
    return started
  }

  /** Every project again; `all` runs `gtd next` in every worktree, else only where HEAD moved. */
  const readAll = async (all: boolean): Promise<void> => {
    let found
    try {
      found = await deps.worktrees.projects()
      projectsFailure = undefined
    } catch (error) {
      projectsFailure = asFailure("projects", error)
      return
    }
    const ids = new Set(found.map((p) => p.id))
    for (const id of kept.keys()) if (!ids.has(id)) kept.delete(id)
    await Promise.all([...ids].map((id) => request(id, all)))
  }

  const hinted = (hint: WatchHint): void => {
    const key = hint.project !== undefined && kept.has(hint.project) ? hint.project : undefined
    const slot = key ?? ""
    // The first hint sets the wait and later ones join it, so a steady stream of hints cannot postpone the recheck.
    if (debounced.has(slot)) return
    debounced.add(slot)
    later(DEBOUNCE_MS, () => {
      debounced.delete(slot)
      void (key === undefined ? readAll(false) : request(key, false))
    })
  }

  const follow = async (watch: () => AsyncIterable<WatchHint>): Promise<void> => {
    let wait = RECONNECT_MS
    for (let first = true; !closed; first = false) {
      try {
        const iterator = watch()[Symbol.asyncIterator]()
        stream = iterator
        const next = iterator.next()
        // Hints sent while no stream was open are lost: read everything once.
        if (!first) void readAll(false)
        for (let result = await next; !result.done && !closed; result = await iterator.next()) {
          wait = RECONNECT_MS
          hinted(result.value)
        }
      } catch {
        // A failed stream is watched again, like one that ended.
      }
      if (closed) return
      await sleep(wait)
      wait = Math.min(wait * 2, RESCAN_MS)
    }
  }

  const every = (ms: number, run: () => Promise<void>): void => {
    later(ms, () => {
      every(ms, run)
      void run()
    })
  }

  return {
    projects: () =>
      [...kept]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, project]) => {
          const unavailable = project.failure ?? projectsFailure
          return {
            id,
            name: project.name,
            ...(project.failure !== undefined ? { failure: project.failure } : {}),
            worktrees: project.worktrees.map((w) => ({
              path: w.path,
              ...(w.branch !== undefined ? { branch: w.branch } : {}),
              head: w.head,
              main: w.main,
              gate: gatePath(id, w),
              ...project.statuses.get(w.path)!,
              ...(unavailable !== undefined ? { unavailable } : {}),
            })),
          }
        }),
    banners: () => {
      const failures = [projectsFailure, ...[...kept.values()].map((p) => p.failure)]
      const messages = new Set(
        failures.flatMap((f) =>
          f === undefined ? [] : [`${f.adapter} unavailable: ${f.message}`],
        ),
      )
      return [...messages].map((message) => ({
        kind: "adapterUnavailable",
        message,
      }))
    },
    recheckWorktree: (path) => {
      const project = [...kept].find(([, p]) => p.worktrees.some((w) => w.path === path))
      if (project !== undefined) void request(project[0], false, path)
    },
    start: async () => {
      const watch = deps.worktrees.watch
      if (watch !== undefined) void follow(watch.bind(deps.worktrees))
      await readAll(true)
      every(RESCAN_MS, () => readAll(true))
      if (watch === undefined) {
        every(durationMs(deps.settings.pollEvery ?? DEFAULT_POLL), () => readAll(false))
      }
    },
    close: () => {
      closed = true
      for (const cancel of timers) cancel()
      timers.clear()
      void stream?.return?.()
    },
  }
}
