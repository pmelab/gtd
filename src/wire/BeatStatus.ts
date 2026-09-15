import type {
  Actor,
  ModelCost,
  RenderedDemandSource,
  StateMode,
  StateName,
  TemplateEdge,
} from "./types.js"

/** One pending change's status/path plus whichever declared `on` pattern (if any) matches it — `gtd next --json`'s `changes` entries. */
export interface StatusChange {
  readonly status: string
  readonly path: string
  readonly pattern: string | null
}

/**
 * The first declared `on` edge that would fire right now. `action` is
 * `string | undefined` rather than optional (`action?:`) because
 * `exactOptionalPropertyTypes` forbids assigning an explicit `undefined` to
 * an optional property, and `computeNextMatch`'s destructured `action` needs
 * to spread straight in.
 */
export interface NextMatch {
  readonly action: string | undefined
  readonly pattern: string
  readonly target: string
}

/**
 * Everything a `gtd next` beat carries that no driver `case`-arm branches on
 * — the doc-tested minimal driver never reads any of these except
 * `model`/`system` (read unconditionally, not gated to a `kind`) and never
 * switches behavior on them. Ungated: `cost`/`costByModel`/`next` here carry
 * their raw values; `beatDocument` applies the wire's own
 * present-vs-omitted rules when flattening.
 */
export interface BeatStatus {
  readonly idle: boolean
  readonly model: string | undefined
  readonly system: string | undefined
  readonly log: string
  readonly state: StateName
  readonly actor: Actor
  readonly label: string | undefined
  readonly memory: string | undefined
  readonly file: string | undefined
  readonly mode: StateMode | undefined
  readonly edges: readonly TemplateEdge[] | undefined
  readonly changes: readonly StatusChange[]
  readonly next: NextMatch | null
  readonly cost: number
  readonly costByModel: readonly ModelCost[]
}

/**
 * Assemble one `BeatStatus`. `system` is omitted (not just falsy) when its
 * rendered value is the empty string, unlike `model`: an empty
 * `--system-prompt ""` would silently delete the harness's own default
 * instead of failing loudly. `edges` is omitted when the rest declares none.
 */
export const statusOf = (input: {
  readonly rendered: RenderedDemandSource
  readonly idle: boolean
  readonly log: string
  readonly changes: readonly StatusChange[]
  readonly next: NextMatch | null
  readonly cost: number
  readonly costByModel: readonly ModelCost[]
}): BeatStatus => {
  const { rendered, idle, log, changes, next, cost, costByModel } = input
  return {
    idle,
    model: rendered.model,
    system: rendered.system !== undefined && rendered.system !== "" ? rendered.system : undefined,
    log,
    state: rendered.state,
    actor: rendered.actor,
    label: rendered.label,
    memory: rendered.memory,
    file: rendered.file,
    mode: rendered.mode,
    edges: rendered.edges.length > 0 ? rendered.edges : undefined,
    changes,
    next,
    cost,
    costByModel,
  }
}
