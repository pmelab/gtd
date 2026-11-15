import {
  isAdapterFailure,
  type AdapterFailure,
  type Service,
  type Worktree,
  type WorktreesAdapter,
  type WorkspaceSettings,
} from "../workspace/index.js"
import type { SpawnOutcome } from "../ui/index.js"
import { gatePath } from "./Gate.js"
import { worktreeStatus, type WorktreeStatus } from "./Status.js"

export interface WorktreeView extends WorktreeStatus {
  readonly path: string
  readonly branch?: string
  readonly head: string
  readonly main: boolean
  /** The worktree's services, once the services adapter has listed them. */
  readonly services?: readonly Service[]
  /** The services adapter could not list them. */
  readonly servicesFailure?: AdapterFailure
  /** The path of the worktree's gate page. */
  readonly gate: string
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
}

// `gtd next` costs a process and a replay each; a few at a time keeps a large
// workspace from starving the machine.
const NEXT_CONCURRENCY = 4

export const mapLimited = async <A, B>(
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
export const recheck = (deps: Pick<ScanDeps, "next">, worktree: string): Promise<WorktreeStatus> =>
  deps.next(worktree).then(worktreeStatus)

/** Every worktree of every project, each with its worktree status. */
export const scan = async (deps: ScanDeps): Promise<readonly ProjectView[]> => {
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
  const all = listed.flatMap((p) => p.worktrees)
  const statuses = await mapLimited(all, NEXT_CONCURRENCY, (w) => recheck(deps, w.path))
  const statusOf = new Map(all.map((w, i) => [w, statuses[i]!]))
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
