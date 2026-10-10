import type { WorkflowBase, Flow, ScopeAccess, Summary } from "../flows/index.js"
import type { Actor, ContentKind, StateMode, StateName, StepAccess } from "../wire/index.js"

export type { Actor, ContentKind, StateMode, StateName }

export type ChangeStatus = "A" | "M" | "D"

export interface PendingChange {
  readonly status: ChangeStatus
  readonly path: string
}

/**
 * One steering-file mode: shell commands (reading the file from `$GTD_FILE`) that
 * format and validate a file of this format. Both run at the edge, never in
 * the engine.
 */
export interface ModeDef {
  readonly format?: string
  readonly validate?: string
}

/**
 * The rest a process waits at, described for the edge: who acts, its one
 * content kind, and the steering-file options the guards and the wire read.
 * Built from the step replay reached — never authored.
 */
export interface StepDef {
  readonly actor: Actor
  readonly kind: ContentKind
  readonly content: string
  readonly label?: string
  readonly file?: string
  readonly mode?: StateMode
  readonly model?: string
  readonly system?: string
  readonly judge?: string
  readonly requireProgress?: boolean
  readonly answerGate?: boolean
  readonly requireRevert?: boolean
  readonly allowEmpty?: boolean
  readonly acceptClean?: boolean
  readonly skills?: readonly string[]
  readonly access?: StepAccess
}

/**
 * The loaded workflow module: its default export is the flow, and `summary`
 * and `base` are the optional named exports the engine reads. Every other
 * export is the module's own business — helpers other workflows import.
 */
export interface WorkflowDefinition {
  readonly flow: Flow
  readonly summary?: Summary | undefined
  readonly base?: WorkflowBase | undefined
  /** Steering files by path, with their mode — what the LSP knows before a step declaring one is reached. */
  readonly steering: Readonly<Record<string, StateMode>>
  /** Every mode a step may name: the built-in registry merged with `.gtdrc` `modes:`. */
  readonly modes: Readonly<Record<StateMode, ModeDef>>
  /** Bundled skill lists keyed by scope full name, given the process's resolved vars — the fallback beneath `configuredSkills` and a `scope()` option. */
  readonly skills: (
    vars: Readonly<Record<string, string>>,
  ) => Readonly<Record<string, readonly string[]>>
  /** `.gtdrc` `skills:` entries by scope full name; they outrank a `scope()` option, which outranks `skills`. */
  readonly configuredSkills: Readonly<Record<string, readonly string[]>>
  /** Every well-shaped `.gtdrc` `skills:` key with its file, checked against `skills` once the process's settings are known. */
  readonly skillsKeys: readonly { readonly key: string; readonly origin: string }[]
  /** Bundled access keyed by scope full name, given the process's resolved vars — the fallback beneath `configuredAccess` and a `scope()` option. */
  readonly access: (vars: Readonly<Record<string, string>>) => Readonly<Record<string, ScopeAccess>>
  /** `.gtdrc` `access:` entries by scope full name; they outrank a `scope()` option, which outranks `access`. */
  readonly configuredAccess: Readonly<Record<string, ScopeAccess>>
  /** Every well-shaped `.gtdrc` `access:` key with its file, checked once the process's settings are known. */
  readonly accessKeys: readonly { readonly key: string; readonly origin: string }[]
  /** The scopes every OTHER loaded file gives skills or access to, each on its own settings — a `.gtdrc` key may name them too. */
  readonly knownScopes?: () => readonly string[]
  /** The file the `skills` and `access` exports came from, for error reports. */
  readonly skillsOrigin: string
  /** The flow's first step on an ordinary start — where a finished episode waits. */
  readonly initial: StateName
}

export const knownModes = (def: Pick<WorkflowDefinition, "modes">): readonly StateMode[] =>
  Object.keys(def.modes)
