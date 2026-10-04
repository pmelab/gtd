import type { EntryBase, Flow, Summary } from "./flows/index.js"
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
  readonly skills?: readonly string[]
}

/**
 * The loaded workflow module: its default export is the flow, and `summary`
 * and `base` are the optional named exports the engine reads. Every other
 * export is the module's own business — helpers other workflows import.
 */
export interface WorkflowDefinition {
  readonly flow: Flow
  readonly summary?: Summary | undefined
  readonly base?: EntryBase | undefined
  /** Steering files by path, with their mode — what the LSP knows before a step declaring one is reached. */
  readonly steering: Readonly<Record<string, StateMode>>
  /** Every mode a step may name: the built-in registry merged with `.gtdrc` `modes:`. */
  readonly modes: Readonly<Record<StateMode, ModeDef>>
  /** Every step's bundled skill list, keyed by full name: the workflow's own `skills` export — the fallback tier beneath `configuredSkills` and a step's own option. `skillsFor` reads this for a prompt preamble. */
  readonly skills: Readonly<Record<string, readonly string[]>>
  /**
   * The SUBSET of `skills` that came from `.gtdrc` `skills:` itself, not the
   * workflow's own bundled defaults — what the wire resolver overrides a
   * flow-supplied `skills` option with. Without this split, a bundled
   * default (even an empty one, like `build.quality.reviewing`'s) would
   * always beat a step's own explicit `skills` option, which is backwards:
   * config must beat the flow, but the flow's own choice must still beat an
   * UNSET bundled default.
   */
  readonly configuredSkills: Readonly<Record<string, readonly string[]>>
  /** The flow's first step on an ordinary start — where a finished episode waits. */
  readonly initial: StateName
}

export const knownModes = (def: Pick<WorkflowDefinition, "modes">): readonly StateMode[] =>
  Object.keys(def.modes)
