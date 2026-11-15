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
        if (failure !== undefined) deps.log(`reaction ${name} failed: ${failure}\n`)
      }
      chains.set(name, (chains.get(name) ?? Promise.resolve()).then(run))
    }
  }

  /** Keeps the statuses as of now; delivers each one that differs from the kept one. */
  const compare = (projects: readonly ProjectView[], atStartup: boolean, quiet: boolean): void => {
    const changes: WorktreeChange[] = []
    const next = new Map<string, Kept>()
    // A project the adapter could not list keeps its worktrees' last statuses.
    for (const project of projects.filter((p) => p.failure !== undefined)) {
      for (const [path, k] of kept) if (k.project === project.id) next.set(path, k)
    }
    for (const project of projects) {
      for (const w of project.worktrees) {
        const now = keptOf(project.id, w)
        next.set(w.path, now)
        const before = kept.get(w.path)
        if (before?.status === now.status && before.errorKind === now.errorKind) continue
        changes.push({
          project: project.id,
          worktree: w.path,
          ...(w.branch !== undefined ? { branch: w.branch } : {}),
          ...(before !== undefined ? { from: before.status as WorktreeChange["to"] } : {}),
          to: w.status,
          ...(w.errorKind !== undefined ? { errorKind: w.errorKind } : {}),
          ...(w.kind !== undefined ? { kind: w.kind } : {}),
          label: w.label,
          ...(w.message !== undefined ? { message: w.message } : {}),
          commit: w.head,
          atStartup,
        } as WorktreeChange)
      }
    }
    const same =
      next.size === kept.size &&
      [...next].every(([path, k]) => JSON.stringify(kept.get(path)) === JSON.stringify(k))
    kept.clear()
    for (const [path, k] of next) kept.set(path, k)
    // Saved before any run starts: a change is delivered at most once, also across a restart.
    if (!same || !saved) deps.store.saveStatuses(Object.fromEntries(kept))
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
    },
  }
}
