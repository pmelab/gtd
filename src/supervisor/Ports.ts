import { Context, Layer } from "effect"
import { liveRunInWorktree, type SpawnOutcome } from "../ui/index.js"
import { worktrunk } from "../workspace-adapters/index.js"
import type { WorktreesAdapter } from "../workspace/index.js"

/**
 * What the supervisor reaches outside its process besides the adapters a
 * workspace configures. The in-memory twin answers `gtd next` from a table.
 */
interface SupervisorHostOps {
  /** `gtd next --json`, run in the worktree as its own subprocess. */
  readonly next: (worktree: string) => Promise<SpawnOutcome>
  /** The worktrees adapter of a workspace that names none. */
  readonly defaultWorktrees: (root: string) => WorktreesAdapter
  readonly isPidAlive: (pid: number) => boolean
}

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

export class SupervisorHost extends Context.Service<SupervisorHost, SupervisorHostOps>()(
  "SupervisorHost",
) {
  static readonly Live = Layer.succeed(SupervisorHost, {
    next: (worktree) => liveRunInWorktree(worktree, "gtd next --json"),
    // Each directory at the workspace root that is a repository's main checkout.
    defaultWorktrees: (root) => worktrunk({ roots: [`${root}/*`] }),
    isPidAlive,
  })
}
