import { initTRPC, TRPCError } from "@trpc/server"
import { ActionRefusal, type ActionRuns } from "./Actions.js"
import type { FeedRunner } from "./Feeds.js"
import type { ProjectView } from "./Scan.js"
import type { Banner } from "./Snapshot.js"
import { WorktreeRefusal, type WorktreeChanges } from "./WorktreeChanges.js"

interface WorkspaceRouterContext {
  /** Every project with its worktrees and their statuses, as of now. */
  readonly projects: () => readonly ProjectView[]
  /** Problems with the workspace itself. */
  readonly banners: () => readonly Banner[]
  readonly actions: ActionRuns
  readonly feeds: FeedRunner
  readonly worktreeChanges: WorktreeChanges
  /** Who sent the request, for the audit log. */
  readonly identity: string
}

const t = initTRPC.context<WorkspaceRouterContext>().create()

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
  return { project: text(value, "project"), branch, base: base as string | undefined }
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
  /** New worktree: `failure` says why its services did not start. */
  createWorktree: t.procedure
    .input(createWorktreeInput)
    .mutation(({ ctx, input }) =>
      refusals(() =>
        ctx.worktreeChanges.create(input.project, input.branch, input.base, ctx.identity),
      ),
    ),
  /** Remove: `{ confirm }` lists what a person must confirm first; `{ removed: true }` once it is gone. */
  removeWorktree: t.procedure
    .input(removeWorktreeInput)
    .mutation(({ ctx, input }) =>
      refusals(() =>
        ctx.worktreeChanges.remove(input.project, input.worktree, input.confirmed, ctx.identity),
      ),
    ),
  inbox: t.procedure.query(({ ctx }) => ({ items: ctx.feeds.items(), feeds: ctx.feeds.feeds() })),
  dismiss: t.procedure.input(itemRef).mutation(({ ctx, input }) => {
    if (!ctx.feeds.dismiss(input.feed, input.key))
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `no proposed item ${input.feed}/${input.key}`,
      })
  }),
})
