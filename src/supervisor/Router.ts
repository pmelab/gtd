import { initTRPC } from "@trpc/server"
import type { ProjectView } from "./Scan.js"
import type { Banner } from "./Snapshot.js"

interface WorkspaceRouterContext {
  /** Every project with its worktrees and their statuses, as of now. */
  readonly projects: () => readonly ProjectView[]
  /** Problems with the workspace itself. */
  readonly banners: () => readonly Banner[]
}

const t = initTRPC.context<WorkspaceRouterContext>().create()

/** The dashboard's API, served under `/trpc`. */
export const workspaceRouter = t.router({
  projects: t.procedure.query(({ ctx }) => ctx.projects()),
  banners: t.procedure.query(({ ctx }) => ctx.banners()),
})
