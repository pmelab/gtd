import type { FlowGraph } from "./analyze/index.js"
import type { Workflow } from "./flows/index.js"
import type { Actor, ContentKind, StateMode, StateName } from "./wire/index.js"

export type { Actor, ContentKind, StateMode, StateName }

/** gtd's plumbing directory — every steering file lives under it. */
export const STATE_DIR = ".gtd"

export type ChangeStatus = "A" | "M" | "D"

export interface PendingChange {
  readonly status: ChangeStatus
  readonly path: string
}

/**
 * One steering-file mode: shell commands (Eta templates over `it.file`) that
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
  readonly skills?: string
  readonly judge?: string
  readonly requireProgress?: boolean
  readonly answerGate?: boolean
  readonly requireRevert?: boolean
  readonly allowEmpty?: boolean
  readonly acceptClean?: boolean
  /** The step's `run` body, when it is a callback `gtd exec` runs rather than a script. */
  readonly callback?: boolean
}

/** The loaded workflow: its entries, its step graph, and the modes its steering files use. */
export interface WorkflowDefinition {
  readonly flows: Workflow
  readonly graph: FlowGraph
  /** Every mode a step may name: the built-in registry merged with `.gtdrc` `modes:`. */
  readonly modes: Readonly<Record<StateMode, ModeDef>>
  /** The default entry's first step — where a finished episode waits. */
  readonly initial: StateName
  /** Every entry but `default`, reachable as `gtd --entry <name>`. */
  readonly manual: readonly string[]
}

export const knownModes = (def: Pick<WorkflowDefinition, "modes">): readonly StateMode[] =>
  Object.keys(def.modes)
