import { initTRPC } from "@trpc/server"
import type { ProjectView } from "./Scan.js"

interface WorkspaceRouterContext {
  /** Every project with its worktrees and their statuses, as of now. */
  readonly projects: () => Promise<readonly ProjectView[]>
}

const t = initTRPC.context<WorkspaceRouterContext>().create()

/** The dashboard's API, served under `/trpc`. */
export const workspaceRouter = t.router({
  projects: t.procedure.query(({ ctx }) => ctx.projects()),
})
