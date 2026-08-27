import type { RenderedRest, ModelCost } from "./Edge.js"
import type { Actor, ContentKind, StateMode, StateName } from "./PatternMachine.js"
import type { TemplateEdge } from "./PatternTemplates.js"
import { renderFormat } from "./OutcomeScript.js"

// ---------------------------------------------------------------------------
// The land document — `gtd land`'s `--json` counterpart to the beat above,
// co-located here for the same reason.
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

/** One beat's whole field set — the ONE object `renderBeatJson` renders from. Property insertion order (built by `beatFields`) is the JSON key order. */
export interface BeatFields {
  readonly kind: BeatKind
  readonly content: string
  readonly idle: boolean
  /** Dropped from the JSON document (via `JSON.stringify`'s `undefined`-skipping) when there is no dispatch session — i.e. whenever `kind !== "prompt"`, even if the caller passed one. */
  readonly session: { readonly id: string; readonly resume: boolean } | undefined
  /** Dropped from the JSON document (via `JSON.stringify`'s `undefined`-skipping) when there is no model. */
  readonly model: string | undefined
  /** Dropped from the JSON document (via `JSON.stringify`'s `undefined`-skipping) when there is no system prompt, including when it rendered to the empty string. */
  readonly system: string | undefined
  /** Dropped from the JSON document (via `JSON.stringify`'s `undefined`-skipping) when there is no self-validation command — i.e. whenever `kind !== "prompt"`, even if the caller passed one. */
  readonly validate: string | undefined
  readonly log: string
  readonly state: StateName
  readonly actor: Actor
  /** Dropped from the JSON document (via `JSON.stringify`'s `undefined`-skipping) when there is no label. */
  readonly label: string | undefined
  /** Dropped from the JSON document (via `JSON.stringify`'s `undefined`-skipping) when there is no memory key. */
  readonly memory: string | undefined
  /** Dropped from the JSON document (via `JSON.stringify`'s `undefined`-skipping) when there is no steering file. */
  readonly file: string | undefined
  /** Dropped from the JSON document (via `JSON.stringify`'s `undefined`-skipping) when there is no steering mode. */
  readonly mode: StateMode | undefined
  /** Dropped from the JSON document (via `JSON.stringify`'s `undefined`-skipping) when there are no declared edges. */
  readonly edges: readonly TemplateEdge[] | undefined
  readonly changes: readonly StatusChange[]
  readonly next: {
    readonly action?: string
    readonly pattern: string
    readonly target: string
  } | null
  /** Dropped from the JSON document (via `JSON.stringify`'s `undefined`-skipping) when no cost was recorded. */
  readonly cost: number | undefined
  /** Dropped from the JSON document (via `JSON.stringify`'s `undefined`-skipping) when no cost was recorded. */
  readonly costByModel: readonly ModelCost[] | undefined
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
    session:
      dispatchable && session !== undefined
        ? { id: session.id, resume: session.resume }
        : undefined,
    model: rendered.model,
    system: rendered.system !== undefined && rendered.system !== "" ? rendered.system : undefined,
    validate: dispatchable && validate !== undefined ? validate : undefined,
    log,
    state: rendered.state,
    actor: rendered.actor,
    label: rendered.label,
    memory: rendered.memory,
    file: rendered.file,
    mode: rendered.mode,
    edges: rendered.edges.length > 0 ? rendered.edges : undefined,
    changes,
    next: nextField(next),
    cost: hasCost ? cost : undefined,
    costByModel: hasCost ? costByModel : undefined,
  }
}

export const renderBeatJson = (fields: BeatFields): string => JSON.stringify(fields) + "\n"

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
 * only — a structured (`--json`) driver runs the `validate` field
 * itself instead. Advisory either way: `gtd land` refuses a turn whose
 * steering file is invalid regardless of whether this was followed.
 */
const selfValidateInstruction = (command: string, file: string): string =>
  `\nBefore finishing your turn, run \`${command}\` — it checks ${file} — and fix ` +
  `every violation it reports until it exits cleanly. Do not finish while it ` +
  `still reports violations.\n`

/** `script`'s plain-output instruction line — a literal constant, never a template. */
const SCRIPT_INSTRUCTION = "Run this script:"

/** `capture`'s plain-output instruction line — a literal constant, never a template. */
const CAPTURE_INSTRUCTION = "The edit is already made — run `gtd land` to land it."

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
  const body = beatHeaderLines(fields).join("\n") + "\n\n" + content
  if (fields.kind === "script") return `${SCRIPT_INSTRUCTION}\n` + body
  if (fields.kind === "capture") return `${CAPTURE_INSTRUCTION}\n` + body
  return body
}
