import type { StateName } from "./types.js"
import { renderFormat } from "./constants.js"

/**
 * `gtd land`'s whole field set, in the object's own key order (also the JSON
 * key order). `subject`/`cost`/`model` are `null` (never omitted) for a
 * genuine no-op, mirroring `LandResult` itself.
 */
export interface LandFields {
  readonly script: string
  readonly settled: boolean
  readonly idle: boolean
  readonly state: StateName
  readonly subject: string | null
  readonly cost: number | null
  readonly model: string | null
}

/**
 * `program.ts`'s `LandResult`, expressed structurally so `wire` never
 * imports it — the SAME seven fields as `LandFields`, but in `LandResult`'s
 * own declaration order (`state, subject, cost, model, script, settled,
 * idle`), not the wire's. Deliberately a different shape from `LandFields`:
 * `landFields` below reorders INTO the wire's pinned key order, so its input
 * type cannot equal its output type — an identity-typed
 * `(input: LandFields) => LandFields` would let a future caller pass an
 * already-wire-shaped object through unchanged, silently hiding a dropped
 * reorder.
 */
export interface LandResultSource {
  readonly state: StateName
  readonly subject: string | null
  readonly cost: number | null
  readonly model: string | null
  readonly script: string
  readonly settled: boolean
  readonly idle: boolean
}

/** Assembles one `gtd land` result's fields in `LandFields`' declared order — the ONLY place `gtd land --json`'s wire shape is built. */
export const landFields = (input: LandResultSource): LandFields => ({
  script: input.script,
  settled: input.settled,
  idle: input.idle,
  state: input.state,
  subject: input.subject,
  cost: input.cost,
  model: input.model,
})

export const renderLandJson = (fields: LandFields): string => JSON.stringify(fields) + "\n"

const FMT_NOOP = 'nothing to do at "%s"\n'
const FMT_LAND_PROSE = "commit everything with this message: %s\n"

/** `nothing to do at "<state>"` — a no-op step's plain-text line, and the text a print-only script's own `printf` carries. */
export const noopText = (state: string): string => renderFormat(FMT_NOOP, state)

/** `commit everything with this message: <subject>` — plain `gtd land`'s own stdout at a pending diff (no script); `--json` keeps emitting the script itself, unaffected. */
export const landProseText = (subject: string): string => renderFormat(FMT_LAND_PROSE, subject)

/**
 * `gtd land`'s plain-text encoding — names the commit subject at a real
 * landing and points at `--json=script`, since the script itself is
 * unreachable from plain output; prints the existing no-op note otherwise.
 */
export const renderLandPlain = (fields: LandFields): string =>
  fields.subject !== null
    ? `${landProseText(fields.subject).trimEnd()}\n(run \`gtd land --json=script | sh\` to get the landing script)\n`
    : noopText(fields.state)
