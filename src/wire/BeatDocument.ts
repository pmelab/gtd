import type { BeatKind, Demand, DemandSession } from "./Demand.js"
import type { BeatStatus, NextMatch, StatusChange } from "./BeatStatus.js"
import type { Actor, ModelCost, StateMode, StateName, TemplateEdge } from "./types.js"

/** `gtd next --json`'s `next` key — `null` on no match, else the matched edge's fields (`action` omitted, never an explicit `undefined`, when unset). */
const nextField = (
  next: NextMatch | null,
): { action?: string; pattern: string; target: string } | null =>
  next === null
    ? null
    : {
        ...(next.action !== undefined ? { action: next.action } : {}),
        pattern: next.pattern,
        target: next.target,
      }

/** Unreachable in a well-typed call — used as the `default` arm of an exhaustive switch over `Demand["kind"]`, so a future `BeatKind` member that isn't handled fails `tsc`, not just review. */
const assertNeverDemand = (demand: never): never => {
  throw new Error(`unreachable demand: ${JSON.stringify(demand)}`)
}

/**
 * The ONE exhaustive switch translating a `Demand` into its wire
 * `session`/`validate` pair — only the `prompt` variant carries either, and
 * every other member is listed explicitly (not a `default:` fallthrough) so
 * adding a sixth `BeatKind` without adding its case here fails `tsc` at the
 * `assertNeverDemand` call, not silently falling through to "no session."
 */
const dispatchFieldsOf = (
  demand: Demand,
): { readonly session: DemandSession | undefined; readonly validate: string | undefined } => {
  switch (demand.kind) {
    case "prompt":
      return { session: demand.session, validate: demand.validate }
    case "capture":
    case "message":
    case "script":
    case "stalled":
      return { session: undefined, validate: undefined }
    default:
      return assertNeverDemand(demand)
  }
}

/** One beat's whole field set, flattened — the ONE object `renderBeatJson` renders from, in the object's own key order (also the JSON key order). Byte-identical to the pre-`06-wire-demand-status` `BeatFields`. */
export interface BeatDocument {
  readonly kind: BeatKind
  readonly content: string
  readonly idle: boolean
  readonly session: DemandSession | undefined
  readonly model: string | undefined
  readonly system: string | undefined
  readonly validate: string | undefined
  readonly log: string
  readonly state: StateName
  readonly actor: Actor
  readonly label: string | undefined
  readonly memory: string | undefined
  readonly file: string | undefined
  readonly mode: StateMode | undefined
  readonly edges: readonly TemplateEdge[] | undefined
  readonly changes: readonly StatusChange[]
  readonly next: {
    readonly action?: string
    readonly pattern: string
    readonly target: string
  } | null
  readonly cost: number | undefined
  readonly costByModel: readonly ModelCost[] | undefined
}

/**
 * Flatten a `Demand` plus its `BeatStatus` into the single 19-key document
 * `gtd next --json` emits — the ONLY place the two are joined. `cost`/
 * `costByModel` are omitted together, exactly when no cost was recorded
 * (`cost <= 0`).
 */
export const beatDocument = (demand: Demand, status: BeatStatus): BeatDocument => {
  const { session, validate } = dispatchFieldsOf(demand)
  const hasCost = status.cost > 0
  return {
    kind: demand.kind,
    content: demand.content,
    idle: status.idle,
    session,
    model: status.model,
    system: status.system,
    validate,
    log: status.log,
    state: status.state,
    actor: status.actor,
    label: status.label,
    memory: status.memory,
    file: status.file,
    mode: status.mode,
    edges: status.edges,
    changes: status.changes,
    next: nextField(status.next),
    cost: hasCost ? status.cost : undefined,
    costByModel: hasCost ? status.costByModel : undefined,
  }
}

export const renderBeatJson = (document: BeatDocument): string => JSON.stringify(document) + "\n"
