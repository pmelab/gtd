import { Context } from "effect"
import type { Effect } from "effect"
import type { UiSettings } from "../flows/index.js"
import type { HostOps } from "../platform/index.js"

export interface UiRequest {
  readonly flags: {
    readonly host?: string
    readonly port?: number
    readonly selfSigned: boolean
    readonly http?: boolean
    readonly dev: boolean
  }
  readonly config: UiSettings | undefined
  readonly root: string
}

interface WorkspaceRequest {
  readonly flags: {
    readonly config?: string
    readonly host?: string
    readonly port?: number
    readonly selfSigned: boolean
    readonly http?: boolean
  }
  /** Where the innermost `gtd.workspace.ts` lookup starts, and what `--config` is relative to. */
  readonly cwd: string
  /** `$XDG_STATE_HOME`, else `~/.local/state`: the supervisor's state lives below it. */
  readonly stateHome: string
  /** This gtd's version: the dashboard's service worker cache and reload check use it. */
  readonly version: string
  /** Evaluates a TypeScript module the way `gtd.config.ts` is, `@pmelab/gtd/*` served by this gtd. */
  readonly loadModule: (path: string) => Promise<Readonly<Record<string, unknown>>>
}

/** No fields means the workspace pause. */
interface PauseScope {
  readonly project?: string
  readonly feed?: string
}

/** `gtd workspace proceed|retry|note|pause|resume`: a request for the running supervisor. */
export interface WorkspaceControlRequest {
  readonly request:
    | {
        readonly command: "proceed" | "retry"
        readonly worktree: string
        readonly commit: string
      }
    | {
        readonly command: "note"
        readonly worktree: string
        readonly note: {
          readonly message: string
          readonly error: boolean
          /** Also send it as a notification. */
          readonly notify?: boolean
        } | null
      }
    | { readonly command: "paused" }
    | {
        readonly command: "pause" | "resume"
        readonly project?: string
        readonly feed?: string
        readonly wait?: boolean
      }
  readonly config?: string
  readonly cwd: string
  readonly stateHome: string
}

interface WorkspaceNowRequest {
  readonly config?: string
  readonly cwd: string
  readonly stateHome: string
  readonly loadModule: (path: string) => Promise<Readonly<Record<string, unknown>>>
}

interface JudgeRequest {
  readonly provider: "fixed" | "jev" | "llm" | undefined
  readonly answers?: string | undefined
  readonly model?: string | undefined
  readonly cwd: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly input: string
}

/**
 * The subcommands backed by a driver or tool. Core may not import those
 * units, so the composition root provides them here.
 */
export class ToolCommands extends Context.Service<
  ToolCommands,
  {
    readonly ui: (
      request: UiRequest,
      out: { readonly write: (chunk: string) => void; readonly flush: () => void },
    ) => Effect.Effect<void, Error>
    readonly workspace: (
      request: WorkspaceRequest,
      out: { readonly write: (chunk: string) => void; readonly flush: () => void },
    ) => Effect.Effect<void, Error>
    readonly workspaceControl: (
      request: WorkspaceControlRequest,
    ) => Effect.Effect<readonly PauseScope[] | undefined, Error>
    /** `gtd workspace now`: the Now view in the terminal. */
    readonly workspaceNow: (request: WorkspaceNowRequest) => Effect.Effect<void, Error>
    /** `gtd` runs THIS gtd, so the LSP never reads a different version's state than the one it ships with. */
    readonly lsp: (gtd: HostOps["self"]) => Effect.Effect<void, Error>
    readonly judge: (request: JudgeRequest) => Promise<string>
  }
>()("ToolCommands") {}
