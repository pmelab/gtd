import {
  isAdapterFailure,
  type InboxItem,
  type ServicesAdapter,
  type Worktree,
  type WorkspaceSettings,
  type WorktreesAdapter,
} from "../workspace/index.js"
import {
  dispatchableItems,
  idOf,
  setDispatch,
  type Dispatch,
  type Inbox,
} from "../workspace/internal.js"
import type { SpawnOutcome } from "../ui/index.js"
import type { ActionRun, ActionRuns } from "./Actions.js"
import type { AuditLog } from "./Audit.js"
import { branchProblem } from "./Branch.js"
import type { Drivers } from "./Drivers.js"
import type { FeedRunner } from "./Feeds.js"
import type { PauseScope } from "./Pauses.js"
import type { ProjectView } from "./Scan.js"
import { driverRuns, processEnded } from "./Status.js"
import type { Caller } from "./WorktreeChanges.js"

export interface DispatchDeps {
  readonly feeds: FeedRunner
  readonly worktrees: WorktreesAdapter
  readonly services: ServicesAdapter
  readonly actions: ActionRuns
  readonly drivers: Drivers
  readonly next: (worktree: string) => Promise<SpawnOutcome>
  /** The Projects view as of now: a started item ends once its worktree is not in it. */
  readonly projects: () => readonly ProjectView[]
  /** Reads the project again, so the Projects view shows a new worktree at once. */
  readonly refresh: (project: string) => Promise<void>
  /** The config as last loaded: its limits apply at each dispatch. */
  readonly settings: () => WorkspaceSettings
  readonly audit: AuditLog
  readonly now: () => number
  /** The worktrees where a driver runs, by project, as the snapshot last read them. */
  readonly driving: () => ReadonlyMap<string, readonly string[]>
  /** Why a pause holds an item now; none when no pause does. */
  readonly paused?: (item: InboxItem) => string | undefined
}

/** The drives in use, out of `limits.maxDrives` when it is set. */
export interface DrivesView {
  readonly inUse: number
  readonly max?: number
}

export interface Dispatcher {
  /** Start on a proposed item, Retry on a failed one: `false` when there is no such item. */
  readonly press: (
    action: "start" | "retry",
    feed: string,
    key: string,
    caller: Caller,
  ) => Promise<boolean>
  /** Dispatches each started or queued item that can start now, in start order. */
  readonly pass: () => Promise<void>
  /** As the snapshot last saw the drivers: the dashboard asks every few seconds. */
  readonly drives: () => DrivesView
  /** The drives in use in the workspace, a project, or among a feed's items in its project. */
  readonly drivesIn: (scope: PauseScope) => Promise<number>
  /** An item is starting in the worktree. */
  readonly starting: (worktree: string) => boolean
  /** The inbox without the started items whose worktree is gone. */
  readonly endStarted: (inbox: Inbox) => Inbox
  /** Follows the start actions of the items an earlier supervisor left starting. */
  readonly resume: () => Promise<void>
}

const messageOf = (error: unknown): string =>
  isAdapterFailure(error) || error instanceof Error ? error.message : String(error)

/** The branch an item starts on: its own, else `<feed>/<key>` made a valid branch name. */
const branchOf = (item: InboxItem): string =>
  item.branch ??
  `${item.feed}/${item.key.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "")}`

/** What `GTD_WORKSPACE_ITEM` tells the start action and the driver. */
const itemVariable = (item: InboxItem): string =>
  JSON.stringify({
    key: item.key,
    title: item.title,
    ...(item.url !== undefined ? { url: item.url } : {}),
    action: item.action,
    priority: item.priority,
    blockedBy: item.blockedBy,
    ...(item.branch !== undefined ? { branch: item.branch } : {}),
    data: item.data,
    feed: item.feed,
    project: item.project,
  })

