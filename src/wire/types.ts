// Zero imports on purpose — this is the wire's own vocabulary tier, so
// `wire` stays a leaf every other module may import.

/** No closed vocabulary of "kinds" — any workflow-defined string. */
export type Actor = string

/** Defined by whatever keys `WorkflowDefinition.states` declares — not a closed vocabulary. */
export type StateName = string

/** The three content kinds a state can carry — exactly one per state. */
export type ContentKind = "script" | "prompt" | "message"

/** The name of a steering-file mode. Not a closed vocabulary: the valid set derives from the active definition (`BUILT_IN_MODES` plus whatever `modes:` declares). */
export type StateMode = string

/** One model's summed token cost — the shape `gtd summary`'s template iterates as `it.processCostByModel`, and `gtd next --json`'s `costByModel` entries. */
export interface ModelCost {
  readonly model: string
  readonly cost: number
}

/**
 * The subset of `Edge.ts`'s `RenderedRest` the beat builders below read,
 * expressed structurally so this module never imports `RenderedRest` itself
 * — that import (even type-only) would be a Sheriff edge back to root.
 * `RenderedRest` satisfies this shape today and must keep doing so.
 */
export interface RenderedDemandSource {
  readonly state: StateName
  readonly actor: Actor
  readonly content: string
  readonly model?: string
  readonly system?: string
  readonly label?: string
  readonly memory?: string
  readonly file?: string
  readonly mode?: StateMode
  readonly judge?: string
}
