import type { RenderedRest, ModelCost } from "./Edge.js"
import type { Actor, ContentKind, StateMode, StateName } from "./PatternMachine.js"
import type { TemplateEdge } from "./PatternTemplates.js"
import { renderShDocument, type ShRecord, type ShShapeFor } from "./Sh.js"

// ---------------------------------------------------------------------------
// The land document — `gtd land`'s `--json`/`--sh` counterpart to the beat
// above, co-located here for the same reason.
// ---------------------------------------------------------------------------

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

/** Assembles one `gtd land` result's fields in `LandFields`' declared order — the ONLY place `gtd land --json`'s wire shape is built. */
export const landFields = (input: LandFields): LandFields => ({
  script: input.script,
  settled: input.settled,
  idle: input.idle,
  state: input.state,
  subject: input.subject,
  cost: input.cost,
  model: input.model,
})

/** `--sh`'s shape for `LandFields`: one entry per field, so a field added to `LandFields` with no matching entry here is a compile error. */
const LAND_SH_SHAPE: ShShapeFor<LandFields> = {
  script: "scalar",
  settled: "bool",
  idle: "bool",
  state: "scalar",
  subject: "scalar",
  cost: "scalar",
  model: "scalar",
}

export const renderLandJson = (fields: LandFields): string => JSON.stringify(fields) + "\n"

/**
 * `gtd land --json`'s shell-sourceable counterpart (see `src/Sh.ts`). Its
 * `unset` preamble only names this document's own leaves, so it never clears
 * `gtd_content`/`gtd_log`/`gtd_session_id` — beat-only names a driver may
 * still rely on after the land.
 */
export const renderLandSh = (fields: LandFields): string =>
  renderShDocument("gtd", LAND_SH_SHAPE, fields as unknown as ShRecord)

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

/** The whole beat vocabulary a driver acts on — what to DO with a rest, not merely whether dispatching it is safe. */
export type BeatKind = "capture" | "message" | "script" | "prompt" | "stalled"

/**
 * A resting content kind: `renderRest` never resolves a `Rest` at a commit
 * state, so `beatKindOf` is never handed `"commit"` — narrowing the
 * parameter here (rather than switching on all four `ContentKind`s) makes
 * that case unwritable instead of merely untested.
 */
type RestingContentKind = Exclude<ContentKind, "commit">

/**
 * The beat kind for a rest, in precedence order:
 *
 * 1. `stalled` — `Edge.ts`'s `stalledAt` verdict, passed in as a plain
 *    boolean (this module never resolves it itself). `stalledAt` already
 *    requires a clean tree, so this can never collide with `capture` below.
 * 2. `capture` — a `message` rest with a DIRTY tree: the human already
 *    acted; a driver lands it immediately.
 * 3. Otherwise, the content kind verbatim (`script`/`prompt`, or `message`
 *    on a clean tree).
 */
export const beatKindOf = (input: {
  readonly contentKind: RestingContentKind
  readonly dirty: boolean
  readonly stalled: boolean
}): BeatKind => {
  if (input.stalled) return "stalled"
  if (input.contentKind === "message" && input.dirty) return "capture"
  return input.contentKind
}

/**
 * The `stalled` beat's own content: a diagnosis naming the stuck state and
 * the three ways out. The first line is shaped so a stderr grep for
 * `stalled at "<state>"` stays a stable substring (see
 * `tests/integration/features/driver-doc.feature`).
 */
export const stallDiagnosis = (state: StateName, actor: Actor): string =>
  `stalled at "${state}": the last gtd(${actor}): ${state} turn landed an empty ` +
  `attempt, the tree is clean, and another dispatch would repeat it.\n\n` +
  `Three ways out:\n` +
  `  - sharpen the state's prompt so the turn has something concrete to author\n` +
  `  - give the state a retry: cap, redirecting to an escalation state after\n` +
  `    N fruitless attempts\n` +
  `  - declare a "C" pattern on the state, if it can legitimately finish with\n` +
  `    nothing to change\n`