export const dispatcher = (deps: DispatchDeps): Dispatcher => {
  const set = (item: InboxItem, dispatch: Dispatch | undefined): void =>
    deps.feeds.change((inbox) => setDispatch(inbox, idOf(item.feed, item.key), dispatch))

  const starting = (path: string): boolean =>
    [...deps.feeds.inbox().entries.values()].some(
      (entry) => entry.dispatch?.state === "starting" && entry.dispatch.worktree === path,
    )

  // Why the worktree cannot take the item now; none when it is free.
  const busy = async (worktree: Worktree): Promise<readonly string[]> => {
    const [outcome, driver] = await Promise.all([
      deps.next(worktree.path),
      deps.drivers.state(worktree.path),
    ])
    return [
      starting(worktree.path) && "an item is starting in it",
      !processEnded(outcome) && "its process has not ended",
      driverRuns(driver) && "its driver runs",
      worktree.dirty !== false && "the tree has uncommitted changes",
    ].filter((reason): reason is string => reason !== false)
  }

  // The worktrees where a driver runs, by project.
  const running = async (): Promise<ReadonlyMap<string, readonly string[]>> => {
    const listed = await Promise.all(
      deps.projects().map(async (project) => {
        const runs = await Promise.all(
          project.worktrees.map(async ({ path }) => driverRuns(await deps.drivers.state(path))),
        )
        return [project.id, project.worktrees.filter((_, i) => runs[i]).map((w) => w.path)] as const
      }),
    )
    return new Map(listed)
  }

  // The worktrees an item is starting in (else the item's id), by project.
  const startingIn = (): readonly (readonly [string, string])[] =>
    [...deps.feeds.inbox().entries].flatMap(([id, entry]) =>
      entry.dispatch?.state === "starting"
        ? [[entry.project, entry.dispatch.worktree ?? id] as const]
        : [],
    )

  // The worktrees that hold a drive, by project: a driver runs, or an item is starting in it.
  const drivesOf = (
    starting: readonly (readonly [string, string])[],
    running: ReadonlyMap<string, readonly string[]>,
  ): Map<string, Set<string>> => {
    const inUse = new Map([...running].map(([project, paths]) => [project, new Set(paths)]))
    for (const [project, worktree] of starting)
      inUse.set(project, (inUse.get(project) ?? new Set()).add(worktree))
    return inUse
  }

  // Read live, the starting items first: one that starts meanwhile then counts by its driver.
  const drives = async (): Promise<Map<string, Set<string>>> => {
    const starting = startingIn()
    return drivesOf(starting, await running())
  }

  const total = (inUse: ReadonlyMap<string, ReadonlySet<string>>): number =>
    [...inUse.values()].reduce((n, worktrees) => n + worktrees.size, 0)

  // Why the project's wip holds its items now; none when it does not.
  const wipHolds = (project: string, used: number): string | undefined => {
    const { limits, projects } = deps.settings()
    const own = projects?.[project]?.wip
    const wip = own ?? limits?.wip
    if (wip === undefined || used < wip) return undefined
    const key = own !== undefined ? `projects.${project}.wip` : "limits.wip"
    return `${project}: ${used} of ${wip} drives in use (${key})`
  }

  // Why `limits.maxDrives` holds every item now; none when it does not.
  const maxHolds = (used: number): string | undefined => {
    const max = deps.settings().limits?.maxDrives
    return max !== undefined && used >= max
      ? `${used} of ${max} drives in use (limits.maxDrives)`
      : undefined
  }

  const limitedAtAll = (project: string): boolean => {
    const { limits, projects } = deps.settings()
    return (
      limits?.maxDrives !== undefined || (projects?.[project]?.wip ?? limits?.wip) !== undefined
    )
  }

  // Why the limits hold an item of the project now; none when it may start.
  // The drives are counted at each check: an item dispatched before may have started its driver.
  const limited = async (project: string): Promise<string | undefined> => {
    if (!limitedAtAll(project)) return undefined
    const inUse = await drives()
    return maxHolds(total(inUse)) ?? wipHolds(project, inUse.get(project)?.size ?? 0)
  }

  // Drops each started item whose worktree is gone from a project gtd could list.
  const endStarted = (inbox: Inbox): Inbox => {
    const listed = deps.projects().filter((project) => project.failure === undefined)
    const paths = new Set(listed.flatMap((p) => p.worktrees.map((w) => w.path)))
    const ids = new Set(listed.map((p) => p.id))
    return [...inbox.entries].reduce(
      (next, [id, entry]) =>
        entry.dispatch?.state === "started" &&
        ids.has(entry.project) &&
        !paths.has(entry.dispatch.worktree)
          ? setDispatch(next, id, undefined)
          : next,
      inbox,
    )
  }

  // The worktree on the item's branch, `undefined` for none, or a failed or waiting dispatch.
  const target = async (
    item: InboxItem,
    branch: string,
  ): Promise<Worktree | Dispatch | undefined> => {
    const problem = branchProblem(branch)
    if (problem !== undefined) return { state: "failed", message: problem }
    let found: Worktree | undefined
    try {
      found = (await deps.worktrees.list(item.project)).find((w) => w.branch === branch)
    } catch (error) {
      return { state: "approved", waits: messageOf(error) }
    }
    const reasons = found === undefined ? [] : await busy(found)
    if (reasons.length === 0) return found
    return {
      state: "approved",
      waits: `${item.project}/${branch} is not free: ${reasons.join(", ")}`,
    }
  }

  const create = async (item: InboxItem, branch: string): Promise<string> => {
    if (deps.worktrees.create === undefined)
      throw new Error("the worktrees adapter creates no worktrees")
    const path = await deps.worktrees.create(item.project, branch)
    set(item, { state: "starting", worktree: path })
    await deps.refresh(item.project)
    return path
  }

  // The start action's exit settles the item.
  const ended =
    (item: InboxItem, worktree: string) =>
    (run: ActionRun): void => {
      const ok = run.exit === 0 && run.message === undefined
      const message = run.message ?? `${item.action} exited ${run.exit}`
      set(item, ok ? { state: "started", worktree } : { state: "failed", message })
    }

  const resumeOne = async (item: InboxItem, worktree: string | undefined): Promise<void> => {
    const env = { GTD_WORKSPACE_ITEM: itemVariable(item) }
    const following =
      worktree !== undefined &&
      (await deps.actions.resume(item.project, worktree, env, ended(item, worktree)))
    if (!following) set(item, { state: "failed", message: "gtd stopped while the item started" })
  }

  // Runs the item up to its start action's pane; the action's exit settles it.
  const dispatch = async (item: InboxItem): Promise<void> => {
    const branch = branchOf(item)
    const found = await target(item, branch)
    if (found !== undefined && "state" in found) return set(item, found)
    set(item, { state: "starting", ...(found ? { worktree: found.path } : {}) })
    try {
      const worktree = found?.path ?? (await create(item, branch))
      await deps.services.up(item.project, worktree)
      const env = { GTD_WORKSPACE_ITEM: itemVariable(item) }
      await deps.actions.run(item.project, worktree, item.action, {}, env, ended(item, worktree))
    } catch (error) {
      set(item, { state: "failed", message: messageOf(error) })
    }
  }

  // One dispatch at a time, so two items never take the same free worktree.
  let queue: Promise<void> = Promise.resolve()
  // `handled` is told each item the pass is done with.
  const pass = (handled: (item: InboxItem) => void = () => {}): Promise<void> => {
    const run = queue.then(async () => {
      deps.feeds.change(endStarted)
      // Until every feed has polled, a blocker of another feed may be missing.
      if (!deps.feeds.ready()) return
      for (const item of dispatchableItems(deps.feeds.inbox())) {
        const held =
          deps.paused?.(item) ?? (await limited(item.project)) ?? (await deps.feeds.canStart(item))
        if (held === undefined) await dispatch(item)
        else if (item.message !== held) set(item, { state: "approved", waits: held })
        handled(item)
      }
    })
    queue = run.catch(() => {})
    return run
  }

  return {
    press: async (action, feed, key, caller) => {
      const item = deps.feeds.items().find((i) => i.feed === feed && i.key === key)
      if (item?.state !== (action === "start" ? "proposed" : "failed")) return false
      set(item, { state: "approved" })
      const procedure = action === "start" ? "startItem" : "retryItem"
      deps.audit.write({
        time: new Date(deps.now()).toISOString(),
        ...caller,
        project: item.project,
        worktree: branchOf(item),
        action: procedure,
        outcome: "accepted",
      })
      // The person waits for their item, not for the rest of the pass.
      const pressed = idOf(feed, key)
      await new Promise<void>((resolve, reject) => {
        pass((done) => {
          if (idOf(done.feed, done.key) === pressed) resolve()
        }).then(resolve, reject)
      })
      return true
    },
    pass: () => pass(),
    drives: () => {
      const max = deps.settings().limits?.maxDrives
      const inUse = total(drivesOf(startingIn(), deps.driving()))
      return { inUse, ...(max !== undefined ? { max } : {}) }
    },
    drivesIn: async ({ project, feed }) => {
      const inUse = await drives()
      if (project === undefined) return total(inUse)
      const worktrees = [...(inUse.get(project) ?? [])]
      if (feed === undefined) return worktrees.length
      const ofFeed = new Set(
        [...deps.feeds.inbox().entries]
          .filter(([, entry]) => entry.feed === feed && entry.project === project)
          .flatMap(([id, { dispatch }]) =>
            dispatch?.state === "started"
              ? [dispatch.worktree]
              : dispatch?.state === "starting"
                ? [dispatch.worktree ?? id]
                : [],
          ),
      )
      return worktrees.filter((worktree) => ofFeed.has(worktree)).length
    },
    starting,
    endStarted,
    resume: async () => {
      const items = deps.feeds.items()
      for (const [id, entry] of deps.feeds.inbox().entries) {
        const item = items.find((i) => idOf(i.feed, i.key) === id)
        if (entry.dispatch?.state === "starting" && item !== undefined)
          await resumeOne(item, entry.dispatch.worktree)
      }
    },
  }
}
