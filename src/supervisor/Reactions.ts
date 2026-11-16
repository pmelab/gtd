import { basename } from "node:path"
import type {
  ActionValues,
  ExecResult,
  NotificationPriority,
  Reaction,
  ReactionContext,
  ReactionOutcome,
  WorktreeChange,
} from "../workspace/index.js"
import { runReaction } from "../workspace/internal.js"
import type { Press, PressOutcome } from "./Controls.js"
import type { ProjectView, WorktreeView } from "./Scan.js"
import type { Banner } from "./Snapshot.js"
import type { Store } from "./Store.js"

export interface ReactionDeps {
  readonly reactions: ReadonlyMap<string, Reaction>
  readonly store: Store
  readonly exec: (argv: readonly string[], cwd: string) => Promise<ExecResult>
  readonly fetch: typeof globalThis.fetch
  /** Runs an action as the action picker does; throws its refusal. */
  readonly action: (
    project: string,
    worktree: string,
    id: string,
    values: ActionValues,
  ) => Promise<void>
  readonly press: (press: Press) => Promise<PressOutcome>
  readonly notify: (message: {
    readonly key: string
    readonly title: string
    readonly body: string
    readonly worktree: string
    readonly priority: NotificationPriority
  }) => void
  readonly now: () => number
  readonly log: (line: string) => void
}

export interface ReactionRunner {
  /** Starts delivering: what changed while no supervisor ran is delivered with `atStartup`. */
  readonly begin: (projects: readonly ProjectView[]) => void
  /** The worktree statuses as of now. */
  readonly worktrees: (projects: readonly ProjectView[]) => void
  /** Runs these reactions from now on. */
  readonly replace: (reactions: ReadonlyMap<string, Reaction>) => void
  /** Auto-clean removed the worktree: a `cleaned` change, from its last status. */
  readonly cleaned: (project: string, worktree: WorktreeView) => void
  /** Each reaction whose last run failed. */
  readonly banners: () => readonly Banner[]
}

interface Kept {
  readonly project: string
  readonly status: string
  readonly errorKind?: string
}

const isKept = (value: unknown): value is Kept =>
  typeof (value as Kept | null)?.project === "string" &&
  typeof (value as Kept | null)?.status === "string"

const keptOf = (project: string, w: WorktreeView): Kept => ({
  project,
  status: w.status,
  ...(w.errorKind !== undefined ? { errorKind: w.errorKind } : {}),
})

const sameStatus = (a: Kept | undefined, b: Kept | undefined): boolean =>
  a?.status === b?.status && a?.errorKind === b?.errorKind

/** The statuses as of now; a project the adapter could not list keeps its last ones. */
const statusesOf = (
  projects: readonly ProjectView[],
  kept: ReadonlyMap<string, Kept>,
): Map<string, Kept> => {
  const failed = new Set(projects.filter((p) => p.failure !== undefined).map((p) => p.id))
  const next = new Map([...kept].filter(([, k]) => failed.has(k.project)))
  for (const project of projects) {
    for (const w of project.worktrees) next.set(w.path, keptOf(project.id, w))
  }
  return next
}

const changeOf = (
  project: string,
  w: WorktreeView,
  before: Kept | undefined,
  atStartup: boolean,
): WorktreeChange =>
  ({
    project,
    worktree: w.path,
    ...(w.branch !== undefined ? { branch: w.branch } : {}),
    ...(before !== undefined ? { from: before.status } : {}),
    to: w.status,
    ...(w.errorKind !== undefined ? { errorKind: w.errorKind } : {}),
    ...(w.kind !== undefined ? { kind: w.kind } : {}),
    label: w.label,
    ...(w.message !== undefined ? { message: w.message } : {}),
    commit: w.head,
    atStartup,
  }) as WorktreeChange

const messageOf = (error: unknown): string =>
  typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : String(error)

const asOutcome = (press: PressOutcome): ReactionOutcome =>
  press.outcome === "accepted" ? { ok: true } : { ok: false, message: press.message }

