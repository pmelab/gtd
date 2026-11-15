import { initTRPC, TRPCError } from "@trpc/server"
import type { PressAction, PressOutcome } from "./Controls.js"
import type { FeedRunner } from "./Feeds.js"
import type { ProjectView } from "./Scan.js"
import type { Banner } from "./Snapshot.js"

interface WorkspaceRouterContext {
  /** Every project with its worktrees and their statuses, as of now. */
  readonly projects: () => readonly ProjectView[]
  /** Problems with the workspace itself. */
  readonly banners: () => readonly Banner[]
  readonly feeds: FeedRunner
  /** Proceed or Retry, as the identity that sent the request. */
  readonly press: (
    action: PressAction,
    input: { readonly worktree: string; readonly commit: string },
  ) => Promise<PressOutcome>
}

const t = initTRPC.context<WorkspaceRouterContext>().create()

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
  proceed: t.procedure
    .input(pressInput)
    .mutation(({ ctx, input }) => pressed(ctx.press("proceed", input))),
  retry: t.procedure
    .input(pressInput)
    .mutation(({ ctx, input }) => pressed(ctx.press("retry", input))),
  inbox: t.procedure.query(({ ctx }) => ({ items: ctx.feeds.items(), feeds: ctx.feeds.feeds() })),
  dismiss: t.procedure.input(itemRef).mutation(({ ctx, input }) => {
    if (!ctx.feeds.dismiss(input.feed, input.key))
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `no proposed item ${input.feed}/${input.key}`,
      })
  }),
})
