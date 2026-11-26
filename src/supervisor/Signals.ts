import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ExecResult, FeedSignal } from "../workspace/index.js"
import type { Drivers } from "./Drivers.js"
import type { ProjectView, WorktreeView } from "./Scan.js"

/** News for one resting process: what `gtd signal` takes. */
export interface Delivery {
  readonly kind: string
  readonly fingerprint?: string
  readonly data?: unknown
}

export interface SignalDeps {
  readonly exec: (argv: readonly string[], cwd: string) => Promise<ExecResult>
  readonly drivers: Drivers
  readonly projects: () => readonly ProjectView[]
  readonly refreshDriver: (worktree: string) => Promise<void>
  /** Why a pause holds signals of the feed; none when no pause does. */
  readonly holds: (scope: { readonly project: string; readonly feed: string }) => string | undefined
  readonly now: () => number
  readonly log: (line: string) => void
}

export interface Signals {
  /** Runs `gtd signal` on the worktree and, when it wrote the trace, starts the driver. */
  readonly deliver: (project: string, worktree: string, delivery: Delivery) => Promise<boolean>
  /** Delivers what a feed's poll returned to the waiting processes it names. */
  readonly fromFeed: (
    feed: string,
    project: string,
    signals: readonly FeedSignal[],
  ) => Promise<void>
  /** Delivers `timeout` to every wait that has rested as long as its timeout. */
  readonly timeouts: () => Promise<void>
}

const UNITS: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

/** A wait step's `timeout` in milliseconds; `undefined` when it is no duration. */
export const timeoutMs = (timeout: string): number | undefined => {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(timeout)
  return match === null ? undefined : Number(match[1]) * UNITS[match[2]!]!
}

const branchOf = (view: WorktreeView): string | undefined => view.branch?.replace(/^gtd\//, "")

const accepting = (view: WorktreeView, kind: string): boolean =>
  view.status === "waiting" && view.signal?.kinds.includes(kind) === true

export const signals = (deps: SignalDeps): Signals => {
  const deliver: Signals["deliver"] = async (project, worktree, delivery) => {
    const scratch = mkdtempSync(join(tmpdir(), "gtd-signal-"))
    try {
      const data = join(scratch, "data.json")
      if (delivery.data !== undefined) writeFileSync(data, JSON.stringify(delivery.data))
      const result = await deps.exec(
        [
          "gtd",
          "signal",
          worktree,
          delivery.kind,
          ...(delivery.data === undefined ? [] : ["--data", data]),
          ...(delivery.fingerprint === undefined ? [] : ["--fingerprint", delivery.fingerprint]),
        ],
        worktree,
      )
      if (result.status !== 0 || !result.stdout.includes("written")) return false
      await deps.drivers.start(project, worktree)
      await deps.refreshDriver(worktree)
      return true
    } catch (error) {
      deps.log(`signal ${delivery.kind} for ${worktree}: ${String(error)}\n`)
      return false
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }

  const timedOut = async (w: WorktreeView): Promise<boolean> => {
    const limit = w.signal?.timeout === undefined ? undefined : timeoutMs(w.signal.timeout)
    if (limit === undefined || !accepting(w, "timeout")) return false
    const committed = await deps.exec(["git", "log", "-1", "--format=%ct"], w.path)
    const since = Number(committed.stdout.trim()) * 1000
    return committed.status === 0 && Number.isFinite(since) && deps.now() - since >= limit
  }

  return {
    deliver,
    fromFeed: async (feed, project, news) => {
      if (news.length === 0 || deps.holds({ project, feed }) !== undefined) return
      const view = deps.projects().find((p) => p.id === project)
      for (const signal of news) {
        const target = view?.worktrees.find(
          (w) => branchOf(w) === signal.branch && accepting(w, signal.kind),
        )
        if (target === undefined) continue
        await deliver(project, target.path, {
          kind: signal.kind,
          fingerprint: signal.fingerprint,
          data: signal.data ?? null,
        })
      }
    },
    timeouts: async () => {
      for (const project of deps.projects()) {
        if (deps.holds({ project: project.id, feed: "" }) !== undefined) continue
        for (const w of project.worktrees) {
          if (!(await timedOut(w))) continue
          // The wait's own commit names the timeout, so the same wait never takes it twice.
          await deliver(project.id, w.path, { kind: "timeout", fingerprint: `timeout:${w.head}` })
        }
      }
    },
  }
}
