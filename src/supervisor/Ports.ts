import { execFile } from "node:child_process"
import { watch } from "node:fs"
import { basename, dirname } from "node:path"
import { Context, Layer } from "effect"
import { liveRunInWorktree, type SpawnOutcome } from "../ui/index.js"
import { mise, pitchfork, rex, worktrunk } from "../workspace-adapters/index.js"
import type {
  ActionsAdapter,
  ExecResult,
  ServicesAdapter,
  TerminalAdapter,
  WorktreesAdapter,
} from "../workspace/index.js"

/**
 * What the supervisor reaches outside its process besides the adapters a
 * workspace configures. The in-memory twin answers `gtd next` from a table.
 */
interface SupervisorHostOps {
  /** `gtd next --json`, run in the worktree as its own subprocess. */
  readonly next: (worktree: string) => Promise<SpawnOutcome>
  /** The worktrees adapter of a workspace that names none. */
  readonly defaultWorktrees: (root: string) => WorktreesAdapter
  /** The terminal adapter of a workspace that names none. */
  readonly defaultTerminal: () => TerminalAdapter
  /** The services adapter of a workspace that names none. */
  readonly defaultServices: () => ServicesAdapter
  /** The actions adapter of a workspace that names none. */
  readonly defaultActions: () => ActionsAdapter
  readonly isPidAlive: (pid: number) => boolean
  /** Runs `run` once after `ms`; the result cancels it. The twin's clock moves only when a test moves it. */
  readonly after: (ms: number, run: () => void) => () => void
  /** Calls `changed` after `file` was written; the result stops watching. */
  readonly watchFile: (file: string, changed: () => Promise<void>) => () => void
}

// An editor's save is several events (write, rename, chmod); one call after they stop covers them.
const SAVE_SETTLE_MS = 200

const watchFile = (file: string, changed: () => Promise<void>): (() => void) => {
  let timer: NodeJS.Timeout | undefined
  // The directory, not the file: an editor that saves by rename replaces the watched inode.
  const watcher = watch(dirname(file), (_event, name) => {
    if (name !== basename(file)) return
    clearTimeout(timer)
    timer = setTimeout(() => void changed(), SAVE_SETTLE_MS)
  })
  watcher.on("error", () => {})
  return () => {
    clearTimeout(timer)
    watcher.close()
  }
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
    defaultTerminal: () => rex(),
    defaultServices: () => pitchfork(),
    defaultActions: () => mise(),
    isPidAlive,
    after: (ms, run) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    },
    watchFile,
  })
}

/** The tools a feed's `ctx` lends; tests answer them from a table. */
interface UserlandToolsOps {
  readonly exec: (argv: readonly string[], cwd: string) => Promise<ExecResult>
  readonly fetch: typeof globalThis.fetch
}

const exec = (argv: readonly string[], cwd: string): Promise<ExecResult> =>
  new Promise((resolve, reject) => {
    const [file, ...args] = argv
    if (file === undefined) return reject(new Error("exec: argv is empty"))
    execFile(file, args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      // A string code (ENOENT, …) means the command never ran.
      if (error !== null && typeof error.code !== "number") return reject(error)
      resolve({ status: error === null ? 0 : (error.code as number), stdout, stderr })
    })
  })

export class UserlandTools extends Context.Service<UserlandTools, UserlandToolsOps>()(
  "UserlandTools",
) {
  static readonly Live = Layer.succeed(UserlandTools, { exec, fetch: globalThis.fetch })
}

/** Time for the supervisor's schedules; tests move it by hand. */
interface SupervisorClockOps {
  readonly now: () => number
  /** Runs `task` now and then every `ms`, until the returned function cancels it. */
  readonly every: (ms: number, task: () => Promise<void>) => () => void
}

export class SupervisorClock extends Context.Service<SupervisorClock, SupervisorClockOps>()(
  "SupervisorClock",
) {
  static readonly Live = Layer.succeed(SupervisorClock, {
    now: () => Date.now(),
    every: (ms, task) => {
      void task()
      const timer = setInterval(() => void task(), ms)
      return () => clearInterval(timer)
    },
  })
}