/** One beat's whole field set — the ONE object both `renderBeatJson` and `renderBeatSh` render from. Property insertion order (built by `beatFields`) is the JSON key order. */
export interface BeatFields {
  readonly kind: BeatKind
  readonly content: string
  readonly idle: boolean
  readonly session?: { readonly id: string; readonly resume: boolean }
  readonly model?: string
  readonly system?: string
  readonly validate?: string
  readonly log: string
  readonly state: StateName
  readonly actor: Actor
  readonly label?: string
  readonly memory?: string
  readonly file?: string
  readonly mode?: StateMode
  readonly edges?: readonly TemplateEdge[]
  readonly changes: readonly StatusChange[]
  readonly next: {
    readonly action?: string
    readonly pattern: string
    readonly target: string
  } | null
  readonly cost?: number
  readonly costByModel?: readonly ModelCost[]
}

/**
 * Assemble one beat's fields — the ONLY place `gtd next --json`'s wire shape
 * is built. `session`/`validate` (the dispatch block) are dropped unless
 * `kind === "prompt"`, even if the caller passed one in, so the gate can
 * never drift out of sync with a caller. `system` is omitted when its
 * rendered value is the empty string (unlike `model`): an empty
 * `--system-prompt ""` would silently delete the harness's own default
 * instead of failing loudly.
 */
export const beatFields = (input: {
  readonly rendered: RenderedRest
  readonly kind: BeatKind
  readonly idle: boolean
  readonly log: string
  readonly session?: { readonly id: string; readonly resume: boolean }
  readonly validate?: string
  readonly changes: readonly StatusChange[]
  readonly next: NextMatch | null
  readonly cost: number
  readonly costByModel: readonly ModelCost[]
}): BeatFields => {
  const { rendered, kind, idle, log, session, validate, changes, next, cost, costByModel } = input
  const dispatchable = kind === "prompt"
  const hasCost = cost > 0
  return {
    kind,
    content: kind === "stalled" ? stallDiagnosis(rendered.state, rendered.actor) : rendered.content,
    idle,
    ...(dispatchable && session !== undefined
      ? { session: { id: session.id, resume: session.resume } }
      : {}),
    ...(rendered.model !== undefined ? { model: rendered.model } : {}),
    ...(rendered.system !== undefined && rendered.system !== "" ? { system: rendered.system } : {}),
    ...(dispatchable && validate !== undefined ? { validate } : {}),
    log,
    state: rendered.state,
    actor: rendered.actor,
    ...(rendered.label !== undefined ? { label: rendered.label } : {}),
    ...(rendered.memory !== undefined ? { memory: rendered.memory } : {}),
    ...(rendered.file !== undefined ? { file: rendered.file } : {}),
    ...(rendered.mode !== undefined ? { mode: rendered.mode } : {}),
    ...(rendered.edges.length > 0 ? { edges: rendered.edges } : {}),
    changes,
    next: nextField(next),
    ...(hasCost ? { cost, costByModel } : {}),
  }
}

/** `--sh`'s shape for `BeatFields`: one entry per field, so a field added to `BeatFields` with no matching entry here is a compile error. */
const BEAT_SH_SHAPE: ShShapeFor<BeatFields> = {
  kind: "scalar",
  content: "scalar",
  idle: "bool",
  session: { id: "scalar", resume: "bool" },
  model: "scalar",
  system: "scalar",
  validate: "scalar",
  log: "scalar",
  state: "scalar",
  actor: "scalar",
  label: "scalar",
  memory: "scalar",
  file: "scalar",
  mode: "scalar",
  edges: "list",
  changes: "list",
  next: { pattern: "scalar", target: "scalar", action: "scalar" },
  cost: "scalar",
  costByModel: "list",
}

export const renderBeatJson = (fields: BeatFields): string => JSON.stringify(fields) + "\n"

export const renderBeatSh = (fields: BeatFields): string =>
  renderShDocument("gtd", BEAT_SH_SHAPE, fields as unknown as ShRecord)

// ---------------------------------------------------------------------------
// The plain encoder — `gtd next`'s third rendering
// ---------------------------------------------------------------------------

