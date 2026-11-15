import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { UiError } from "../ui/index.js"
import {
  formatWorkspaceProblem,
  workspaceProblems,
  type WorkspaceSettings,
  type Feed,
} from "../workspace/index.js"
import { isFeed } from "../workspace/internal.js"

const WORKSPACE_MODULE = "gtd.workspace.ts"

export interface LoadedWorkspace {
  /** The directory of `gtd.workspace.ts`. */
  readonly root: string
  readonly file: string
  readonly settings: WorkspaceSettings
  /** The `feed()` exports, by export name. */
  readonly feeds: ReadonlyMap<string, Feed>
}

/** `--config`, else the innermost `gtd.workspace.ts` from `cwd` up. */
export const findWorkspaceModule = (cwd: string, explicit: string | undefined): string => {
  if (explicit !== undefined) {
    const file = resolve(cwd, explicit)
    if (!existsSync(file)) throw new UiError(`gtd workspace: no config at ${file}`)
    return file
  }
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const file = join(dir, WORKSPACE_MODULE)
    if (existsSync(file)) return file
    if (dirname(dir) === dir) break
  }
  throw new UiError(`gtd workspace: no ${WORKSPACE_MODULE} in ${cwd} or above it`, [
    "write one at the workspace root, or pass --config <path>",
  ])
}

const configError = (file: string, findings: readonly string[]): UiError =>
  new UiError(`gtd: config:\n${findings.map((finding) => `  - ${file}: ${finding}`).join("\n")}`)

/** Evaluates `file` and checks its `workspace` export at every depth. */
export const loadWorkspace = async (
  file: string,
  loadModule: (path: string) => Promise<Readonly<Record<string, unknown>>>,
): Promise<LoadedWorkspace> => {
  let exports: Readonly<Record<string, unknown>>
  try {
    exports = await loadModule(file)
  } catch (error) {
    throw configError(file, [error instanceof Error ? error.message : String(error)])
  }
  const settings = exports["workspace"] ?? {}
  const problems = workspaceProblems(settings)
  if (problems.length > 0) throw configError(file, problems.map(formatWorkspaceProblem))
  const feeds = new Map(
    Object.entries(exports).filter((entry): entry is [string, Feed] => isFeed(entry[1])),
  )
  return { root: dirname(file), file, settings: settings as WorkspaceSettings, feeds }
}
