import type { NetworkInterfaceInfo } from "node:os"
import { Context, type Effect, Layer } from "effect"

// ui reaches the rest of gtd only through the `gtd` binary and wire, so its
// errors and ports are its own; the composition root maps them onto the
// CLI's (`GtdUsageError` → exit 2) and provides the live services.

export class UiError extends Error {
  readonly detail: readonly string[]

  constructor(message: string, detail: readonly string[] = []) {
    super(message)
    this.name = "UiError"
    this.detail = detail
  }
}

/** A refusal the user can fix by invoking `gtd ui` differently — the CLI exits with its usage code. */
export class UiUsageError extends UiError {
  constructor(message: string, detail: readonly string[] = []) {
    super(message, detail)
    this.name = "UiUsageError"
  }
}

interface ShellOutcome {
  readonly status: number | null
  /** stdout then stderr, merged. */
  readonly output: string
  readonly stdout?: string
  readonly stderr?: string
}

/** One `bash -c` run in the served worktree. A spawn failure fails the Effect; a non-zero exit is a value. */
export class UiShell extends Context.Service<
  UiShell,
  { readonly bash: (command: string) => Effect.Effect<ShellOutcome, Error> }
>()("UiShell") {
  static readonly layer = (
    bash: (command: string) => Effect.Effect<ShellOutcome, Error>,
  ): Layer.Layer<UiShell> => Layer.succeed(UiShell, { bash })
}

/** One subprocess's outcome — `spawnError` set (never `status`/`stdout`/`stderr`) when the process could never start at all (no `bash`, bad cwd), so callers can tell "never ran" from "ran and exited non-zero". */
export interface SpawnOutcome {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
  readonly spawnError?: string
}

export type RunInWorktree = (cwd: string, command: string) => Promise<SpawnOutcome>

export type ReadFileResult =
  | { readonly kind: "content"; readonly content: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable" }

/** The ownership record published alongside a live serve mapping, so teardown/orphan-checks touch only a mapping THIS instance published. `worktree` is plumbed through verbatim — the caller (Task 3/4) decides what path it holds. */
export interface ServeRecord {
  readonly pid: number
  readonly servePort: number
  readonly targetPort: number
  readonly target: string
  readonly worktree: string
}

/**
 * One request in, one response out. `afterResponse` runs a callback once the
 * response has reached the client — a hand-off must not end the server
 * before its own reply is out.
 */
export type UiHandler = (
  request: Request,
  afterResponse: (callback: () => void) => void,
) => Promise<Response>

/**
 * Everything `gtd ui` reaches outside its process: the worktree it serves
 * and the machine it runs on. `UiHost.Live` is the real one; an in-memory
 * twin answers from a fake repository, and `tests/tooling/ui-host.test.ts`
 * holds the two to the same answers.
 */
export interface UiHostOps {
  /** `bash -c <command>` in `cwd`, with `<cwd>/node_modules/.bin` first on `$PATH`. */
  readonly run: RunInWorktree
  readonly headSha: (worktree: string) => Promise<string | undefined>
  /** The `@pmelab/gtd` version installed in `worktree`, if any. */
  readonly readLocalGtdVersion: (worktree: string) => Promise<string | undefined>
  readonly readFile: (absPath: string) => Promise<ReadFileResult>
  /** Creates the file's directory first. */
  readonly writeFile: (absPath: string, content: string) => Promise<void>
  readonly networkInterfaces: () => NodeJS.Dict<NetworkInterfaceInfo[]>
  /** `~/.gtd/serve/<port>.json`: which `gtd ui` published which serve port. */
  readonly serveRecords: {
    readonly read: (servePort: number) => ServeRecord | undefined
    readonly write: (servePort: number, record: ServeRecord) => void
    readonly delete: (servePort: number) => void
  }
  readonly isPidAlive: (pid: number) => boolean
  /**
   * A fresh scratch directory for `body` — a command it runs may write files
   * there, which `read` reads back — removed afterwards whatever happens.
   */
  readonly scratch: <A, E, R>(
    body: (dir: string, read: (name: string) => string) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
}

export class UiHost extends Context.Service<UiHost, UiHostOps>()("UiHost") {}
