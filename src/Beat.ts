/**
 * The beat: the ONE place the wire shape of `gtd next`'s structured output
 * lives, and (below) the land document, `gtd land`'s own counterpart — the
 * two structured surfaces gtd has. PURE — no git, no filesystem, no Effect;
 * `program.ts` gathers everything this module needs (a rendered rest, the
 * derived `stalled` verdict, an optional prompt session/validate script, the
 * pending-change/next-edge preview, the recorded cost) and hands it to
 * `beatFields` to assemble ONE fields object. `renderBeatJson` and
 * `renderBeatSh` (over `src/Sh.ts`'s wire format) both render from that one
 * object, so a field can land in one encoding and miss the other only if
 * it's missing from `beatFields` itself.
 *
 * `BeatKind` supersedes the old boolean `stalled` field: it's the one
 * question a driver asks per beat — what to DO with this rest, not merely
 * whether dispatching it is safe. `beatKindOf` derives it in precedence
 * order (see its own doc comment); `beatFields` assembles the kind plus the
 * rendered rest's own fields, gating the "dispatch block" (`session`/
 * `validate`) to `kind === "prompt"` alone. The fields carry no version
 * field — the field set itself is the contract, and a breaking change to it
 * is a major release.
 *
 * `renderBeatPlain` is `gtd next`'s plain-text encoder — the third rendering
 * alongside `renderBeatJson`/`renderBeatSh`, all three reading from the same
 * `BeatFields` object. See its own doc comment for the header-suppression
 * rule and the self-validation pairing it owns.
 */
import type { RenderedRest, ModelCost } from "./Edge.js"
import type { Actor, ContentKind, StateMode, StateName } from "./PatternMachine.js"
import type { TemplateEdge } from "./PatternTemplates.js"
import { renderShDocument, type ShRecord, type ShShapeFor } from "./Sh.js"

// ---------------------------------------------------------------------------
// The land document — `gtd land`'s `--json`/`--sh` counterpart to the beat
// above. Co-located here (not in program.ts) for the same reason the beat is:
// this is already "the place the wire shape lives" — one file to check when
// adding a field to either document.
// ---------------------------------------------------------------------------

/**
 * `gtd land`'s whole field set — the ONE object both `renderLandJson` and
 * `renderLandSh` render from. `program.ts`'s `planLanding` is the only
 * producer (a `LandResult`); `landFields` below assembles this object in a
 * fixed key order (`script`, `settled`, `idle`, `state`, `subject`, `cost`,
 * `model`) — the JSON key order too, since it's built via object literal.
 * Nothing here is derived beyond `LandResult`'s own fields: `script` is
 * `Emit.ts`'s `combinedScript(required, optional)` computed once in
 * `planLanding`, and plain `gtd land`'s stdout is that same string — the
 * byte-identity `gtd land | sh` depends on is unrepresentable-otherwise, not
 * merely tested. `subject`/`cost`/`model` are `null` (never omitted) for a
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

/** `--sh`'s shape for `LandFields`: one entry per field, derived so a field added to `LandFields` with no matching entry here is a compile error (`ShShapeFor`'s own doc comment). */
const LAND_SH_SHAPE: ShShapeFor<LandFields> = {
  script: "scalar",
  settled: "bool",
  idle: "bool",
  state: "scalar",
  subject: "scalar",
  cost: "scalar",
  model: "scalar",
}

/** `gtd land --json`'s JSON encoding — a newline-terminated line. */
export const renderLandJson = (fields: LandFields): string => JSON.stringify(fields) + "\n"

