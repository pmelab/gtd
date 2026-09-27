import type { Workflow } from "./flows/index.js"
import type { Actor, ContentKind, StateMode, StateName } from "./wire/index.js"

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
}

/** The loaded workflow: its entries and the modes its steering files use. */
export interface WorkflowDefinition {
  readonly flows: Workflow
  /** Every mode a step may name: the built-in registry merged with `.gtdrc` `modes:`. */
  readonly modes: Readonly<Record<StateMode, ModeDef>>
  /** The flow's first step on an ordinary start — where a finished episode waits. */
  readonly initial: StateName
}

export const knownModes = (def: Pick<WorkflowDefinition, "modes">): readonly StateMode[] =>
  Object.keys(def.modes)
