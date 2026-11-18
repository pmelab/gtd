import { initTRPC, TRPCError } from "@trpc/server"
import { ActionRefusal, type ActionRuns } from "./Actions.js"
import type { PressAction, PressOutcome } from "./Controls.js"
import type { Dispatcher } from "./Dispatch.js"
import type { FeedRunner } from "./Feeds.js"
import { pauseScope, type Pauses, type PauseScope } from "./Pauses.js"
import type { ProjectView } from "./Scan.js"
import type { Banner } from "./Snapshot.js"
import { WorktreeRefusal, type Caller, type WorktreeChanges } from "./WorktreeChanges.js"

interface WorkspaceRouterContext {
  /** Every project with its worktrees and their statuses, as of now. */
  readonly projects: () => readonly ProjectView[]
  /** Problems with the workspace itself. */
  readonly banners: () => readonly Banner[]
  readonly actions: ActionRuns
  readonly feeds: FeedRunner
  /** Proceed or Retry, as the identity that sent the request. */
  readonly press: (
    action: PressAction,
    input: { readonly worktree: string; readonly commit: string },
  ) => Promise<PressOutcome>
  readonly dispatch: Dispatcher
  readonly pauses: Pauses
  readonly worktreeChanges: WorktreeChanges
  /** Who sent the request, and where, for the audit log. */
  readonly caller: Caller
}

const t = initTRPC.context<WorkspaceRouterContext>().create()

const pauseInput = (value: unknown): PauseScope => {
  const scope = pauseScope(value ?? {})
  if (scope === undefined)
    throw new TRPCError({ code: "BAD_REQUEST", message: "expected { project?, feed? }" })
  return scope
}

const setPause = (ctx: WorkspaceRouterContext, scope: PauseScope, paused: boolean): void => {
  const refusal = ctx.pauses.set(scope, paused, ctx.caller)
  if (refusal !== undefined) throw new TRPCError({ code: "NOT_FOUND", message: refusal })
}