/**
 * True when the per-model breakdown adds information beyond the `Cost:` total:
 * more than one model, or a single model that carries an actual `--model` tag
 * (a lone `unspecified` bucket just restates the total, so it's suppressed).
 *
 * The literal below must match `Edge.ts`'s `UNATTRIBUTED_MODEL` — duplicated
 * rather than imported as a value, since this module's only import from
 * `Edge.ts` is type-only and this module is otherwise pure (no git, no
 * filesystem, no Effect); a real import would pull in `Edge.ts`'s whole
 * runtime module graph.
 */
const UNATTRIBUTED_MODEL = "unspecified"
const breakdownIsInformative = (byModel: readonly ModelCost[]): boolean =>
  byModel.length > 1 || (byModel.length === 1 && byModel[0]!.model !== UNATTRIBUTED_MODEL)

const costStatusLines = (cost: number, byModel: readonly ModelCost[]): string[] => {
  if (cost <= 0) return []
  const lines = [`Cost: ${cost}`]
  if (breakdownIsInformative(byModel)) {
    for (const m of byModel) lines.push(`  ${m.model}: ${m.cost}`)
  }
  return lines
}

const pendingStatusLines = (statusChanges: readonly StatusChange[]): string[] =>
  statusChanges.length === 0
    ? ["Pending: (clean)"]
    : [
        "Pending:",
        ...statusChanges.map((c) => `  ${c.status} ${c.path} -> ${c.pattern ?? "(no match)"}`),
      ]

const nextStatusLine = (next: BeatFields["next"]): string =>
  next === null
    ? "Next: (no match — nothing would happen)"
    : `Next: ${next.action ?? next.pattern} → ${next.target}`

/** Builds `{[key]: value}` for each entry whose value isn't `undefined` — the shared "omit absent optional fields" shape the header uses. */
const definedFields = (
  entries: readonly (readonly [string, unknown])[],
): Record<string, unknown> => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of entries) if (value !== undefined) result[key] = value
  return result
}

/**
 * The header block's own lines — `State:`/`Awaits:`/optional `Label:`/
 * `Model:`/`Memory:`/`File:`/`Mode:`/`Cost:`(+breakdown)/`Pending:`/`Next:`,
 * in that order. Used by `renderBeatPlain`'s non-`prompt` branch below.
 */
const beatHeaderLines = (fields: BeatFields): string[] => {
  const optional = definedFields([
    ["Label", fields.label],
    ["Model", fields.model],
    ["Memory", fields.memory],
    ["File", fields.file],
    ["Mode", fields.mode],
  ])
  return [
    `State: ${fields.state}`,
    `Awaits: ${fields.actor}`,
    ...Object.entries(optional).map(([key, value]) => `${key}: ${value}`),
    ...costStatusLines(fields.cost ?? 0, fields.costByModel ?? []),
    ...pendingStatusLines(fields.changes),
    nextStatusLine(fields.next),
  ]
}

/**
 * The self-validation instruction appended to a `prompt` beat's plain output
 * only — a structured (`--json`/`--sh`) driver runs the `validate` field
 * itself instead. Advisory either way: `gtd land` refuses a turn whose
 * steering file is invalid regardless of whether this was followed.
 */
const selfValidateInstruction = (command: string, file: string): string =>
  `\nBefore finishing your turn, run \`${command}\` — it checks ${file} — and fix ` +
  `every violation it reports until it exits cleanly. Do not finish while it ` +
  `still reports violations.\n`

/**
 * `gtd next`'s plain-text encoding. At `kind === "prompt"` the status header
 * is suppressed and only `content` plus the self-validation instruction is
 * emitted — those bytes ARE the agent's input, so gtd's own bookkeeping
 * (state name, edges, pending changes) must not be prefixed onto it. Every
 * other kind gets the header, since its plain output is read by a human or
 * driver, never an agent. `selfValidateCommand` is already resolved; this
 * function never resolves it itself.
 */
export const renderBeatPlain = (fields: BeatFields, selfValidateCommand?: string): string => {
  const content = fields.content.endsWith("\n") ? fields.content : fields.content + "\n"
  if (fields.kind === "prompt") {
    return selfValidateCommand !== undefined && fields.file !== undefined
      ? content + selfValidateInstruction(selfValidateCommand, fields.file)
      : content
  }
  return beatHeaderLines(fields).join("\n") + "\n\n" + content
}
