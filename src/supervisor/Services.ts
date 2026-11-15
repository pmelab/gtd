import { isAdapterFailure, type ServicesAdapter } from "../workspace/index.js"
import type { WorktreeView } from "./Scan.js"

export type ServicesView = Pick<WorktreeView, "services" | "servicesFailure">

/** The services the adapter lists for the worktree, or why it could not. */
export const listServices = async (
  services: ServicesAdapter,
  project: string,
  path: string,
): Promise<ServicesView> => {
  try {
    return { services: await services.list(project, path) }
  } catch (error) {
    return {
      services: [],
      servicesFailure: isAdapterFailure(error)
        ? error
        : {
            adapter: "services",
            op: "list",
            message: error instanceof Error ? error.message : String(error),
          },
    }
  }
}