/**
 * `gtd land --json`'s shell-sourceable counterpart, `--sh` — see `src/Sh.ts`
 * for the wire format. Its `unset` preamble (`shVarNames`, driven by
 * `LAND_SH_SHAPE` alone) only names THIS document's own leaves, so evaluating
 * it never clears `gtd_content`/`gtd_log`/`gtd_session_id` — a beat-only
 * document a driver may still be relying on after the land (e.g. `$gtd_log`).
 *
 * `gtd_state`, `gtd_cost`, `gtd_model` and `gtd_idle` are the four names BOTH
 * documents declare (same `"gtd"` prefix): evaluating this document's own
 * `unset`+reassign clears and resets exactly those four, so after a land they
 * describe the LANDING (the state it now rests at, the cost/model just
 * recorded, whether that rest is idle) — never stale, but never the next
 * beat's either. Re-read `gtd next --sh` for beat facts.
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
 * The first declared `on` edge that would fire right now — `gtd next
 * --json`'s `next` key, before `nextField` maps it to its emitted shape.
 * `action` is `string | undefined` rather than an optional (`action?:`)
 * property: with `exactOptionalPropertyTypes` on, an optional property
 * cannot be assigned an explicit `undefined` — this stays a plain nullable
 * field so `computeNextMatch`'s destructured, possibly-absent `action` can be
 * spread straight in.
 */
export interface NextMatch {
  readonly action: string | undefined
  readonly pattern: string
  readonly target: string
}

/** `gtd next --json`'s `next` key — `null` on no match, else the matched edge's pattern/target plus its `action` when declared (omitted via conditional spread, never emitted as an explicit `undefined` — `exactOptionalPropertyTypes` forbids that assignment outright, so this can't regress to it). */
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

/** The whole beat vocabulary a driver acts on — see the module doc comment. */
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
 * `tests/integration/features/readme-driver.feature`).
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

/**
 * One beat's whole field set — the ONE object both `renderBeatJson` and
 * `renderBeatSh` render from, so a field can't land in one encoding and miss
 * the other. Property insertion order (built by `beatFields`) IS the JSON
 * key order: `kind`, `content`, `idle`, `session`, `model`, `validate`,
 * `log`, `state`, `actor`, `label`, `memory`, `file`, `mode`, `edges`,
 * `changes`, `next`, `cost`, `costByModel`.
 */