export const reactionRunner = (deps: ReactionDeps): ReactionRunner => {
  let reactions = deps.reactions
  const stored = deps.store.statuses()
  const kept = new Map(
    Object.entries(stored ?? {}).filter((entry): entry is [string, Kept] => isKept(entry[1])),
  )
  let begun = false
  let saved = stored !== undefined
  // One run of a reaction at a time, in the order of the changes.
  const chains = new Map<string, Promise<void>>()
  // The failure of each reaction's last run, until a run goes through.
  const failures = new Map<string, string>()

  const contextOf = (name: string, change: WorktreeChange): ReactionContext => {
    const press = async (action: Press["action"], commit: string): Promise<ReactionOutcome> =>
      asOutcome(
        await deps.press({
          action,
          worktree: change.worktree,
          commit,
          endpoint: `reaction:${name}`,
        }),
      )
    return {
      action: async (id, values = {}) => {
        try {
          await deps.action(change.project, change.worktree, id, values)
          return { ok: true }
        } catch (error) {
          return { ok: false, message: messageOf(error) }
        }
      },
      proceed: (commit) => press("proceed", commit),
      retry: (commit) => press("retry", commit),
      notify: async ({ title, body = "", priority = "default" }) =>
        deps.notify({
          key: `reaction:${name}:${change.project}/${change.branch ?? basename(change.worktree)}:${deps.now()}`,
          title,
          body,
          worktree: change.worktree,
          priority,
        }),
      exec: (argv, options) => deps.exec(argv, options?.cwd ?? change.worktree),
      fetch: deps.fetch,
      log: (message) => deps.log(`reaction ${name}: ${message}\n`),
    }
  }

  const deliver = (change: WorktreeChange): void => {
    for (const [name, reaction] of reactions) {
      const run = async (): Promise<void> => {
        const { failure } = await runReaction(reaction, change, contextOf(name, change))
        if (failure === undefined) return void failures.delete(name)
        failures.set(name, failure)
        deps.log(`reaction ${name} failed: ${failure}\n`)
      }
      chains.set(name, (chains.get(name) ?? Promise.resolve()).then(run))
    }
  }

  /** Keeps the statuses as of now; delivers each one that differs from the kept one. */
  const compare = (projects: readonly ProjectView[], atStartup: boolean, quiet: boolean): void => {
    const next = statusesOf(projects, kept)
    const changes = projects.flatMap((project) =>
      project.worktrees
        .filter((w) => !sameStatus(kept.get(w.path), next.get(w.path)))
        .map((w) => changeOf(project.id, w, kept.get(w.path), atStartup)),
    )
    const before = JSON.stringify(Object.fromEntries(kept))
    kept.clear()
    for (const [path, k] of next) kept.set(path, k)
    // Saved before any run starts: a change is delivered at most once, also across a restart.
    if (!saved || before !== JSON.stringify(Object.fromEntries(kept))) {
      deps.store.saveStatuses(Object.fromEntries(kept))
    }
    saved = true
    if (!quiet) for (const change of changes) deliver(change)
  }

  return {
    begin: (projects) => {
      begun = true
      // With no store, what is true at startup is the baseline.
      compare(projects, true, stored === undefined)
    },
    worktrees: (projects) => {
      if (begun) compare(projects, false, false)
    },
    replace: (next) => {
      reactions = next
      for (const name of failures.keys()) if (!next.has(name)) failures.delete(name)
    },
    cleaned: (project, w) => {
      const before = kept.get(w.path)
      kept.delete(w.path)
      deps.store.saveStatuses(Object.fromEntries(kept))
      saved = true
      deliver({ ...changeOf(project, w, before, false), to: "cleaned" })
    },
    banners: () =>
      [...failures]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, failure]) => ({
          kind: "reactionFailed" as const,
          message: `reaction ${name} failed: ${failure}`,
        })),
  }
}
