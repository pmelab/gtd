import { basename } from "node:path"
import {
  isAdapterFailure,
  type ServicesAdapter,
  type TerminalAdapter,
  type Worktree,
  type WorktreesAdapter,
} from "../workspace/index.js"
import type { SpawnOutcome } from "../ui/index.js"
import type { AuditLog } from "./Audit.js"
import { branchProblem } from "./Branch.js"
import type { Drivers } from "./Drivers.js"
import { processEnded } from "./Status.js"

export type WorktreeRefusalReason = "invalid" | "notFound" | "protected" | "unsupported"

/** A New worktree or Remove that gtd turns down before it changes anything. */
export class WorktreeRefusal extends Error {
  constructor(
    readonly reason: WorktreeRefusalReason,
    message: string,
  ) {
    super(message)
    this.name = "WorktreeRefusal"
  }
}

/** What gtd knows of a worktree when it decides whether it may remove it. */
export interface RemovalFacts {
  readonly main: boolean
  readonly processEnded: boolean
  readonly driverRuns: boolean
  /** A pane of the worktree runs a command: a person's, or an action's. */
  readonly paneBusy: boolean
  readonly starting: boolean
  readonly errorNote: boolean
}

/** Why gtd keeps the worktree, whoever asks; none when it may go. A dirty tree only asks. */
export const protections = (facts: RemovalFacts): readonly string[] =>
  [
    facts.main && "it is the main checkout",
    !facts.processEnded && "its process has not ended",
    facts.driverRuns && "its driver runs",
    facts.paneBusy && "a pane runs a command",
    facts.starting && "an item is starting in it",
    facts.errorNote && "it has an error note",
  ].filter((reason): reason is string => reason !== false)

/** What a person must confirm before Remove throws work away. */
export const confirmations = (worktree: Worktree): readonly string[] =>
  [
    worktree.dirty !== false && "the tree has uncommitted changes",
    worktree.integrated !== true && "the branch is not integrated",
  ].filter((reason): reason is string => reason !== false)

export interface WorktreeChangesDeps {
  readonly worktrees: WorktreesAdapter
  readonly services: ServicesAdapter
  readonly terminal: TerminalAdapter
  readonly drivers: Drivers
  readonly next: (worktree: string) => Promise<SpawnOutcome>
  /** The panes besides the driver's that gtd opened in the worktree. */
  readonly panes: (worktree: string) => readonly string[]
  /** An item is starting in the worktree. */
  readonly starting?: (worktree: string) => boolean
  /** The worktree has an error note. */
  readonly errorNote?: (worktree: string) => boolean
  /** Reads the project again, so the Projects view shows the change at once. */
  readonly refresh: (project: string) => Promise<void>
  readonly audit: AuditLog
  readonly now: () => number
}

/** Who asked for a change, and through which endpoint. */
export interface Caller {
  /** The tailnet login, or `-` when gtd cannot know it. */
  readonly identity: string
  readonly endpoint: string
}

export type RemoveResult = { readonly removed: true } | { readonly confirm: readonly string[] }

export interface WorktreeChanges {
  /** The new worktree's path, and why its services did not start. */
  readonly create: (
    project: string,
    branch: string,
    base: string | undefined,
    caller: Caller,
  ) => Promise<{ readonly path: string; readonly failure?: string }>
  readonly remove: (
    project: string,
    worktree: string,
    confirmed: boolean,
    caller: Caller,
  ) => Promise<RemoveResult>
}

const refuse = (reason: WorktreeRefusalReason, message: string): never => {
  throw new WorktreeRefusal(reason, message)
}

const nameOf = (worktree: Worktree): string => worktree.branch ?? basename(worktree.path)

const messageOf = (error: unknown): string =>
  isAdapterFailure(error) || error instanceof Error ? error.message : String(error)

export const worktreeChanges = (deps: WorktreeChangesDeps): WorktreeChanges => {
  const listed = async (project: string): Promise<readonly Worktree[]> => {
    try {
      return await deps.worktrees.list(project)
    } catch {
      return refuse("notFound", `no project ${project}`)
    }
  }

  const paneStates = async (path: string) => {
    const driver = deps.drivers.pane(path)
    const handles = [...(driver === undefined ? [] : [driver]), ...deps.panes(path)]
    const states = await Promise.all(
      handles.map(async (handle) => ({ handle, pane: await deps.terminal.status(handle) })),
    )
    return states.flatMap(({ handle, pane }) =>
      pane === undefined ? [] : [{ handle, pane, driver: handle === driver }],
    )
  }

  const factsOf = async (worktree: Worktree): Promise<RemovalFacts> => {
    const [outcome, driver, panes] = await Promise.all([
      deps.next(worktree.path),
      deps.drivers.state(worktree.path),
      paneStates(worktree.path),
    ])
    return {
      main: worktree.main,
      processEnded: processEnded(outcome),
      driverRuns: driver.kind === "unknown" || (driver.kind === "pane" && driver.pane.alive),
      paneBusy: panes.some(({ pane, driver }) => pane.busy || (!driver && pane.alive)),
      starting: deps.starting?.(worktree.path) ?? false,
      errorNote: deps.errorNote?.(worktree.path) ?? false,
    }
  }

  const audited = (caller: Caller, project: string, worktree: string, action: string): void =>
    deps.audit.write({
      time: new Date(deps.now()).toISOString(),
      ...caller,
      project,
      worktree,
      action,
      outcome: "accepted",
    })

  return {
    create: async (project, branch, base, caller) => {
      const create =
        deps.worktrees.create ?? refuse("unsupported", "the worktrees adapter creates no worktrees")
      const problem = branchProblem(branch)
      if (problem !== undefined) refuse("invalid", problem)
      if (base !== undefined && (base === "" || base.startsWith("-"))) {
        refuse("invalid", 'a base is a ref that does not start with "-"')
      }
      if ((await listed(project)).some((w) => w.branch === branch)) {
        refuse("invalid", `${project} has a worktree on ${branch} already`)
      }
      const path = await create.call(deps.worktrees, project, branch, base)
      audited(caller, project, branch, "createWorktree")
      let failure: string | undefined
      try {
        await deps.services.up(project, path)
      } catch (error) {
        failure = messageOf(error)
      }
      await deps.refresh(project)
      return failure === undefined ? { path } : { path, failure }
    },

    remove: async (project, path, confirmed, caller) => {
      const remove =
        deps.worktrees.remove ?? refuse("unsupported", "the worktrees adapter removes no worktrees")
      const worktree =
        (await listed(project)).find((w) => w.path === path) ??
        refuse("notFound", `no worktree ${path} in ${project}`)
      const kept = protections(await factsOf(worktree))
      if (kept.length > 0) {
        refuse("protected", `gtd keeps ${project}/${nameOf(worktree)}: ${kept.join(", ")}`)
      }
      const confirm = confirmations(worktree)
      if (confirm.length > 0 && !confirmed) return { confirm }
      await deps.services.down(project, path)
      for (const { handle } of await paneStates(path)) await deps.terminal.close(handle)
      deps.drivers.forget(path)
      await remove.call(deps.worktrees, project, path, { force: confirm.length > 0 })
      audited(caller, project, nameOf(worktree), "removeWorktree")
      await deps.refresh(project)
      return { removed: true }
    },
  }
}
