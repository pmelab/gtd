import type { WorkflowBase, Flow, ScopeAccess, Summary } from "../flows/index.js"
import type { Actor, ContentKind, StateName, StepAccess } from "../wire/index.js"

export type { Actor, ContentKind, StateName }

export type ChangeStatus = "A" | "M" | "D"

export interface PendingChange {
  readonly status: ChangeStatus
  readonly path: string
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
  readonly model?: string
  readonly system?: string
  readonly judge?: string
  readonly requireProgress?: boolean
  readonly answerGate?: boolean
  readonly requireRevert?: boolean
  readonly allowEmpty?: boolean
  readonly keep?: boolean
  /** A validator retry: the step's original prompt, `content` being the correction. */
  readonly original?: string
  readonly onFail?: "rest"
  readonly acceptClean?: boolean
  readonly approve?: boolean
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
  /** Bundled skill lists keyed by scope full name, given the process's resolved vars — the fallback beneath `configuredSkills` and a `scope()` option. */
  readonly skills: (
    vars: Readonly<Record<string, string>>,
  ) => Readonly<Record<string, readonly string[]>>
  /** `config.skills` entries by scope full name; they outrank a `scope()` option, which outranks `skills`. Their keys are checked against `skills` once the process's settings are known. */
  readonly configuredSkills: Readonly<Record<string, readonly string[]>>
  /** Bundled access keyed by scope full name, given the process's resolved vars — the fallback beneath `configuredAccess` and a `scope()` option. */
  readonly access: (vars: Readonly<Record<string, string>>) => Readonly<Record<string, ScopeAccess>>
  /** `config.access` entries by scope full name; they outrank a `scope()` option, which outranks `access`. */
  readonly configuredAccess: Readonly<Record<string, ScopeAccess>>
  /** The file the `skills`, `access` and `config` exports came from, for error reports. */
  readonly skillsOrigin: string
  /** The flow's first step on an ordinary start — where a finished episode waits. */
  readonly initial: StateName
}
