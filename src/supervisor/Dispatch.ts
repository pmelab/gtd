import {
  isAdapterFailure,
  type InboxItem,
  type ServicesAdapter,
  type Worktree,
  type WorktreesAdapter,
} from "../workspace/index.js"
import {
  approvedItems,
  idOf,
  setDispatch,
  type Dispatch,
  type Inbox,
} from "../workspace/internal.js"
import type { SpawnOutcome } from "../ui/index.js"
import type { ActionRuns } from "./Actions.js"
import type { AuditLog } from "./Audit.js"
import { branchProblem } from "./Branch.js"
import type { Drivers } from "./Drivers.js"
import type { FeedRunner } from "./Feeds.js"
import type { ProjectView } from "./Scan.js"
import { processEnded } from "./Status.js"

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
  readonly audit: AuditLog
  readonly now: () => number
}

export interface Dispatcher {
  /** Start on a proposed item, Retry on a failed one: `false` when there is no such item. */
  readonly press: (
    action: "start" | "retry",
    feed: string,
    key: string,
    identity: string,
  ) => Promise<boolean>
  /** Dispatches each started item that can start now, in start order. */
  readonly pass: () => Promise<void>
  /** An item is starting in the worktree. */
  readonly starting: (worktree: string) => boolean
  /** The inbox without the started items whose worktree is gone. */
  readonly endStarted: (inbox: Inbox) => Inbox
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
      (driver.kind === "unknown" || (driver.kind === "pane" && driver.pane.alive)) &&
        "its driver runs",
      worktree.dirty !== false && "the tree has uncommitted changes",
    ].filter((reason): reason is string => reason !== false)
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
      await deps.actions.run(item.project, worktree, item.action, {}, env, (run) => {
        const ok = run.exit === 0 && run.message === undefined
        const message = run.message ?? `${item.action} exited ${run.exit}`
        set(item, ok ? { state: "started", worktree } : { state: "failed", message })
      })
    } catch (error) {
      set(item, { state: "failed", message: messageOf(error) })
    }
  }

  // One dispatch at a time, so two items never take the same free worktree.
  let queue: Promise<void> = Promise.resolve()
  const pass = (): Promise<void> => {
    const run = queue.then(async () => {
      deps.feeds.change(endStarted)
      for (const item of approvedItems(deps.feeds.inbox())) await dispatch(item)
    })
    queue = run.catch(() => {})
    return run
  }

  return {
    press: async (action, feed, key, identity) => {
      const item = deps.feeds.items().find((i) => i.feed === feed && i.key === key)
      if (item?.state !== (action === "start" ? "proposed" : "failed")) return false
      set(item, { state: "approved" })
      const procedure = action === "start" ? "startItem" : "retryItem"
      deps.audit.write({
        time: new Date(deps.now()).toISOString(),
        identity,
        endpoint: `/trpc/${procedure}`,
        project: item.project,
        worktree: branchOf(item),
        action: procedure,
        outcome: "accepted",
      })
      await pass()
      return true
    },
    pass,
    starting,
    endStarted,
  }
}
