import {
  isAdapterFailure,
  type AdapterFailure,
  type Service,
  type Worktree,
  type WorktreesAdapter,
  type WorkspaceSettings,
} from "../workspace/index.js"
import type { SpawnOutcome } from "../ui/index.js"
import type { ActionRun } from "./Actions.js"
import type { Drivers } from "./Drivers.js"
import type { Note } from "./Notes.js"
import type { WorktreeStatus } from "./Status.js"

export interface WorktreeView extends WorktreeStatus {
  readonly path: string
  readonly branch?: string
  readonly description?: string
  readonly head: string
  readonly main: boolean
  /** The worktree's services, once the services adapter has listed them. */
  readonly services?: readonly Service[]
  /** The services adapter could not list them. */
  readonly servicesFailure?: AdapterFailure
  /** The path of the worktree's gate page. */
  readonly gate: string
  /** The gate kind, from the steering file's name: "Review", "Requirements". */
  readonly gateKind?: string
  /** A review gate's base, as a short sha. */
  readonly gateBase?: string
  /** Why gtd or the driver refused the last Proceed or Retry at this HEAD. */
  readonly refusal?: string
  /** The adapter read that failed: the status is the last one known, shown greyed. */
  readonly unavailable?: AdapterFailure
  /** The last action gtd ran here while this supervisor runs. */
  readonly action?: ActionRun
  /** The last `gtd workspace note` on this worktree. */
  readonly note?: Note
}

export interface ProjectView {
  readonly id: string
  /** `projects.<id>.name`, else the id. */
  readonly name: string
  /** `nameWorktree` is configured: New worktree asks for a description. */
  readonly namesWorktrees?: boolean
  readonly worktrees: readonly WorktreeView[]
  /** The worktrees adapter could not list this project. */
  readonly failure?: AdapterFailure
  /** Why the last clean pass could not bring the main checkout up to date. */
  readonly mainStale?: string
}

export interface ScanDeps {
  readonly worktrees: WorktreesAdapter
  /** `gtd next --json`, run in the worktree. */
  readonly next: (worktree: string) => Promise<SpawnOutcome>
  /** The config as last loaded: a reload changes it. */
  readonly settings: () => WorkspaceSettings
  readonly drivers: Drivers
  /** Names, sizes and mtimes of the worktree's `.gtd/`, its index and its partner branch tip, read in-process. */
  readonly fingerprint?: (worktree: string) => Promise<string>
  /** A file's text, or `undefined` when it cannot be read. */
  readonly readFile?: (path: string) => Promise<string | undefined>
}

/** A plain object: an `AdapterError`'s message would not survive JSON. */
export const asFailure = (op: string, error: unknown, adapter = "worktrees"): AdapterFailure =>
  isAdapterFailure(error)
    ? {
        adapter: error.adapter,
        op: error.op,
        message: error.message,
        ...(error.detail !== undefined ? { detail: error.detail } : {}),
      }
    : { adapter, op, message: error instanceof Error ? error.message : String(error) }

export const byPath = (a: Worktree, b: Worktree): number =>
  Number(b.main) - Number(a.main) || a.path.localeCompare(b.path)
