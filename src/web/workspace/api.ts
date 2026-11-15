import { createTRPCReact } from "@trpc/react-query"
import type { WorkspaceRouter } from "../../supervisor/index.js"

/** The dashboard's tRPC client, typed by the supervisor's router. */
export const workspaceTrpc = createTRPCReact<WorkspaceRouter>()

/** Whether the server's page asks for the workspace dashboard rather than one worktree's gate page. */
export const isDashboard = (doc: Document): boolean =>
  doc.querySelector<HTMLMetaElement>('meta[name="gtd-page"]')?.content === "workspace"
