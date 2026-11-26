import { basename } from "node:path"
import type { ExecResult, WorktreesAdapter } from "../workspace/index.js"
import type { AuditLog } from "./Audit.js"
import type { Drivers } from "./Drivers.js"
import type { ProjectView, WorktreeView } from "./Scan.js"

export type PressAction = "proceed" | "retry"

export interface Press {
  readonly action: PressAction
  /** The worktree's path. */
  readonly worktree: string
  /** The full HEAD commit the person saw. */
  readonly commit: string
  /** The tailnet login, when known. */
  readonly identity?: string
  /** Where the press came in, such as `/trpc/proceed`. */
  readonly endpoint: string
}

export type PressOutcome =
  | { readonly outcome: "accepted" }
  | {
      readonly outcome: "unknown" | "wrongStatus" | "stale" | "refused" | "noDriver"
      readonly message: string
    }

export interface ControlDeps {
  readonly worktrees: WorktreesAdapter
  readonly drivers: Drivers
  /** The worktree statuses as the dashboard shows them. */
  readonly projects: () => readonly ProjectView[]
  /** Reads a worktree the snapshot does not know yet; false when none exists. */
  readonly discover: (path: string) => Promise<boolean>
  readonly oneShot: (argv: readonly string[], worktree: string) => Promise<ExecResult>
  readonly after: (ms: number, run: () => void) => () => void
  /** Reads the worktree's driver pane again once the driver changed. */
  readonly refreshDriver: (worktree: string) => Promise<void>
  readonly audit: AuditLog
  readonly now: () => number
}

export interface Controls {
  readonly press: (press: Press) => Promise<PressOutcome>
  /** The projects with each worktree's last refusal at its current HEAD. */
  readonly withRefusals: (projects: readonly ProjectView[]) => readonly ProjectView[]
}

// The one-shot of a driver that was just started answers 2 until the driver
// listens; a few seconds is long enough for a driver to come up.
const RETRY_EVERY_MS = 250
const RETRY_FOR_MS = 5_000

const WANTED: Record<PressAction, WorktreeView["status"]> = { proceed: "needsYou", retry: "error" }
const STATUS_WORDS: Record<WorktreeView["status"], string> = {
  needsYou: "needs you",
  working: "is working",
  error: "is in error",
  idle: "is idle",
  waiting: "is waiting for a signal",
}
const PURPOSE: Record<PressAction, string> = {
  proceed: "Proceed is for a worktree that needs you",
  retry: "Retry is for a worktree in error",
}

const firstLine = (text: string): string => text.trim().split("\n")[0] ?? ""

const locate = (projects: readonly ProjectView[], path: string) => {
  for (const project of projects) {
    const view = project.worktrees.find((w) => w.path === path)
    if (view !== undefined) return { project: project.id, view }
  }
  return undefined
}

export const controls = (deps: ControlDeps): Controls => {
  const refusals = new Map<
    string,
    {
      readonly commit: string
      readonly status: WorktreeView["status"]
      readonly message: string
    }
  >()
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => void deps.after(ms, resolve))

  const send = async (argv: readonly string[], path: string): Promise<ExecResult> => {
    try {
      return await deps.oneShot(argv, path)
    } catch (error) {
      return {
        status: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      }
    }
  }

  // fallow-ignore-next-line complexity
  const decide = async (
    press: Press,
    project: string,
    view: WorktreeView,
  ): Promise<PressOutcome> => {
    if (view.status !== WANTED[press.action]) {
      return {
        outcome: "wrongStatus",
        message: `${PURPOSE[press.action]}; this one ${STATUS_WORDS[view.status]}`,
      }
    }
    const now = (await deps.worktrees.list(project)).find((w) => w.path === press.worktree)
    if (now?.head !== press.commit) {
      return {
        outcome: "stale",
        message: "HEAD moved since the page loaded; reload and look again",
      }
    }
    const driver = deps.drivers.command(project)
    if (driver === undefined) {
      return { outcome: "noDriver", message: "no driver runs, and no driver command is configured" }
    }
    const argv = [...driver, press.action, press.commit]
    let result = await send(argv, press.worktree)
    if (result.status === 2) {
      await deps.drivers.start(project, press.worktree)
      await deps.refreshDriver(press.worktree)
      for (let waited = 0; ; waited += RETRY_EVERY_MS) {
        result = await send(argv, press.worktree)
        if (result.status !== 2 || waited >= RETRY_FOR_MS) break
        await sleep(RETRY_EVERY_MS)
      }
      if (result.status === 2) {
        return {
          outcome: "noDriver",
          message: "no driver runs: the driver did not answer after it started",
        }
      }
    }
    if (result.status === 0) return { outcome: "accepted" }
    return {
      outcome: "refused",
      message:
        firstLine(result.stderr) || `the driver's ${press.action} exited with ${result.status}`,
    }
  }

  const reread = async (
    found: NonNullable<ReturnType<typeof locate>>,
    worktree: string,
    refresh: boolean,
  ) => {
    // A cached `working` may predate the driver reaching its gate.
    if (refresh) await deps.refreshDriver(worktree)
    return locate(deps.projects(), worktree) ?? found
  }

  return {
    press: async (press) => {
      let found = locate(deps.projects(), press.worktree)
      if (found === undefined && (await deps.discover(press.worktree))) {
        found = locate(deps.projects(), press.worktree)
      }
      if (found === undefined) {
        return { outcome: "unknown", message: `no worktree at ${press.worktree}` }
      }
      found = await reread(found, press.worktree, found.view.status === "working")
      const outcome = await decide(press, found.project, found.view)
      deps.audit.write({
        time: new Date(deps.now()).toISOString(),
        identity: press.identity ?? "-",
        endpoint: press.endpoint,
        project: found.project,
        worktree: found.view.branch ?? basename(found.view.path),
        action: press.action,
        outcome: outcome.outcome,
      })
      if (outcome.outcome === "accepted") {
        refusals.delete(press.worktree)
        await deps.refreshDriver(press.worktree)
      } else {
        // A refusal holds only while the status stays what it was once the driver was read again.
        const after = await reread(found, press.worktree, outcome.outcome === "refused")
        refusals.set(press.worktree, {
          commit: press.commit,
          status: after.view.status,
          message: outcome.message,
        })
      }
      return outcome
    },
    withRefusals: (projects) =>
      projects.map((project) => ({
        ...project,
        worktrees: project.worktrees.map((w) => {
          const refusal = refusals.get(w.path)
          return refusal?.commit === w.head && refusal.status === w.status
            ? { ...w, refusal: refusal.message }
            : w
        }),
      })),
  }
}
