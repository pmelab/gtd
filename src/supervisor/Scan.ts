import {
  isAdapterFailure,
  type AdapterFailure,
  type Worktree,
  type WorktreesAdapter,
  type WorkspaceSettings,
} from "../workspace/index.js"
import type { SpawnOutcome } from "../ui/index.js"
import type { Drivers } from "./Drivers.js"
import type { WorktreeStatus } from "./Status.js"

export interface WorktreeView extends WorktreeStatus {
  readonly path: string
  readonly branch?: string
  readonly head: string
  readonly main: boolean
  /** The path of the worktree's gate page. */
  readonly gate: string
  /** The adapter read that failed: the status is the last one known, shown greyed. */
  readonly unavailable?: AdapterFailure
}

export interface ProjectView {
  readonly id: string
  /** `projects.<id>.name`, else the id. */
  readonly name: string
  readonly worktrees: readonly WorktreeView[]
  /** The worktrees adapter could not list this project. */
  readonly failure?: AdapterFailure
}

export interface ScanDeps {
  readonly worktrees: WorktreesAdapter
  /** `gtd next --json`, run in the worktree. */
  readonly next: (worktree: string) => Promise<SpawnOutcome>
  readonly settings: WorkspaceSettings
  readonly drivers: Drivers
}

export const asFailure = (op: string, error: unknown): AdapterFailure =>
  isAdapterFailure(error)
    ? error
    : {
        adapter: "worktrees",
        op,
        message: error instanceof Error ? error.message : String(error),
      }

export const byPath = (a: Worktree, b: Worktree): number =>
  Number(b.main) - Number(a.main) || a.path.localeCompare(b.path)
