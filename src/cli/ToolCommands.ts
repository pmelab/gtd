import { Context } from "effect"
import type { Effect } from "effect"
import type { UiSettings } from "../flows/index.js"
import type { ContextHookRequest } from "../wire/index.js"

/** How to run THIS gtd — a driver (the loop, the LSP) never reads a different version's state than the one it ships with. */
export type SelfGtd = readonly [string, ...string[]]

export interface UiRequest {
  readonly flags: {
    readonly host?: string
    readonly port?: number
    readonly selfSigned: boolean
    readonly dev: boolean
  }
  readonly config: UiSettings | undefined
  readonly root: string
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
export class ToolCommands extends Context.Tag("ToolCommands")<
  ToolCommands,
  {
    readonly ui: (
      request: UiRequest,
      out: { readonly write: (chunk: string) => void; readonly flush: () => void },
    ) => Effect.Effect<void, Error>
    readonly lsp: (gtd: SelfGtd) => Effect.Effect<void, Error>
    readonly loop: (gtd: SelfGtd) => Effect.Effect<void, Error>
    /** The hook's stdout: a JSON document, or empty to let the turn go on. */
    readonly contextHook: (request: ContextHookRequest) => Effect.Effect<string, Error>
    readonly judge: (request: JudgeRequest) => Promise<string>
  }
>() {}
