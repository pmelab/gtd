import { readdir, readFile, stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { gateKind, widgetFormat } from "../steering/index.js"
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
import { driverRuns, isOrphan, worktreeStatus, type DriverState } from "./Status.js"

/** A problem with the workspace itself, shown above every project. */
export interface Banner {
  readonly kind:
    | "adapterUnavailable"
    | "configError"
    | "unknownProject"
    | "mainStale"
    | "reactionFailed"
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
  /** Called after a worktree status may have changed. */
  readonly changed?: () => void
}

/** The worktree statuses the supervisor keeps, and what keeps them current. */
export interface Snapshot {
  readonly projects: () => readonly ProjectView[]
  readonly banners: () => readonly Banner[]
  /** The worktrees where a driver runs, by project, as last read. */
  readonly driving: () => ReadonlyMap<string, readonly string[]>
  /** Runs `gtd next` in the worktree at once, in turn with its project's other rechecks. */
  readonly recheckWorktree: (path: string) => void
  /** Finds a worktree no recheck listed yet and reads only that one; false when no project lists it. */
  readonly discover: (path: string) => Promise<boolean>
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
// The safety net: it finds what no hint reports, such as an uncommitted edit.
const NET_MS = 600_000
// Cheap in-process check for `.gtd/` and index changes.
const FINGERPRINT_MS = 1_000
const MAX_WAIT_MS = 30_000
const RECONNECT_MS = 1_000
const DEFAULT_POLL = "10s"
const SERVICES_CONCURRENCY = 4

/** What a worktree's status is made of; a driver changes without a new `gtd next`. */
interface GateFacts {
  readonly gateKind?: string
  readonly gateBase?: string
}

interface Seen {
  readonly gate: GateFacts
  readonly next: SpawnOutcome
  readonly driver: DriverState
}

interface Kept {
  readonly worktrees: readonly Worktree[]
  readonly seen: Map<string, Seen>
  /** What each worktree's `seen` was read at: equal key, no new `gtd next`. */
  readonly keys: Map<string, string>
  readonly failure?: AdapterFailure
}

/** What one project recheck runs `gtd next` for, besides worktrees whose HEAD moved. */
interface Want {
  /** Paths whose `gtd next` runs whatever the cache holds: the safety net. */
  readonly force: Set<string>
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

const keyOf = (w: Worktree, fp: string): string =>
  JSON.stringify([
    w.head,
    w.branch ?? null,
    w.foreground ?? null,
    w.dirty ?? null,
    w.description ?? null,
    fp,
  ])

const stamp = async (path: string): Promise<string> => {
  try {
    const st = await stat(path)
    return `${st.size}:${st.mtimeMs}`
  } catch {
    return "-"
  }
}

const walk = async (dir: string, out: string[]): Promise<void> => {
  let names: string[]
  try {
    names = (await readdir(dir)).sort()
  } catch {
    return
  }
  for (const name of names) {
    const path = join(dir, name)
    out.push(`${path}:${await stamp(path)}`)
    try {
      if ((await stat(path)).isDirectory()) await walk(path, out)
    } catch {
      // gone meanwhile
    }
  }
}

/** `.gtd/` names, sizes and mtimes, and the worktree's index stamp. */
export const worktreeFingerprint = async (worktree: string): Promise<string> => {
  const out: string[] = []
  await walk(join(worktree, ".gtd"), out)
  let gitDir = join(worktree, ".git")
  try {
    const text = await readFile(gitDir, "utf8")
    const m = /^gitdir: (.+)$/m.exec(text)
    if (m !== null) gitDir = resolve(worktree, m[1]!.trim())
  } catch {
    // a directory: the main checkout
  }
  out.push(`index:${await stamp(join(gitDir, "index"))}`)
  out.push(...(await partnerTips(gitDir)))
  return out.join("\n")
}

const readText = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, "utf8")
  } catch {
    return undefined
  }
}

/** The tip of `ref`, loose or packed; `-` when absent. */
const tipOf = async (commonDir: string, ref: string): Promise<string> => {
  const loose = await readText(join(commonDir, ref))
  if (loose !== undefined) return loose.trim()
  const packed = (await readText(join(commonDir, "packed-refs"))) ?? ""
  const line = packed.split("\n").find((l) => l.endsWith(` ${ref}`))
  return line === undefined ? "-" : line.split(" ")[0]!
}

/** `gtd next` reads the partner branch's tip: `gtd/<b>` for `<b>` and the reverse. */
const partnerTips = async (gitDir: string): Promise<string[]> => {
  const head = (await readText(join(gitDir, "HEAD"))) ?? ""
  const m = /^ref: refs\/heads\/(.+)$/m.exec(head)
  if (m === null) return []
  const current = m[1]!.trim()
  const common = (await readText(join(gitDir, "commondir")))?.trim()
  const commonDir = common === undefined ? gitDir : resolve(gitDir, common)
  const partner = current.startsWith("gtd/") ? current.slice(4) : `gtd/${current}`
  return [`partner:${partner}:${await tipOf(commonDir, `refs/heads/${partner}`)}`]
}

