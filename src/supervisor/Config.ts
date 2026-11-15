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

/** A `gtd.workspace.ts` that does not evaluate or does not check out. */
class WorkspaceConfigError extends UiError {
  constructor(
    file: string,
    readonly findings: readonly string[],
  ) {
    super(`gtd: config:\n${findings.map((finding) => `  - ${file}: ${finding}`).join("\n")}`)
  }
}

const configError = (file: string, findings: readonly string[]): UiError =>
  new WorkspaceConfigError(file, findings)

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

export interface WorkspaceReload {
  /** Why the last reload failed, until one succeeds. */
  readonly failure: () => string | undefined
  readonly close: () => void
}

/**
 * Loads `file` again after each change and hands each good load to `apply`.
 * A bad one leaves the config as it was: an edit never takes the supervisor down.
 */
export const reloadWorkspace = (options: {
  readonly file: string
  readonly load: () => Promise<LoadedWorkspace>
  readonly watchFile: (file: string, changed: () => Promise<void>) => () => void
  readonly apply: (loaded: LoadedWorkspace) => void
}): WorkspaceReload => {
  let failure: string | undefined
  let queue = Promise.resolve()
  const reload = async (): Promise<void> => {
    try {
      options.apply(await options.load())
      failure = undefined
    } catch (error) {
      failure =
        error instanceof WorkspaceConfigError
          ? error.findings.join("; ")
          : error instanceof Error
            ? error.message
            : String(error)
    }
  }
  // Loads run one at a time, so the last change is the one that stays.
  const changed = (): Promise<void> => (queue = queue.then(reload))
  return { failure: () => failure, close: options.watchFile(options.file, changed) }
}
