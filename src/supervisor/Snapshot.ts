import {
  durationMs,
  type AdapterFailure,
  type ServicesAdapter,
  type WatchHint,
  type Worktree,
} from "../workspace/index.js"
import type { SpawnOutcome } from "../ui/index.js"
import type { ActionRun } from "./Actions.js"
import { gatePath } from "./Gate.js"
import { asFailure, byPath, type ProjectView, type ScanDeps } from "./Scan.js"
import { listServices, type ServicesView } from "./Services.js"
import { isOrphan, worktreeStatus, type DriverState } from "./Status.js"

/** A problem with the workspace itself, shown above every project. */
export interface Banner {
  readonly kind: "adapterUnavailable" | "configError" | "unknownProject"
  readonly message: string
}

export interface SnapshotDeps extends ScanDeps {
  /** The config file's name, as banners show it. */
  readonly configName: string
  /** Runs `run` once after `ms`; the result cancels it. */
  readonly after: (ms: number, run: () => void) => () => void
  /** Listed at `pollEvery`, never per request: the pitchfork default costs a process per worktree. */
  readonly services?: ServicesAdapter
  /** The last action gtd ran in the worktree while this supervisor runs. */
  readonly lastAction?: (path: string) => ActionRun | undefined
}

/** The worktree statuses the supervisor keeps, and what keeps them current. */
export interface Snapshot {
  readonly projects: () => readonly ProjectView[]
  readonly banners: () => readonly Banner[]
  /** Runs `gtd next` in the worktree at once, in turn with its project's other rechecks. */
  readonly recheckWorktree: (path: string) => void
  /** Reads one worktree's driver pane again, without `gtd next`. */
  readonly refreshDriver: (path: string) => Promise<void>
  /** Lists the project again at once, and runs `gtd next` where HEAD moved or the worktree is new. */
  readonly refresh: (project: string) => Promise<void>
  /** Subscribes to the watches, starts orphaned drivers and reads the full snapshot. */
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
const SERVICES_CONCURRENCY = 4

/** What a worktree's status is made of; a driver changes without a new `gtd next`. */
interface Seen {
  readonly next: SpawnOutcome
  readonly driver: DriverState
}

interface Kept {
  readonly worktrees: readonly Worktree[]
  readonly seen: Map<string, Seen>
  readonly failure?: AdapterFailure
}

/** What one project recheck runs `gtd next` for, besides worktrees whose HEAD moved. */
interface Want {
  all: boolean
  /** Starts the driver of each orphan it finds: only the first read does. */
  restart: boolean
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

const statusOf = ({ next, driver }: Seen) => worktreeStatus(next, driver)

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
  const streams = new Set<AsyncIterator<unknown>>()
  const lastAction = (path: string): { action?: ActionRun } => {
    const action = deps.lastAction?.(path)
    return action === undefined ? {} : { action }
  }
  let servicesOf = new Map<string, ServicesView>()
  let listing: Promise<void> | undefined

  const later = (ms: number, run: () => void): void => {
    const cancel = deps.after(ms, () => {
      timers.delete(cancel)
      run()
    })
    timers.add(cancel)
  }
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => later(ms, resolve))

  const orphans: { readonly project: string; readonly path: string }[] = []
  const look = async (project: string, path: string, restart: boolean): Promise<Seen> => {
    const next = await deps.next(path)
    const driver = await deps.drivers.state(path)
    if (restart && isOrphan(next, driver)) orphans.push({ project, path })
    return { next, driver }
  }

  // Drivers outlive the supervisor: only an orphan is started, and a crashed driver waits for Retry.
  const restartOrphans = async (): Promise<void> => {
    const found = orphans
      .splice(0)
      .sort((a, b) => a.project.localeCompare(b.project) || a.path.localeCompare(b.path))
    for (const { project, path } of found) {
      if (!(await deps.drivers.start(project, path))) continue
      const driver = await deps.drivers.state(path)
      const seen = kept.get(project)?.seen
      const before = seen?.get(path)
      if (before !== undefined) seen!.set(path, { ...before, driver })
    }
  }

  const refreshDriver = async (path: string): Promise<void> => {
    const driver = await deps.drivers.state(path)
    for (const project of kept.values()) {
      const before = project.seen.get(path)
      if (before !== undefined) project.seen.set(path, { ...before, driver })
    }
  }

  let refreshing: Promise<void> | undefined
  let refreshAgain = false
  /** Reads every kept worktree's driver again; asked while it runs, it runs once more after. */
  const refreshDrivers = (): void => {
    refreshAgain = true
    if (refreshing !== undefined) return
    refreshing = (async () => {
      while (refreshAgain && !closed) {
        refreshAgain = false
        for (const [id, project] of kept) {
          for (const [path, before] of project.seen) {
            const driver = await deps.drivers.state(path)
            // A recheck may have replaced the project meanwhile: write into what is kept now.
            const seen = kept.get(id)?.seen
            if (seen?.get(path)?.next === before.next) seen.set(path, { ...before, driver })
          }
        }
      }
    })().finally(() => (refreshing = undefined))
  }