const text = (value: unknown, key: string): string => {
  const field = (value as Record<string, unknown> | null | undefined)?.[key]
  if (typeof field !== "string" || field === "") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${key} must be a non-empty string` })
  }
  return field
}

const worktreeInput = (value: unknown) => ({
  project: text(value, "project"),
  /** The worktree's path, as the `projects` query reports it. */
  worktree: text(value, "worktree"),
})

const runActionInput = (value: unknown) => ({
  ...worktreeInput(value),
  action: text(value, "action"),
  values: (value as Record<string, unknown>)["values"] ?? {},
})

const REFUSAL_CODES = {
  notFound: "NOT_FOUND",
  notOffered: "CONFLICT",
  invalid: "BAD_REQUEST",
  protected: "CONFLICT",
  unsupported: "PRECONDITION_FAILED",
} as const

const createWorktreeInput = (value: unknown) => {
  const { branch, base } = (value ?? {}) as Record<string, unknown>
  if (typeof branch !== "string" || (base !== undefined && typeof base !== "string")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "expected { project, branch, base? }" })
  }
  return {
    project: text(value, "project"),
    branch,
    ...(typeof base === "string" ? { base } : {}),
  }
}

const removeWorktreeInput = (value: unknown) => ({
  ...worktreeInput(value),
  confirmed: (value as Record<string, unknown>)["confirmed"] === true,
})

const refusals = async <A>(body: () => Promise<A>): Promise<A> => {
  try {
    return await body()
  } catch (error) {
    if (error instanceof ActionRefusal || error instanceof WorktreeRefusal) {
      throw new TRPCError({ code: REFUSAL_CODES[error.reason], message: error.message })
    }
    throw error
  }
}

const itemRef = (input: unknown): { feed: string; key: string } => {
  const { feed, key } = (input ?? {}) as Record<string, unknown>
  if (typeof feed !== "string" || typeof key !== "string")
    throw new TRPCError({ code: "BAD_REQUEST", message: "expected { feed, key }" })
  return { feed, key }
}

const pressInput = (input: unknown): { worktree: string; commit: string } => {
  const { worktree, commit } = (input ?? {}) as Record<string, unknown>
  if (typeof worktree !== "string" || typeof commit !== "string")
    throw new TRPCError({ code: "BAD_REQUEST", message: "expected { worktree, commit }" })
  return { worktree, commit }
}

const pressed = async (outcome: Promise<PressOutcome>): Promise<void> => {
  const result = await outcome
  if (result.outcome === "accepted") return
  throw new TRPCError({
    code: result.outcome === "unknown" ? "NOT_FOUND" : "CONFLICT",
    message: result.message,
  })
}

/** The dashboard's API, served under `/trpc`. */
export const workspaceRouter = t.router({
  projects: t.procedure.query(({ ctx }) => ctx.projects()),
  banners: t.procedure.query(({ ctx }) => ctx.banners()),
  /** The action picker: the actions offered in the worktree's status now, with their fields. */
  actions: t.procedure
    .input(worktreeInput)
    .query(({ ctx, input }) => refusals(() => ctx.actions.offered(input.project, input.worktree))),
  runAction: t.procedure.input(runActionInput).mutation(({ ctx, input }) =>
    refusals(async () => {
      await ctx.actions.run(input.project, input.worktree, input.action, input.values)
      return { ok: true as const }
    }),
  ),
  proceed: t.procedure
    .input(pressInput)
    .mutation(({ ctx, input }) => pressed(ctx.press("proceed", input))),
  retry: t.procedure
    .input(pressInput)
    .mutation(({ ctx, input }) => pressed(ctx.press("retry", input))),
  /** New worktree: `failure` says why its services did not start. */
  createWorktree: t.procedure
    .input(createWorktreeInput)
    .mutation(({ ctx, input }) =>
      refusals(() =>
        ctx.worktreeChanges.create(input.project, input.branch, input.base, ctx.caller),
      ),
    ),
  /** Remove: `{ confirm }` lists what a person must confirm first; `{ removed: true }` once it is gone. */
  removeWorktree: t.procedure
    .input(removeWorktreeInput)
    .mutation(({ ctx, input }) =>
      refusals(() =>
        ctx.worktreeChanges.remove(input.project, input.worktree, input.confirmed, ctx.caller),
      ),
    ),
  inbox: t.procedure.query(({ ctx }) => ({
    items: ctx.feeds.items(),
    feeds: ctx.feeds.feeds(),
    drives: ctx.dispatch.drives(),
    paused: ctx.pauses.list(),
  })),
  dismiss: t.procedure.input(itemRef).mutation(({ ctx, input }) => {
    if (!ctx.feeds.dismiss(input.feed, input.key))
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `no proposed or failed item ${input.feed}/${input.key}`,
      })
  }),
  /** Start: dispatches a proposed item; the `inbox` query shows how far it got. */
  startItem: t.procedure.input(itemRef).mutation(async ({ ctx, input }) => {
    if (!(await ctx.dispatch.press("start", input.feed, input.key, ctx.caller)))
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `no proposed item ${input.feed}/${input.key}`,
      })
  }),
  /** Retry: dispatches a failed item again. */
  retryItem: t.procedure.input(itemRef).mutation(async ({ ctx, input }) => {
    if (!(await ctx.dispatch.press("retry", input.feed, input.key, ctx.caller)))
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `no failed item ${input.feed}/${input.key}`,
      })
  }),
  /** Pauses dispatch in the workspace (`{}`), a project, or a feed of a project. */
  pause: t.procedure.input(pauseInput).mutation(({ ctx, input }) => setPause(ctx, input, true)),
  /** Takes off the pause of exactly that scope, and starts what can start now. */
  resume: t.procedure.input(pauseInput).mutation(({ ctx, input }) => {
    setPause(ctx, input, false)
    // What can start now starts after the answer.
    void ctx.dispatch.pass().catch(() => {})
  }),
})

export type WorkspaceRouter = typeof workspaceRouter
