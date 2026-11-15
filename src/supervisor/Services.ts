import { isAdapterFailure, type AdapterFailure, type ServicesAdapter } from "../workspace/index.js"
import { mapLimited, type ProjectView, type WorktreeView } from "./Scan.js"

// The pitchfork default costs a process per worktree.
const LIST_CONCURRENCY = 4

const asFailure = (error: unknown): AdapterFailure =>
  isAdapterFailure(error)
    ? error
    : {
        adapter: "services",
        op: "list",
        message: error instanceof Error ? error.message : String(error),
      }

/** Each worktree with the services the adapter lists for it, or why it could not. */
export const withServices = async (
  projects: readonly ProjectView[],
  services: ServicesAdapter,
): Promise<readonly ProjectView[]> => {
  const all = projects.flatMap((p) => p.worktrees.map((w) => ({ project: p.id, worktree: w })))
  const listed = await mapLimited(
    all,
    LIST_CONCURRENCY,
    async ({ project, worktree }): Promise<WorktreeView> => {
      try {
        return { ...worktree, services: await services.list(project, worktree.path) }
      } catch (error) {
        return { ...worktree, services: [], servicesFailure: asFailure(error) }
      }
    },
  )
  const viewOf = new Map(all.map(({ worktree }, i) => [worktree, listed[i]!]))
  return projects.map((p) => ({ ...p, worktrees: p.worktrees.map((w) => viewOf.get(w)!) }))
}
