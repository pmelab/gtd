import { initTRPC, TRPCError } from "@trpc/server"
import { ActionRefusal, type ActionRuns } from "./Actions.js"
import type { PressAction, PressOutcome } from "./Controls.js"
import type { FeedRunner } from "./Feeds.js"
import type { ProjectView } from "./Scan.js"
import type { Banner } from "./Snapshot.js"
import type { TerminalTab, TerminalView } from "./Terminal.js"

interface WorkspaceRouterContext {
  /** Every project with its worktrees and their statuses, as of now. */
  readonly projects: () => readonly ProjectView[]
  /** Problems with the workspace itself. */
  readonly banners: () => readonly Banner[]
  readonly actions: ActionRuns
  readonly feeds: FeedRunner
  readonly terminal: TerminalTab["driver"]
  /** Opens a shell pane, as the identity that sent the request. */
  readonly openShell: (project: string, worktree: string) => Promise<TerminalView>
  /** Proceed or Retry, as the identity that sent the request. */
  readonly press: (
    action: PressAction,
    input: { readonly worktree: string; readonly commit: string },
  ) => Promise<PressOutcome>
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
} as const

const refusals = async <A>(body: () => Promise<A>): Promise<A> => {
  try {
    return await body()
  } catch (error) {
    if (error instanceof ActionRefusal) {
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
  /** The Terminal tab: how to attach to the driver's pane. */
  terminal: t.procedure
    .input(worktreeInput)
    .query(({ ctx, input }) => refusals(() => ctx.terminal(input.project, input.worktree))),
  openShell: t.procedure
    .input(worktreeInput)
    .mutation(({ ctx, input }) => refusals(() => ctx.openShell(input.project, input.worktree))),
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

export type WorkspaceRouter = typeof workspaceRouter