/** The gate kind and review base of the steering file `gtd next` names. */
const gateFacts = async (
  path: string,
  next: SpawnOutcome,
  read: ((file: string) => Promise<string | undefined>) | undefined,
): Promise<GateFacts> => {
  let file: unknown
  try {
    const beat = JSON.parse(next.stdout) as { file?: unknown; actor?: unknown }
    file = beat.actor === "human" ? beat.file : undefined
  } catch {
    return {}
  }
  if (typeof file !== "string" || file === "") return {}
  const base = widgetFormat.view((await read?.(join(path, file))) ?? "").base
  return {
    gateKind: gateKind(file),
    ...(base !== undefined ? { gateBase: base } : {}),
  }
}

const statusOf = ({ next, driver }: Seen) => worktreeStatus(next, driver)

export const liveSnapshot = (deps: SnapshotDeps): Snapshot => {
  const kept = new Map<string, Kept>()
  let projectsFailure: AdapterFailure | undefined
  const running = new Map<string, Promise<void>>()
  // Worktrees `discover` added: a recheck that listed before them keeps them.
  const added = new Map<string, Map<string, { w: Worktree; at: number }>>()
  let tick = 0
  const wanted = new Map<string, Want>()
  const debounced = new Set<string>()
  const timers = new Set<() => void>()
  const fingerprint = deps.fingerprint ?? (async () => "")
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
    return { next, driver, gate: await gateFacts(path, next, deps.readFile) }
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
    if (found.length > 0) deps.changed?.()
  }

  const refreshDriver = async (path: string): Promise<void> => {
    // A driver that prints no status record is judged by `gtd next` too.
    const owner = [...kept].find(([, p]) => p.seen.has(path))
    const seen = owner === undefined ? undefined : await look(owner[0], path, false)
    const driver = seen?.driver ?? (await deps.drivers.state(path))
    for (const project of kept.values()) {
      const before = project.seen.get(path)
      if (before !== undefined) project.seen.set(path, { ...before, ...seen, driver })
    }
    deps.changed?.()
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
        deps.changed?.()
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
    const started = ++tick
    let listed: Worktree[]
    try {
      listed = [...(await deps.worktrees.list(id))].sort(byPath)
    } catch (error) {
      kept.set(id, {
        worktrees: [],
        seen: new Map(),
        keys: new Map(),
        ...before,
        failure: asFailure("list", error),
      })
      return
    }
    const prints = await Promise.all(listed.map((w) => fingerprint(w.path)))
    const keys = new Map(listed.map((w, i) => [w.path, keyOf(w, prints[i]!)] as const))
    const stale = listed.filter(
      (w) =>
        want.force.has(w.path) ||
        before?.seen.get(w.path) === undefined ||
        before.keys.get(w.path) !== keys.get(w.path),
    )
    const fresh = await Promise.all(stale.map((w) => look(id, w.path, want.restart)))
    const seen = new Map(
      listed.flatMap((w) => {
        const status = before?.seen.get(w.path)
        return status === undefined ? [] : [[w.path, status] as const]
      }),
    )
    stale.forEach((w, i) => seen.set(w.path, fresh[i]!))
    // A failed `gtd next` keeps no key, so the next recheck runs it again.
    stale.forEach((w, i) => {
      const { next } = fresh[i]!
      if (next.spawnError !== undefined || next.status !== 0) keys.delete(w.path)
    })
    const extra = added.get(id)
    if (extra !== undefined) {
      const current = kept.get(id)
      for (const [path, { w, at }] of extra) {
        if (started > at || listed.some((l) => l.path === path)) extra.delete(path)
        else if (current?.seen.has(path)) {
          listed.push(w)
          seen.set(path, current.seen.get(path)!)
          const k = current.keys.get(path)
          if (k !== undefined) keys.set(path, k)
        }
      }
      listed.sort(byPath)
    }
    if (!closed) kept.set(id, { worktrees: listed, seen, keys })
  }

  const listOf = async (id: string): Promise<readonly Worktree[]> =>
    deps.worktrees.list(id).catch(() => [])

  /** Reads only the new worktree and keeps it, also through a recheck that listed before it. */
  const adopt = async (id: string, w: Worktree): Promise<boolean> => {
    if (kept.get(id)?.seen.has(w.path)) return true
    const key = keyOf(w, await fingerprint(w.path))
    const seen = await look(id, w.path, false)
    const now = kept.get(id)
    if (closed || now === undefined) return false
    if (!now.worktrees.some((k) => k.path === w.path)) {
      kept.set(id, {
        ...now,
        worktrees: [...now.worktrees, w].sort(byPath),
        seen: new Map(now.seen).set(w.path, seen),
        keys:
          seen.next.spawnError !== undefined || seen.next.status !== 0
            ? new Map(now.keys)
            : new Map(now.keys).set(w.path, key),
      })
    }
    added.set(id, (added.get(id) ?? new Map()).set(w.path, { w, at: ++tick }))
    deps.changed?.()
    return true
  }

  const discover = async (path: string): Promise<boolean> => {
    for (const id of kept.keys()) {
      const w = (await listOf(id)).find((l) => l.path === path)
      if (w !== undefined) return adopt(id, w)
    }
    return false
  }

  // One recheck per project at a time: what is asked meanwhile runs once after it.
  const drain = async (id: string): Promise<void> => {
    for (let want = wanted.get(id); want !== undefined; want = wanted.get(id)) {
      wanted.delete(id)
      await recheckProject(id, want).catch(() => {})
      deps.changed?.()
    }
    running.delete(id)
  }
  const request = (
    id: string,
    force: readonly string[],
    path?: string,
    restart = false,
  ): Promise<void> => {
    const want = wanted.get(id) ?? {
      force: new Set<string>(),
      restart: false,
      paths: new Set<string>(),
    }
    for (const f of force) want.force.add(f)
    want.restart ||= restart
    if (path !== undefined) want.paths.add(path)
    wanted.set(id, want)
    const busy = running.get(id)
    if (busy !== undefined) return busy
    const started = drain(id)
    running.set(id, started)
    return started
  }

  /** Every project again; `gtd next` runs only where the cache key changed. */
  const readAll = async (restart = false): Promise<void> => {
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
    await Promise.all([...ids].map((id) => request(id, [], undefined, restart)))
  }

  const hinted = (hint: WatchHint): void => {
    const key = hint.project !== undefined && kept.has(hint.project) ? hint.project : undefined
    const slot = key ?? ""
    // The first hint sets the wait and later ones join it, so a steady stream of hints cannot postpone the recheck.
    if (debounced.has(slot)) return
    debounced.add(slot)
    later(DEBOUNCE_MS, () => {
      debounced.delete(slot)
      void (key === undefined ? readAll() : request(key, []))
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
      wait = Math.min(wait * 2, MAX_WAIT_MS)
    }
  }

  /** `.gtd/` and index edits: a changed fingerprint rechecks that worktree. */
  const checkPrints = async (): Promise<void> => {
    for (const [id, project] of kept) {
      if (project.failure !== undefined) continue
      for (const w of project.worktrees) {
        if (closed) return
        const key = keyOf(w, await fingerprint(w.path))
        const known = project.keys.get(w.path)
        if (known !== undefined && known !== key) void request(id, [], w.path)
      }
    }
  }

  /** Relists every project; forces `gtd next` where no process ended, spread over the interval. */
  const net = async (): Promise<void> => {
    await readAll()
    const live = [...kept].flatMap(([id, p]) =>
      [...p.seen]
        .filter(([, { driver }]) => driverRuns(driver))
        .map(([path]) => [id, path] as const),
    )
    live.forEach(([id, path], i) =>
      later(Math.floor((i * NET_MS) / live.length), () => void request(id, [path])),
    )
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
            namesWorktrees: deps.settings().nameWorktree !== undefined,
            ...(project.failure !== undefined ? { failure: project.failure } : {}),
            worktrees: project.worktrees.map((w) => ({
              path: w.path,
              ...((w.foreground ?? w.branch) !== undefined
                ? { branch: (w.foreground ?? w.branch)! }
                : {}),
              ...(w.description !== undefined ? { description: w.description } : {}),
              head: w.head,
              main: w.main,
              gate: gatePath(id, w),
              ...project.seen.get(w.path)!.gate,
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
    driving: () =>
      new Map(
        [...kept].map(([id, project]) => [
          id,
          [...project.seen].filter(([, { driver }]) => driverRuns(driver)).map(([path]) => path),
        ]),
      ),
    refreshDriver,
    discover,
    recheckWorktree: (path) => {
      const project = [...kept].find(([, p]) => p.worktrees.some((w) => w.path === path))
      if (project !== undefined) void request(project[0], [path], path)
    },
    refresh: (project) => request(project, []),
    start: async () => {
      const watch = deps.worktrees.watch
      const pollMs = durationMs(deps.settings().pollEvery ?? DEFAULT_POLL)
      if (watch !== undefined) {
        void follow(watch.bind(deps.worktrees), hinted, () => void readAll())
      }
      if (deps.drivers.watch !== undefined) {
        void follow(deps.drivers.watch, refreshDrivers, refreshDrivers)
      }
      await readAll(true)
      await restartOrphans()
      await refreshServices()
      every(pollMs, refreshServices)
      every(FINGERPRINT_MS, checkPrints)
      every(NET_MS, net)
      if (watch === undefined) every(pollMs, () => readAll())
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