  /** Lists every kept worktree's services; asked while it runs, it joins that run. */
  const refreshServices = (): Promise<void> => {
    const services = deps.services
    if (services === undefined || listing !== undefined) return listing ?? Promise.resolve()
    const limit = limiter(SERVICES_CONCURRENCY)
    const all = [...kept].flatMap(([id, p]) => p.worktrees.map((w) => [id, w.path] as const))
    listing = Promise.all(
      all.map(([id, path]) =>
        limit(async () => [path, await listServices(services, id, path)] as const),
      ),
    )
      .then((listed) => {
        if (!closed) servicesOf = new Map(listed)
      })
      .finally(() => (listing = undefined))
    return listing
  }

  const recheckProject = async (id: string, want: Want): Promise<void> => {
    const before = kept.get(id)
    let listed: Worktree[]
    try {
      listed = [...(await deps.worktrees.list(id))].sort(byPath)
    } catch (error) {
      kept.set(id, {
        worktrees: [],
        seen: new Map(),
        ...before,
        failure: asFailure("list", error),
      })
      return
    }
    const old = new Map(before?.worktrees.map((w) => [w.path, w]))
    const stale = listed.filter(
      (w) => want.all || want.paths.has(w.path) || moved(old.get(w.path), w),
    )
    const fresh = await Promise.all(stale.map((w) => limited(() => look(id, w.path, want.restart))))
    const seen = new Map(
      listed.flatMap((w) => {
        const status = before?.seen.get(w.path)
        return status === undefined ? [] : [[w.path, status] as const]
      }),
    )
    stale.forEach((w, i) => seen.set(w.path, fresh[i]!))
    if (!closed) kept.set(id, { worktrees: listed, seen })
  }

  // One recheck per project at a time: what is asked meanwhile runs once after it.
  const drain = async (id: string): Promise<void> => {
    for (let want = wanted.get(id); want !== undefined; want = wanted.get(id)) {
      wanted.delete(id)
      await recheckProject(id, want).catch(() => {})
    }
    running.delete(id)
  }
  const request = (id: string, all: boolean, path?: string, restart = false): Promise<void> => {
    const want = wanted.get(id) ?? { all: false, restart: false, paths: new Set<string>() }
    want.all ||= all
    want.restart ||= restart
    if (path !== undefined) want.paths.add(path)
    wanted.set(id, want)
    const busy = running.get(id)
    if (busy !== undefined) return busy
    const started = drain(id)
    running.set(id, started)
    return started
  }

  /** Every project again; `all` runs `gtd next` in every worktree, else only where HEAD moved. */
  const readAll = async (all: boolean, restart = false): Promise<void> => {
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
    await Promise.all([...ids].map((id) => request(id, all, undefined, restart)))
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

  const follow = async <H>(
    watch: () => AsyncIterable<H>,
    onHint: (hint: H) => void,
    onReconnect: () => void,
  ): Promise<void> => {
    let wait = RECONNECT_MS
    let stream: AsyncIterator<H> | undefined
    for (let first = true; !closed; first = false) {
      try {
        const iterator = watch()[Symbol.asyncIterator]()
        streams.add(iterator)
        if (stream !== undefined) streams.delete(stream)
        stream = iterator
        const next = iterator.next()
        // Hints sent while no stream was open are lost: read everything once.
        if (!first) onReconnect()
        for (let result = await next; !result.done && !closed; result = await iterator.next()) {
          wait = RECONNECT_MS
          onHint(result.value)
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
            name: deps.settings().projects?.[id]?.name ?? id,
            ...(project.failure !== undefined ? { failure: project.failure } : {}),
            worktrees: project.worktrees.map((w) => ({
              path: w.path,
              ...(w.branch !== undefined ? { branch: w.branch } : {}),
              head: w.head,
              main: w.main,
              gate: gatePath(id, w),
              ...statusOf(project.seen.get(w.path)!),
              ...servicesOf.get(w.path),
              ...lastAction(w.path),
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
      const unavailable = [...messages].map((message) => ({
        kind: "adapterUnavailable" as const,
        message,
      }))
      // Without a read of the projects, an id may only seem unknown.
      if (projectsFailure !== undefined) return unavailable
      const unknown = Object.keys(deps.settings().projects ?? {})
        .filter((id) => !kept.has(id))
        .map((id) => ({
          kind: "unknownProject" as const,
          message: `${deps.configName}: workspace.projects.${id}: no project has this id`,
        }))
      return [...unavailable, ...unknown]
    },
    refreshDriver,
    recheckWorktree: (path) => {
      const project = [...kept].find(([, p]) => p.worktrees.some((w) => w.path === path))
      if (project !== undefined) void request(project[0], false, path)
    },
    refresh: (project) => request(project, false),
    start: async () => {
      const watch = deps.worktrees.watch
      const pollMs = durationMs(deps.settings().pollEvery ?? DEFAULT_POLL)
      if (watch !== undefined) {
        void follow(watch.bind(deps.worktrees), hinted, () => void readAll(false))
      }
      if (deps.drivers.watch !== undefined) {
        void follow(deps.drivers.watch, refreshDrivers, refreshDrivers)
      }
      await readAll(true, true)
      await restartOrphans()
      await refreshServices()
      every(pollMs, refreshServices)
      every(RESCAN_MS, () => readAll(true))
      if (watch === undefined) every(pollMs, () => readAll(false))
      if (deps.drivers.watch === undefined) {
        every(pollMs, async () => refreshDrivers())
      }
    },
    close: () => {
      closed = true
      for (const cancel of timers) cancel()
      timers.clear()
      for (const stream of streams) void stream.return?.()
    },
  }
}
