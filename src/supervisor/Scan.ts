import {
  isAdapterFailure,
  type AdapterFailure,
  type Worktree,
  type WorktreesAdapter,
  type WorkspaceSettings,
} from "../workspace/index.js"
import type { SpawnOutcome } from "../ui/index.js"
import type { ActionRun } from "./Actions.js"
import type { Drivers } from "./Drivers.js"
import { gatePath } from "./Gate.js"
import { isOrphan, worktreeStatus, type DriverState, type WorktreeStatus } from "./Status.js"

export interface WorktreeView extends WorktreeStatus {
  readonly path: string
  readonly branch?: string
  readonly head: string
  readonly main: boolean
  /** The path of the worktree's gate page. */
  readonly gate: string
  /** The last action gtd ran here while this supervisor runs. */
  readonly action?: ActionRun
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

// `gtd next` costs a process and a replay each; a few at a time keeps a large
// workspace from starving the machine.
const NEXT_CONCURRENCY = 4

const mapLimited = async <A, B>(
  items: readonly A[],
  limit: number,
  f: (item: A) => Promise<B>,
): Promise<B[]> => {
  const results: B[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await f(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

const asFailure = (op: string, error: unknown): AdapterFailure =>
  isAdapterFailure(error)
    ? error
    : {
        adapter: "worktrees",
        op,
        message: error instanceof Error ? error.message : String(error),
      }

const byPath = (a: Worktree, b: Worktree): number =>
  Number(b.main) - Number(a.main) || a.path.localeCompare(b.path)

/** One worktree's status as of now. */
export const recheck = async (
  deps: Pick<ScanDeps, "next" | "drivers">,
  worktree: string,
): Promise<WorktreeStatus> =>
  worktreeStatus(await deps.next(worktree), await deps.drivers.state(worktree))

interface Surveyed {
  readonly project: string
  readonly worktree: Worktree
  readonly next: SpawnOutcome
  readonly driver: DriverState
}

const survey = async (deps: ScanDeps) => {
  const projects = [...(await deps.worktrees.projects())].sort((a, b) => a.id.localeCompare(b.id))
  const listed = await Promise.all(
    projects.map(async (project) => {
      const name = deps.settings.projects?.[project.id]?.name ?? project.id
      try {
        const worktrees = [...(await deps.worktrees.list(project.id))].sort(byPath)
        return { id: project.id, name, worktrees }
      } catch (error) {
        return { id: project.id, name, worktrees: [], failure: asFailure("list", error) }
      }
    }),
  )
  const all = listed.flatMap((p) => p.worktrees.map((worktree) => ({ project: p.id, worktree })))
  const surveyed = await mapLimited(
    all,
    NEXT_CONCURRENCY,
    async ({ project, worktree }): Promise<Surveyed> => ({
      project,
      worktree,
      next: await deps.next(worktree.path),
      driver: await deps.drivers.state(worktree.path),
    }),
  )
  return { listed, surveyed }
}

/** Every worktree of every project, each with its worktree status. */
export const scan = async (deps: ScanDeps): Promise<readonly ProjectView[]> => {
  const { listed, surveyed } = await survey(deps)
  const statusOf = new Map(surveyed.map((s) => [s.worktree, worktreeStatus(s.next, s.driver)]))
  return listed.map((project) => ({
    ...project,
    worktrees: project.worktrees.map((w) => ({
      path: w.path,
      ...(w.branch !== undefined ? { branch: w.branch } : {}),
      head: w.head,
      main: w.main,
      gate: gatePath(project.id, w),
      ...statusOf.get(w)!,
    })),
  }))
}

/** Starts the driver of each worktree that waits for an agent or a check with none running. */
export const restartOrphans = async (deps: ScanDeps): Promise<void> => {
  const { surveyed } = await survey(deps)
  for (const s of surveyed) {
    if (isOrphan(s.next, s.driver)) await deps.drivers.start(s.project, s.worktree.path)
  }
}