export interface BeatFields {
  readonly kind: BeatKind
  readonly content: string
  readonly idle: boolean
  readonly session?: { readonly id: string; readonly resume: boolean }
  readonly model?: string
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
 * Assemble one beat's fields — the ONLY place `gtd next --json`'s wire
 * shape is built; both `renderBeatJson` and `renderBeatSh` render from its
 * output.
 *
 * `session`/`validate` are the DISPATCH BLOCK: dropped unless `kind ===
 * "prompt"`, even if the caller passed one in — the gate lives here (not
 * only in the caller that computes them) so it can never drift. `content` is
 * the rendered rest's own content, except at `kind === "stalled"`, where
 * it's `stallDiagnosis`'s text instead. `idle` is `restIsIdle` verbatim —
 * always present, `true`/`false`, never omitted. `model`/`memory`/`file`/
 * `mode`/`label`/`edges` are plain facts about the resting state and are
 * emitted at EVERY kind — omitted (never `null`) when their source is unset.
 * `changes` and `next` are always present (the headline conclusion, never
 * omit-vs-null — a `null` `next` means no declared pattern matches).
 * `cost`/`costByModel` are emitted only when a cost has actually been
 * recorded (`cost > 0`).
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

/** `--sh`'s shape for `BeatFields`: one entry per field, derived so a field added to `BeatFields` with no matching entry here is a compile error (`ShShapeFor`'s own doc comment). */
const BEAT_SH_SHAPE: ShShapeFor<BeatFields> = {
  kind: "scalar",
  content: "scalar",
  idle: "bool",
  session: { id: "scalar", resume: "bool" },
  model: "scalar",
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

/** `gtd next --json`'s JSON encoding — a newline-terminated line, byte-identical to the old `beatDocument`'s output. */
export const renderBeatJson = (fields: BeatFields): string => JSON.stringify(fields) + "\n"

/** `gtd next --json`'s shell-sourceable counterpart, `--sh` — see `src/Sh.ts` for the wire format. */
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
 * rather than imported as a VALUE, since this module's only import from
 * `Edge.ts` is type-only (see the module doc comment: no git, no filesystem,
 * no Effect); a real import here would pull `Edge.ts`'s whole runtime module
 * graph into this otherwise-pure module.
 */
const UNATTRIBUTED_MODEL = "unspecified"
const breakdownIsInformative = (byModel: readonly ModelCost[]): boolean =>
  byModel.length > 1 || (byModel.length === 1 && byModel[0]!.model !== UNATTRIBUTED_MODEL)

/** The plain-text `Cost:` line(s) — empty when nothing recorded, plus an indented per-model split when informative. */
const costStatusLines = (cost: number, byModel: readonly ModelCost[]): string[] => {
  if (cost <= 0) return []
  const lines = [`Cost: ${cost}`]
  if (breakdownIsInformative(byModel)) {
    for (const m of byModel) lines.push(`  ${m.model}: ${m.cost}`)
  }
  return lines
}

/** The `Pending:` block — `(clean)` when nothing is pending, else one indented line per change. */
const pendingStatusLines = (statusChanges: readonly StatusChange[]): string[] =>
  statusChanges.length === 0
    ? ["Pending: (clean)"]
    : [
        "Pending:",
        ...statusChanges.map((c) => `  ${c.status} ${c.path} -> ${c.pattern ?? "(no match)"}`),
      ]

/** The `Next:` line — the plain-text counterpart to `nextField` above. */
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
 * The self-validation instruction gtd APPENDS to a `prompt` beat's plain
 * output when its state declares both `file:` and `mode:` — i.e. a state
 * whose actor hands over a steering file some command validates. Appended
 * ONLY here (for a human or a simple driver who reads the prompt and hands it
 * to an agent, so the agent self-validates); withheld from `--json`/`--sh`,
 * where a driving loop instead runs the `validate` field itself and
 * re-prompts on findings (see the README's minimal driver). This is
 * advisory: `gtd land` embeds that same command ahead of its own commit and
 * REFUSES a turn whose steering file is invalid, so a malformed file is
 * never captured whether or not this instruction was followed.
 */
const selfValidateInstruction = (command: string, file: string): string =>
  `\nBefore finishing your turn, run \`${command}\` — it checks ${file} — and fix ` +
  `every violation it reports until it exits cleanly. Do not finish while it ` +
  `still reports violations.\n`

/**
 * `gtd next`'s plain-text encoding — the third rendering alongside
 * `renderBeatJson`/`renderBeatSh`, all three reading from the same
 * `BeatFields`. Shape: the status header (`State:`/`Awaits:`/…/`Pending:`/
 * `Next:`), a blank line, then `content` verbatim — EXCEPT at
 * `kind === "prompt"`, which drops the header entirely and is `content` plus
 * the self-validation instruction (naming `selfValidateCommand`, when given)
 * and nothing else.
 *
 * **The header is suppressed at `kind === "prompt"` because those bytes ARE
 * the agent's input** — state name, edges and pending-change lines are gtd
 * bookkeeping the prompt never asked for, and prefixing them would change
 * what every existing agent turn receives. The header shows at every other
 * kind (`script`/`message`/`capture`/`stalled`), whose plain output a human
 * or a driver reads, never an agent.
 *
 * **The self-validation pairing rule:** `fields.content` is `rendered.content`
 * untouched in every encoding (`beatFields` never appends to it); this
 * function is the ONLY place `selfValidateInstruction` is appended. The prose
 * instruction and the JSON/`--sh` `validate` field are one fact for two
 * audiences — plain has no deterministic runner to invoke, so it tells the
 * agent to run the check itself, while a structured loop runs `validate`
 * itself instead. Don't fold the instruction into `content`: that would send
 * it to agents that were already going to have `validate` run on their
 * behalf, duplicating the gate.
 *
 * `selfValidateCommand` is the already-RESOLVED command string — this
 * function is pure and never resolves it itself.
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
