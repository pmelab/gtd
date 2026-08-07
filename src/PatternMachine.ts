/**
 * The v3 "pattern machine": gtd's ground-up rewrite of the state-machine
 * core. This module is the pure engine: definition types, the pattern grammar's
 * parser/matcher, HEAD resolution, and step decisions (refusals, no-ops,
 * commits, retry redirection, and the commit-state squash decision).
 *
 * A workflow here is nothing but named **states**: no gates, no guard
 * functions, no actor kinds, no counters-as-trailers, no interrupt/fallback
 * ladders. Every state declares who acts there (`actor`, absent on commit
 * states), exactly one content kind (`script` | `prompt` | `message` |
 * `commit`, all opaque strings — template rendering is NOT this module's
 * job), an ordered `on` map of change-patterns to next states (absent on
 * commit states), and an optional `retry` cap. A `WorkflowDefinition`
 * separately declares `entries` — the state names a process may START at
 * (`default`, plus `manual` — every state declaring `entry: true`, enterable
 * via `gtd step <actor> --entry <state>`). A definition
 * may also declare `modes:` —
 * named pairs of format/validate shell commands a state's `mode:` can point
 * at (see `ModeDef`); they are inert data here too, rendered and executed
 * only at the edge (`src/SteeringMode.ts`).
 *
 * This module is intentionally pure — no git, no filesystem, no Effect, no
 * IO of any kind. It mirrors the purity discipline documented at the top of
 * `./Subjects.ts` and `./Machine.ts`: every export here is a plain function
 * of its arguments. Rendering templates, executing scripts, walking git
 * history for the process trace, and performing the actual commit/squash
 * are all EDGE concerns for a later phase.
 */

// ── Definition types ─────────────────────────────────────────────────────────

/** Who acts at a state — a plain string, no closed vocabulary of "kinds". */
export type Actor = string

/** A state name — a plain string, defined by whatever keys `WorkflowDefinition.states` declares. */
export type StateName = string

/** The four content kinds a state can carry — exactly one per state. */
export type ContentKind = "script" | "prompt" | "message" | "commit"

/** `{ max, otherwise }` — redirect a transition once its target has been entered `max` times this process. */
export interface RetryDef {
  readonly max: number
  readonly otherwise: StateName
}

/**
 * One `on` row: a raw pattern string paired with its target state, plus an
 * OPTIONAL human-readable `describe` — a plain sentence a `message:` template
 * can surface at a rest to tell a human which change routes where (see
 * `PatternTemplates.TemplateContext.edges`). Kept as an ordered TUPLE (not an
 * object key) so declaration order survives regardless of how a definition is
 * built — object key order is an incidental JS guarantee that a config
 * compiler (YAML, merged definitions) could easily break by rebuilding an
 * object; a tuple array cannot silently reorder or dedupe two rows that happen
 * to share a pattern string.
 *
 * `describe` is INERT to the engine — `step`/`resolveState`/`matchesPattern`
 * never read it, and it is NEVER Eta-rendered. The pattern
 * key itself is different: THIS module (the pure engine) only ever sees a
 * plain string here too, but the edge (`src/Edge.ts`'s `renderOnEdges`)
 * renders it as an Eta template against `it.vars` BEFORE handing it to
 * `step`/`matchesPattern` — so a workflow author writes
 * `"A <%= it.vars.feedbackFile %>"` and the engine still only ever matches a
 * literal string. `describe` exists only to be emitted verbatim so the
 * driving loop / a `message:` template can present it to a human.
 *
 * `action` is a fourth, OPTIONAL slot with the exact same discipline as
 * `describe`: an imperative label (e.g. `"Accept plan"`) that is INERT to the
 * engine — never read by `step`/`resolveState`/`matchesPattern`, and NEVER
 * Eta-rendered. It exists only to be emitted verbatim to a consumer (a CLI
 * message, `gtd status --json`, a visualization) — none of which are wired up
 * yet; this type is pure plumbing. Because this is a positional tuple and not
 * an object, an edge that wants an `action` but no `describe` must still pass
 * an explicit placeholder in slot 3 (e.g. `undefined`) to reach slot 4.
 */
export type OnEdge = readonly [
  pattern: string,
  target: StateName,
  describe?: string | undefined,
  action?: string,
]

/**
 * One state's declaration. Exactly one of `script`/`prompt`/`message`/
 * `commit` should be set (enforced by `validateDefinition`, not by the
 * type — a config compiler assembles these from loosely-typed YAML). A
 * `commit` state is FINAL: it carries no `actor` and no `on` (entering it
 * ends the process; see `StepDecision`'s `"squash"` kind).
 */
export interface StateDef {
  readonly actor?: Actor
  readonly script?: string
  readonly prompt?: string
  readonly message?: string
  readonly commit?: string
  readonly on?: readonly OnEdge[]
  readonly retry?: RetryDef
  /**
   * An OPAQUE harness hint — gtd never interprets this string, it only
   * passes it through verbatim (`gtd next --json`/`gtd status --json`) so
   * the driving loop can map it onto whatever models its agent harness
   * provides (e.g. `"smart"`, `"fast"`, or a concrete model id). Unset means
   * "use the harness's default". Plays no role in engine decisions — `step`
   * and `resolveState` never read it. Forbidden on a commit state (never at
   * rest, emits nothing — see `validateDefinition`). No longer authored
   * directly on a state: the compiler (`src/PatternConfig.ts`, over
   * `src/Machines.ts`'s flattening pass) STAMPS this field from the state's
   * owning machine's own `model:` declaration, onto every one of that
   * machine's emitted states whose content kind is `prompt` — a state itself
   * never declares `model:` directly anymore.
   */
  readonly model?: string
  /**
   * An OPAQUE, human-readable display NAME for the state — gtd never
   * interprets this string, it only passes it through verbatim (`gtd next
   * --json`/`gtd status --json`) so a driving loop or viewer can show
   * something nicer than the raw state name. There is no comparison
   * semantics here — it is just a label. Unset means "show the raw state
   * name" — that fallback lives in the CONSUMER (a driver/viewer), not in
   * gtd itself, which simply omits the field. Rendered as an Eta template
   * through the same `it.vars`-carrying context as `model`/content (a plain
   * string with no Eta tags passes through unchanged). Plays no role in
   * engine decisions — `step` and `resolveState` never read it. Forbidden on
   * a commit state (never at rest, emits nothing — see `validateDefinition`),
   * same rule family as `model`.
   */
  readonly label?: string
  /**
   * Optional — THE steering file this state is about: the file a human/
   * editor should look at while the machine rests here. An Eta template
   * (rendered through the same `it.vars`-carrying context as content and
   * `model`) that must render non-empty. Forbidden on a commit state (never
   * at rest — see `validateDefinition`). Multiple states may share one
   * `file:` (and, in the bundled default, do). The engine never reads a
   * path out of this string itself — only the LSP (`src/Lsp.ts`) interprets
   * it, to map rendered paths to `mode`.
   */
  readonly file?: string
  /**
   * Optional, requires `file:`. The associated file's FORMAT — the NAME of a
   * mode, either one of the two built-ins (`qa` | `review`, see
   * `BUILT_IN_MODES`) or one the workflow declares in `modes:` (see
   * `ModeDef`). Like `model`, this is opaque, emitted data: the ENGINE never
   * branches on it, `step` and `resolveState` never read it — the edge
   * (`src/SteeringMode.ts`) resolves it to a format/validate pair, and the LSP
   * dispatches its live diagnostics on the built-in names. The only rule
   * `validateDefinition` enforces is that the name RESOLVES (a typo must not
   * silently disable the gate). Forbidden on a commit state (see
   * `validateDefinition`).
   */
  readonly mode?: StateMode
  /**
   * Optional. When `true`, gtd opens a "review checkout window" while a
   * process RESTS at this state: HEAD and the index are temporarily rewound to
   * the review base (see `reviewBase`) with the working tree untouched, so the
   * whole `base..HEAD` diff surfaces as ordinary uncommitted changes in any
   * editor's standard git integration. The window is closed (HEAD/index
   * restored) the moment the process rests anywhere else. This module's PURE
   * functions never read it — `resolveState`/`step` are oblivious; the window
   * is opened/closed entirely at the edge (`src/ReviewWindow.ts`), keyed on
   * this flag of the resolved rest. Forbidden on a commit state (never at
   * rest — see `validateDefinition`).
   */
  readonly reviewWindow?: boolean
  /**
   * Optional. `true` marks a state whose most-recent in-process turn commit is
   * the BASE of the review window's diff (`base..HEAD`) — everything committed
   * after entering this state surfaces as pending while the window is open.
   * When no in-process commit entered a `reviewBase` state, the window falls
   * back to the process start (see `src/ReviewWindow.ts`). Like `reviewWindow`
   * the ENGINE never reads it — it is history-derived edge data.
   *
   * A STRING is a different shape entirely: an Eta template rendering a
   * commitish. Entering that state fixes the WHOLE PROCESS's diff base to the
   * rendered value (not a window anchor) — this is how a manual entry (e.g.
   * `gtd step <actor> --entry review --base <commitish>`) pins what the rest
   * of the process diffs against. Rendering the template happens at the edge,
   * not here — this module only carries the raw string (see
   * `entryBaseTemplateOf`) and, per `isReviewBaseState`, a string value is
   * NEVER treated as the `true`/window-anchor form.
   *
   * Forbidden on a commit state (see `validateDefinition`).
   */
  readonly reviewBase?: true | string
  /**
   * Optional. When `true`, a step at this state is REFUSED if its only pending
   * change is deleting the state's own `file:` — a work-free turn that discards
   * its input without addressing it (the "review feedback captured then
   * silently deleted" bug). Like the review window and sign-off gate, the PURE
   * engine never reads it: the check lives at the edge
   * (`enforceFeedbackProgressGate` in `src/program.ts`), which also exempts a
   * `NOTHING ACTIONABLE` sentinel file (a legitimately non-actionable feedback
   * round that makes no code change). Requires a `file:`; forbidden on a commit
   * state (never at rest — see `validateDefinition`).
   */
  readonly requireProgress?: boolean

  /**
   * Optional. When `true`, a step at this state is REFUSED unless every OPEN
   * question in its `qa`-mode `file:` is answered — EXACTLY ONE checkbox ticked
   * per question (and, when the ticked one is the trailing free-text slot, its
   * text is non-empty). This is what makes the advanced flow's answer gates
   * (`product-answer`/`technical-answer`) require a decision on every
   * question before looping back or advancing. Like the review sign-off gate,
   * the PURE engine never reads it: the check lives at the edge
   * (`enforceAnswerCompletenessGate` in `src/program.ts`, over
   * `src/OpenQuestions.ts`), and only acts when the state also declares
   * `mode: qa`. Requires a `file:`; forbidden on a commit state (never at
   * rest — see `validateDefinition`).
   */
  readonly answerGate?: boolean
}

/**
 * The NAME of a steering-file mode — see `StateDef.mode`. NOT a closed
 * vocabulary: the valid set derives from the active definition
 * (`BUILT_IN_MODES` plus whatever `modes:` declares — see `knownModes`),
 * exactly the way `declaredActors` derives the commit grammar's actor set.
 */
export type StateMode = string

/**
 * One steering-file mode: the two SHELL COMMANDS that format and validate a
 * file of this format. Both are Eta templates rendered with the state's usual
 * template context plus `it.file` (the rendered steering-file path — see
 * `PatternTemplates.ModeCommandContext`), and both are entirely EDGE concerns:
 * the pure engine never renders or executes either (`src/SteeringMode.ts`
 * does, for `gtd validate` and the `gtd step` capture gate). At least one of
 * the two must be declared; the halves resolve INDEPENDENTLY, so declaring one
 * leaves the other at whatever the layer beneath provides (a built-in
 * validator, or nothing at all).
 *
 * - `format` runs FIRST and is expected to rewrite the file in place. A
 *   non-zero exit is a hard error (the tooling is broken, not the file). gtd
 *   ships NO formatter of its own — a project brings its own (`prettier`,
 *   `dprint`, a script) by declaring it here.
 * - `validate` runs SECOND: exit 0 means valid; a non-zero exit means invalid,
 *   and its output (stdout then stderr) carries the findings, one per line.
 */
export interface ModeDef {
  readonly format?: string
  readonly validate?: string
}

/**
 * The two mode names gtd VALIDATES itself, in process: `qa`
 * (`src/OpenQuestions.ts`) and `review` (`src/ReviewDoc.ts`) — the pure parsers
 * the LSP also publishes as live diagnostics, which is why they stay in process
 * rather than becoming shell-outs. Available in every workflow without being
 * declared, and they bring VALIDATION ONLY: a built-in mode formats nothing
 * until some `modes:` layer gives it a `format:` command. A `modes:` entry
 * naming one of these overrides only the half it declares.
 */
export type BuiltInMode = "qa" | "review"

const BUILT_IN_MODES: readonly BuiltInMode[] = ["qa", "review"]

/**
 * Built-in mode names that ship NO validator at all — just a recognized name a
 * state's `mode:` may use without a `modes:` declaration, so it resolves to
 * "format if a `modes:` layer gives it one, validate nothing" (see
 * `src/SteeringMode.ts`'s `resolveSteeringMode`). `prose` is the one entry: a
 * curated free-form document with no gtd-side schema (the simple flow's plan
 * file), distinct from the schema'd `qa`/`review` built-ins.
 */
const FORMAT_ONLY_BUILT_IN_MODES = ["prose"] as const

/** Every built-in mode name — the validator tier (`BUILT_IN_MODES`) plus the format-only tier (`FORMAT_ONLY_BUILT_IN_MODES`) — used where a `mode:` just needs to be a KNOWN name, not necessarily one with a validator. */
const KNOWN_BUILT_IN_MODES: readonly StateMode[] = [
  ...BUILT_IN_MODES,
  ...FORMAT_ONLY_BUILT_IN_MODES,
]

/** True when `mode` names one of gtd's own in-process implementations (see `BUILT_IN_MODES`) — the edge's dispatch, and a type guard so it can pick the parser. */
export const isBuiltInMode = (mode: StateMode): mode is BuiltInMode =>
  (BUILT_IN_MODES as readonly StateMode[]).includes(mode)

/** True when `mode` names any built-in — validator tier or format-only tier (see `KNOWN_BUILT_IN_MODES`) — without implying a validator exists. */
export const isKnownBuiltInMode = (mode: StateMode): boolean => KNOWN_BUILT_IN_MODES.includes(mode)

/** The mode names the definition declares in `modes:` (empty when it declares none). */
const declaredModes = (def: WorkflowDefinition): readonly StateMode[] =>
  Object.keys(def.modes ?? {})

/** Every mode name a state's `mode:` may legally name under `def`: the built-ins (validator and format-only tiers) plus the declared ones (a declared name shadowing a built-in appears once). */
export const knownModes = (def: WorkflowDefinition): readonly StateMode[] =>
  Array.from(new Set([...KNOWN_BUILT_IN_MODES, ...declaredModes(def)]))

/**
 * The state names a process may START at. `default` is where an ordinary
 * "no active process" rest resumes (see `initialStateOf`) — required, so there
 * is always a value. `manual` is every OTHER state a process may start at:
 * every state that declared `entry: true` in the source config, qualified and
 * sorted by the compiler, empty when the workflow declares none. A manual
 * entry is reached via `gtd step <actor> --entry <state>` (`src/program.ts`)
 * — a DELIBERATE, distinct starting point from `default` (e.g. a review or a
 * fix process that begins somewhere other than the ordinary rest).
 * `validateDefinition`'s `validateEntries` guarantees `default` and every
 * `manual` entry each name a defined, non-commit state, that no `manual`
 * entry equals `default`, and that `manual` carries no duplicate.
 */
export interface WorkflowEntries {
  readonly default: StateName
  /** Every state that declared `entry: true`, qualified and sorted. Empty array when none declared. */
  readonly manual: readonly StateName[]
}

/** A workflow: named states, the entry points a process may start at, plus the optional steering-file `modes:` they may name. */
export interface WorkflowDefinition {
  readonly states: Readonly<Record<StateName, StateDef>>
  readonly entries: WorkflowEntries
  /**
   * The steering-file modes available to this workflow's states — mode name ->
   * its format/validate commands (see `ModeDef`). Already the MERGE of the
   * workflow's own `modes:` and the top-level `.gtdrc` `modes:` layer over it
   * (`PatternConfig.mergeModes`, per half), so the engine sees one flat map.
   * Layered over `BUILT_IN_MODES` rather than replacing them: a `qa` entry
   * declaring only `format:` keeps gtd's built-in `qa` validation. Absent (or
   * empty) means "the built-in validators only, no formatting".
   */
  readonly modes?: Readonly<Record<StateMode, ModeDef>>
}

/** Which content kind a state declares, or `undefined` if none (a validation error). */
export const contentKindOf = (state: StateDef): ContentKind | undefined => {
  if (state.script !== undefined) return "script"
  if (state.prompt !== undefined) return "prompt"
  if (state.message !== undefined) return "message"
  if (state.commit !== undefined) return "commit"
  return undefined
}

/** True when a state is a commit (final, squash) state. */
export const isCommitState = (state: StateDef): boolean => state.commit !== undefined

/** The raw template source a state's own content kind carries — `script`/`prompt`/`message`, or `undefined` for a commit state (never at rest, no template a viewer could show). */
export const contentOf = (state: StateDef): string | undefined =>
  state.script ?? state.prompt ?? state.message

/** True when a rest at `state` should open the review checkout window (see `StateDef.reviewWindow`). Safe for an unknown state name (returns `false`). */
export const isReviewWindowState = (def: WorkflowDefinition, state: StateName): boolean =>
  def.states[state]?.reviewWindow === true

/** True when `state` anchors the review window's diff base (see `StateDef.reviewBase`). Safe for an unknown state name (returns `false`). The string/template form of `reviewBase` is NOT a window anchor — this stays narrowed to `=== true` on purpose, never truthy. */
export const isReviewBaseState = (def: WorkflowDefinition, state: StateName): boolean =>
  def.states[state]?.reviewBase === true

/** The named state's `reviewBase` when it is a STRING (an Eta template rendering a commitish that fixes the whole process's diff base — see `StateDef.reviewBase`) — `undefined` when `reviewBase` is `true`, absent, or `state` doesn't exist. Pure accessor only: rendering the template is an edge concern. */
export const entryBaseTemplateOf = (
  def: WorkflowDefinition,
  state: StateName,
): string | undefined => {
  const reviewBase = def.states[state]?.reviewBase
  return typeof reviewBase === "string" ? reviewBase : undefined
}

/** True when a step at `state` must be refused if its only change is deleting the state's `file:` (see `StateDef.requireProgress`). Safe for an unknown state name (returns `false`). */
export const isRequireProgressState = (def: WorkflowDefinition, state: StateName): boolean =>
  def.states[state]?.requireProgress === true

/** True when a step at `state` must be refused unless every open question in its `qa`-mode file is answered (see `StateDef.answerGate`). Safe for an unknown state name (returns `false`). */
export const isAnswerGateState = (def: WorkflowDefinition, state: StateName): boolean =>
  def.states[state]?.answerGate === true

/**
 * Every declared state that is NOT a commit state, sorted (plain string
 * sort). This is intentionally ALL non-commit states, not just ones that
 * declared `entry: true` — `entry: true` is a reachability/visualizer
 * concern (it seeds `entries.manual`), while this drives the CLI's
 * `--entry <state>` guard and its error message (naming every legal choice),
 * a broader set on purpose.
 */
export const enterableStates = (def: WorkflowDefinition): readonly StateName[] =>
  Object.keys(def.states)
    .filter((name) => !isCommitState(def.states[name]!))
    .sort()

// ── Commit-subject grammar ───────────────────────────────────────────────────

/** The ` → ` that separates a transition subject's source state from its target. */
const TRANSITION_SEP = " → "

/**
 * `gtd(<actor>): <from> → <to>` — the subject a step commit carries. Per
 * decision 2, `<actor>` is WHO AUTHORED THE STEP (the invoker); `<to>` is the
 * state being ENTERED and `<from>` the state the authored changes were made
 * in, so the subject reads as what this commit DID, not just where the machine
 * is headed. `from` is optional: when it is omitted or equals `to` (a
 * self-loop, or a manual entry like `gtd step <actor> --entry <state>` that
 * has no meaningful source), the subject collapses to the bare
 * `gtd(<actor>): <to>` form.
 * `resolveState` reads back only `<to>` — the ` → ` prefix is human context.
 */
export const stateSubject = (actor: Actor, to: StateName, from?: StateName): string =>
  from === undefined || from === to
    ? `gtd(${actor}): ${to}`
    : `gtd(${actor}): ${from}${TRANSITION_SEP}${to}`

/** A parsed `gtd(<actor>): <from> → <to>` subject — `actor` is the step's author (the invoker), not necessarily `state`'s own declared actor; `state` is the entered state (`<to>`), `from` the source when the subject carried one. */
export interface ParsedStateSubject {
  readonly actor: Actor
  readonly state: StateName
  readonly from?: StateName
}

const SUBJECT_RE = /^gtd\(([^()]+)\): (.+)$/

/**
 * Parse a raw commit subject as `gtd(<actor>): <from> → <to>` (or the bare
 * `gtd(<actor>): <to>` form). Returns `undefined` for anything else (non-gtd,
 * malformed, or missing either half) — never throws. Trims surrounding
 * whitespace before matching. `state` is always the ENTERED state (`<to>`, the
 * segment after the last ` → `); the pre-arrow segment, when present, is
 * surfaced as `from` for display but is never consulted by `resolveState`.
 */
export const parseStateSubject = (subject: string): ParsedStateSubject | undefined => {
  const match = SUBJECT_RE.exec(subject.trim())
  if (match === null) return undefined
  const actor = match[1]
  const rest = match[2]
  if (actor === undefined || actor === "" || rest === undefined || rest === "") return undefined
  const sepIndex = rest.lastIndexOf(TRANSITION_SEP)
  if (sepIndex === -1) return { actor, state: rest }
  const from = rest.slice(0, sepIndex)
  const state = rest.slice(sepIndex + TRANSITION_SEP.length)
  if (from === "" || state === "") return undefined
  return { actor, state, from }
}

// ── Resolve ──────────────────────────────────────────────────────────────────

/** The workflow's declared initial state (`entries.default` — required, so there is always a value). */
export const initialStateOf = (def: WorkflowDefinition): StateName => def.entries.default

/**
 * Every actor declared by ANY state in the workflow — the closed-world
 * vocabulary a parsed subject's actor is checked against by `resolveState`.
 * Commit states carry no `actor` and so contribute nothing.
 */
const declaredActors = (def: WorkflowDefinition): ReadonlySet<Actor> => {
  const actors = new Set<Actor>()
  for (const state of Object.values(def.states)) {
    if (state.actor !== undefined) actors.add(state.actor)
  }
  return actors
}

/**
 * Resolve HEAD's commit subject to a state name — by STATE NAME ALONE, per
 * decision 2: "History is an attributed state trace; resolution = read
 * HEAD's state name." The subject's actor names WHO AUTHORED the step (the
 * invoker), not who is now awaited — so it is checked only against the
 * workflow's closed-world actor vocabulary (`declaredActors`), never against
 * the resolved state's OWN declared actor. This is what makes a cross-actor
 * handoff resolve correctly: a human stepping out of a human state into an
 * agent state writes `gtd(human): <agent-state>`, and the NEXT invocation
 * must still resolve that subject to `<agent-state>` so the agent (that
 * state's own declared actor) is the one now recognized as awaited.
 *
 * An unrecognized subject — non-`gtd(...)`, malformed, naming a state not
 * defined in this workflow, naming an actor outside the closed-world
 * vocabulary, or naming a commit state — resolves to the INITIAL state; that
 * is the entry point by design (old v1/v2 histories, and every completed
 * process's squash commit, all land here).
 *
 * Commit states are excluded explicitly (`isCommitState`), not via an
 * actor-mismatch trick: entering a commit state always squashes, so no
 * `gtd(<actor>): <commit-state>` subject is ever written by `step` — but a
 * hand-authored one could still appear (e.g. malformed test fixtures), and
 * resolution must never rest AT a commit state regardless, matching the
 * plan's `gtd next` contract (`kind: commit` never appears there).
 */
export const resolveState = (def: WorkflowDefinition, headSubject: string): StateName => {
  const parsed = parseStateSubject(headSubject)
  if (parsed === undefined) return initialStateOf(def)
  const state = def.states[parsed.state]
  if (state === undefined) return initialStateOf(def)
  if (isCommitState(state)) return initialStateOf(def)
  if (!declaredActors(def).has(parsed.actor)) return initialStateOf(def)
  return parsed.state
}

// ── Pattern grammar: parser ──────────────────────────────────────────────────

/** A pending working-tree change, as `git status --porcelain` would report it. */
export type ChangeStatus = "A" | "M" | "D"

/** One pending change: its status letter and repo-relative path. */
export interface PendingChange {
  readonly status: ChangeStatus
  readonly path: string
}

/** A parsed pattern: either the bare clean-tree event, or a status+glob row. */
export type ParsedPattern =
  | { readonly kind: "clean" }
  | { readonly kind: "diff"; readonly status: ChangeStatus | "*"; readonly glob: string }

const STATUSES = new Set(["A", "M", "D", "*"])

/**
 * Parse one `on`-row pattern string: `<status> <glob>` (status ∈ `A|M|D|*`)
 * or the bare token `C` (clean tree). Returns `undefined` for anything else
 * — an unparseable status letter, no glob after the status, or an empty
 * glob. Whitespace around the whole pattern, and between the status and the
 * glob, is tolerated (trimmed); the glob itself is taken verbatim after that
 * (so a glob containing further spaces, e.g. a path with a literal space in
 * it, is preserved intact — only the FIRST space is the status/glob
 * separator). Operates on the ALREADY-Eta-RENDERED pattern string — a
 * workflow author may write `"A <%= it.vars.feedbackFile %>"` in `on:`, but
 * by the time it reaches this parser (or `matchesPattern` below) the edge
 * (`src/Edge.ts`'s `renderOnEdges`) has already substituted `it.vars`; this
 * module never renders anything itself.
 */
export const parsePattern = (raw: string): ParsedPattern | undefined => {
  const trimmed = raw.trim()
  if (trimmed === "C") return { kind: "clean" }
  const spaceIdx = trimmed.indexOf(" ")
  if (spaceIdx === -1) return undefined
  const status = trimmed.slice(0, spaceIdx)
  const glob = trimmed.slice(spaceIdx + 1).trim()
  if (glob === "" || !STATUSES.has(status)) return undefined
  return { kind: "diff", status: status as ChangeStatus | "*", glob }
}

// ── Pattern grammar: glob matcher ────────────────────────────────────────────
//
// Deliberate, tested semantics (the plan doc leaves these as "decide and
// test"):
//  - `*` matches within ONE path segment: it never crosses a `/`. So a
//    single-segment glob like `*` matches `TODO.md` but NOT `.gtd/FEEDBACK.md`
//    (that path has a segment separator the lone `*` can't cross).
//  - `**` matches across segments, including zero of them: `**` alone
//    matches any path at any depth (`TODO.md` AND `.gtd/FEEDBACK.md`).
//    `src/**/*.ts` matches both `src/a.ts` (the `**/` segment matches
//    nothing) and `src/sub/dir/a.ts` (it matches `sub/dir/`).
//  - Dotfiles/dot-directories are NOT special-cased: `*`/`**` match a
//    leading `.` in a path segment the same as any other character (this is
//    a diff-path matcher over `git status` output, not a shell glob with
//    dotglob semantics).
//  - IMPORTANT documented discrepancy: the plan doc's prose calls `"* *"`
//    "the catch-all for any dirty tree" — but per the single-segment rule
//    above, glob `*` does NOT match nested paths. `"* *"` is only a true
//    catch-all when every tracked path is a repo-root file; a workflow that
//    ever touches a subdirectory (e.g. `.gtd/FEEDBACK.md`, `src/x.ts`) needs
//    `"* **"` to catch every dirty tree unconditionally. This module
//    implements the literal single-segment-vs-cross-segment grammar the
//    plan spells out in decision 5 and leaves the `"* *"` prose as
//    imprecise shorthand rather than silently special-casing `*` to mean
//    `**` at the catch-all position.

const ESCAPE_RE = /[.+^${}()|[\]\\]/g

/** Compile one glob (the part after the status letter) to a fully-anchored `RegExp` over a whole path. */
const globToRegExp = (glob: string): RegExp => {
  let pattern = "^"
  let i = 0
  while (i < glob.length) {
    const char = glob[i]!
    if (char === "*") {
      if (glob[i + 1] === "*") {
        i += 2
        if (glob[i] === "/") {
          // "**/" — zero or more path segments, each followed by "/".
          pattern += "(?:.*/)?"
          i += 1
        } else {
          // A trailing/standalone "**" — any remainder, including "/".
          pattern += ".*"
        }
      } else {
        // A lone "*" — anything except a segment separator.
        pattern += "[^/]*"
        i += 1
      }
    } else {
      pattern += char.replace(ESCAPE_RE, "\\$&")
      i += 1
    }
  }
  pattern += "$"
  return new RegExp(pattern)
}

/**
 * Does `pattern` fire against this pending diff? A clean-tree pattern fires
 * iff there are no pending changes; a diff pattern fires iff ANY pending
 * change both matches the status (or `"*"` for any status) and whose path
 * matches the glob in full (contains-match over the CHANGE LIST, not a
 * substring match within one path).
 */
export const matchesPattern = (
  pattern: ParsedPattern,
  changes: readonly PendingChange[],
): boolean => {
  if (pattern.kind === "clean") return changes.length === 0
  const regex = globToRegExp(pattern.glob)
  return changes.some(
    (change) =>
      (pattern.status === "*" || pattern.status === change.status) && regex.test(change.path),
  )
}

// ── Step semantics ───────────────────────────────────────────────────────────

/** The `step` inputs beyond the definition/state/invoker: the pending diff and the current process's state trace. */
export interface StepPayload {
  readonly changes: readonly PendingChange[]
  /** State names entered since the current process started, oldest → newest (does NOT include the prospective new entry). */
  readonly processTrace: readonly StateName[]
}

/** `step` refused: either the wrong actor invoked (out-of-turn), or a dirty tree matched none of the state's declared patterns. */
export type StepRefusal =
  | {
      readonly kind: "refusal"
      readonly reason: "out-of-turn"
      readonly state: StateName
      readonly awaits: Actor
    }
  | {
      readonly kind: "refusal"
      readonly reason: "no-match"
      readonly state: StateName
      readonly patterns: readonly string[]
    }

/** A clean tree with no declared `C` event at this state — commit nothing, exit zero. */
export interface StepNoOp {
  readonly kind: "noop"
  readonly state: StateName
}

/**
 * Commit everything pending as `gtd(<actor>): <from> → <to>` (the target after
 * any retry redirection). `actor` is the INVOKER who authored this step — per
 * decision 2, the subject records "the state being ENTERED and who authored
 * the step", now prefixed with the `<from>` source so the message describes the
 * committed changes rather than only the destination. This works for a
 * cross-actor handoff (a transition whose target
 * is awaited by a different actor than `from`'s) because `resolveState`
 * resolves by STATE NAME ALONE: it never compares the subject's actor against
 * `to`'s own declared actor, so the next invocation lands on `to` regardless
 * of which actor's name the subject carries.
 */
export interface StepCommit {
  readonly kind: "commit"
  readonly subject: string
  readonly actor: Actor
  readonly from: StateName
  readonly to: StateName
}

/** The (possibly retry-redirected) target is a commit state: render-then-squash is an edge concern, this only decides it should happen and hands over the verbatim template. */
export interface StepSquash {
  readonly kind: "squash"
  readonly state: StateName
  readonly template: string
}

export type StepDecision = StepRefusal | StepNoOp | StepCommit | StepSquash

/** First `on`-row whose pattern fires against `changes`, or `undefined` if none do. */
const matchOn = (
  onEdges: readonly OnEdge[],
  changes: readonly PendingChange[],
): StateName | undefined => {
  for (const [patternStr, target] of onEdges) {
    const parsed = parsePattern(patternStr)
    // Malformed rows are a `validateDefinition` finding; a runtime step over
    // an unvalidated definition simply skips them rather than guessing.
    if (parsed === undefined) continue
    if (matchesPattern(parsed, changes)) return target
  }
  return undefined
}

/**
 * Apply retry redirection to a raw `on`-match target: if the target has a
 * `retry` cap and has already been entered `max` times in `trace`, redirect
 * to `otherwise` — and if `otherwise` itself carries a `retry` cap, apply
 * the same check to IT, recursively. `visited` guards against a redirect
 * cycle (A's otherwise is B, B's otherwise is A, both over their caps): once
 * a target is seen twice in one redirect chain, the chain stops there and
 * that target is accepted as final rather than looping forever. This is a
 * documented choice — the plan leaves "recursively?" open; a config that
 * builds such a cycle is almost certainly a bug, but the engine must still
 * terminate rather than hang.
 */
const applyRetry = (
  def: WorkflowDefinition,
  target: StateName,
  trace: readonly StateName[],
  visited: ReadonlySet<StateName> = new Set(),
): StateName => {
  if (visited.has(target)) return target
  const targetDef = def.states[target]
  if (targetDef?.retry === undefined) return target
  const priorVisits = trace.filter((name) => name === target).length
  if (priorVisits < targetDef.retry.max) return target
  return applyRetry(def, targetDef.retry.otherwise, trace, new Set([...visited, target]))
}

/**
 * A plain string-prefix test: is `state` inside `scope`'s subtree? Sound
 * because `src/Machines.ts` already refuses any local name containing a
 * `.` (a compile-time error), so a qualified name's dotted path segments are
 * unambiguous — no tree walk or parent map needed. `scope === ""` is the
 * root scope and matches every state. Otherwise it's an exact match, or a
 * TRUE dotted descendant (`state.startsWith(scope + ".")`) — a same-prefix
 * SIBLING is deliberately not a match: `inScope("packages.itemx.building",
 * "packages.item")` is `false`, because `"packages.itemx"` merely starts
 * with the characters `"packages.item"` without the `.` separator that
 * would make it an actual descendant.
 */
export const inScope = (state: string, scope: string): boolean =>
  scope === "" || state === scope || state.startsWith(`${scope}.`)

/**
 * Resolve the memory scope for `state`, given the process `trace` so far.
 * This is a pure primitive a later package's memory-key computation is
 * built on — it never touches git or the filesystem.
 *
 * `undefined` means `state` itself isn't in `scopes` — memory is an
 * optimization, never a correctness input, so this ambiguous case resolves
 * toward "fresh" by refusing to resolve at all. Otherwise the result always
 * carries `state`'s own scope `M = scopes[state]`, plus an `entryIndex`:
 * the trace position where the CURRENT unbroken run of "in `M`'s subtree"
 * rows began, so a state's own conversation can dip into child scopes
 * (`packages.item.health`, `packages.item.spec`, ...) and back without
 * losing its place — only a trace row whose scope is a sibling or ancestor
 * of `M` (not inside `M`'s subtree) breaks the run. `entryIndex: -1` covers
 * both an empty `trace` and a `trace` with nothing ever inside `M`'s
 * subtree — both are "fresh", just for different reasons. A trace row
 * naming a state absent from `scopes` is skipped rather than thrown on —
 * treated as not-in-scope for both membership and run-continuity.
 */
export const memoryScopeAt = (
  scopes: Readonly<Record<StateName, string>>,
  state: StateName,
  trace: readonly StateName[],
): { readonly scope: string; readonly entryIndex: number } | undefined => {
  const scope = scopes[state]
  if (scope === undefined) return undefined

  let entryIndex = -1
  for (let k = 0; k < trace.length; k++) {
    const rowScope = scopes[trace[k]!]
    if (rowScope === undefined || !inScope(rowScope, scope)) continue
    const prevScope = k === 0 ? undefined : scopes[trace[k - 1]!]
    const prevInScope = prevScope !== undefined && inScope(prevScope, scope)
    if (k === 0 || !prevInScope) entryIndex = k
  }
  return { scope, entryIndex }
}

/**
 * Decide what invoking `invoker` at `state` does — a pure decision, not an
 * effect. Refusals: `invoker` isn't `state`'s declared actor (out-of-turn),
 * or the tree is dirty and no `on` pattern matches (no-match, naming the
 * declared patterns so the CLI can print them). A clean tree with no
 * matching pattern is a no-op (not a refusal) — the loop protocol's clean
 * steps are the default, silent case. A match's target is retry-redirected
 * (`applyRetry`) before being classified: a commit-state target yields a
 * `"squash"` decision carrying its `commit` template verbatim; anything
 * else yields a `"commit"` decision naming the `gtd(<invoker>): <from> → <to>`
 * subject to write — `<invoker>` is who authored this step, per decision 2, not
 * `to`'s own declared actor (see `StepCommit`'s doc comment). Throws only on a
 * structurally invalid call (an undefined
 * `state`, or a commit-state `state` — stepping AT a commit state is a
 * caller error: a commit state ends the process, `resolveState` never rests
 * there).
 */
export const step = (
  def: WorkflowDefinition,
  state: StateName,
  invoker: Actor,
  payload: StepPayload,
): StepDecision => {
  const stateDef = def.states[state]
  if (stateDef === undefined) throw new Error(`step: unknown state "${state}"`)
  if (stateDef.actor === undefined) {
    throw new Error(`step: "${state}" is a commit state — a process never rests there`)
  }

  if (invoker !== stateDef.actor) {
    return { kind: "refusal", reason: "out-of-turn", state, awaits: stateDef.actor }
  }

  const onEdges = stateDef.on ?? []
  const rawTarget = matchOn(onEdges, payload.changes)

  if (rawTarget === undefined) {
    if (payload.changes.length === 0) return { kind: "noop", state }
    return {
      kind: "refusal",
      reason: "no-match",
      state,
      patterns: onEdges.map(([pattern]) => pattern),
    }
  }

  const finalTarget = applyRetry(def, rawTarget, payload.processTrace)
  const targetDef = def.states[finalTarget]
  if (targetDef === undefined) {
    throw new Error(`step: "${state}" transitions to undefined state "${finalTarget}"`)
  }

  if (targetDef.commit !== undefined) {
    return { kind: "squash", state: finalTarget, template: targetDef.commit }
  }

  // A validated definition guarantees a non-commit state declares an actor;
  // an unvalidated one surfaces the gap as a thrown structural error,
  // matching the throws above. (This check no longer drives the written
  // subject — see StepCommit's doc comment — but a target state with no
  // actor at all is still a malformed definition worth failing loudly on.)
  if (targetDef.actor === undefined) {
    throw new Error(`step: "${finalTarget}" is not a commit state but declares no actor`)
  }

  // The written subject names WHO AUTHORED THIS STEP (`invoker`), not the
  // entered state's own declared actor — see StepCommit's doc comment — and
  // carries the `<from> → <to>` transition so the message reads as what the
  // commit DID, not just the state it lands in.
  return {
    kind: "commit",
    subject: stateSubject(invoker, finalTarget, state),
    actor: invoker,
    from: state,
    to: finalTarget,
  }
}

// ── Definition validation ────────────────────────────────────────────────────
//
// Split into one small checker per rule (each returns its own error strings)
// so no single function accumulates the whole rule set's branching — kept
// deliberately flat/composable rather than one large function, to stay under
// fallow's complexity gate as much as for readability.

const CONTENT_KEYS = ["script", "prompt", "message", "commit"] as const

/**
 * `entries.default` names a defined, non-commit state. Every entry in
 * `entries.manual`, when present, must likewise name a defined, non-commit
 * state distinct from `entries.default` — a manual entry is a DELIBERATE,
 * distinct starting point from the workflow's ordinary "no active process"
 * rest (a manual entry requires resting at the default entry before it acts
 * — see `src/program.ts`), so the two must stay distinguishable — and
 * `entries.manual` must carry no duplicate state name within itself.
 */
const validateEntries = (def: WorkflowDefinition, names: readonly string[]): string[] => {
  const errors: string[] = []
  const checkEntry = (key: "default" | "manual", state: StateName) => {
    if (!names.includes(state)) {
      errors.push(`entries.${key} "${state}" is not a defined state`)
      return
    }
    if (isCommitState(def.states[state]!)) {
      errors.push(`entries.${key} "${state}" must not be a commit state`)
    }
    if (key !== "default" && state === def.entries.default) {
      errors.push(`entries.${key} "${state}" must not be the same state as entries.default`)
    }
  }
  checkEntry("default", def.entries.default)
  const seen = new Set<StateName>()
  for (const state of def.entries.manual) {
    checkEntry("manual", state)
    if (seen.has(state)) {
      errors.push(`entries.manual declares "${state}" more than once`)
    }
    seen.add(state)
  }
  return errors
}

/** Exactly one of script/prompt/message/commit. */
const validateContentKind = (name: string, state: StateDef): string[] => {
  const kindCount = CONTENT_KEYS.filter((key) => state[key] !== undefined).length
  return kindCount === 1
    ? []
    : [
        `state "${name}": must declare exactly one of script/prompt/message/commit (found ${kindCount})`,
      ]
}

/** Commit states carry no actor/`on`; every other state must carry an actor. */
const validateActorShape = (name: string, state: StateDef): string[] => {
  if (!isCommitState(state)) {
    return state.actor === undefined
      ? [`state "${name}" must declare an actor (only a commit state may omit one)`]
      : []
  }
  const errors: string[] = []
  if (state.actor !== undefined) errors.push(`commit state "${name}" must not declare an actor`)
  if (state.on !== undefined) errors.push(`commit state "${name}" must not declare "on"`)
  return errors
}

/** `model`, when present, must be a non-empty string; forbidden on a commit state — same rule family as the actor/`on` prohibitions: a commit state is never at rest and emits nothing for a harness to map a model onto. */
const validateModel = (name: string, state: StateDef): string[] => {
  const errors: string[] = []
  if (state.model !== undefined && state.model === "") {
    errors.push(`state "${name}": "model" must be a non-empty string`)
  }
  if (isCommitState(state) && state.model !== undefined) {
    errors.push(`state "${name}": a commit state cannot declare "model"`)
  }
  return errors
}

/** `label`, when present, must be a non-empty string; forbidden on a commit state — same rule family as `model` (`validateModel`): a commit state is never at rest and emits nothing for a driver/viewer to display a label for. */
const validateLabel = (name: string, state: StateDef): string[] => {
  const errors: string[] = []
  if (state.label !== undefined && state.label === "") {
    errors.push(`state "${name}": "label" must be a non-empty string`)
  }
  if (isCommitState(state) && state.label !== undefined) {
    errors.push(`state "${name}": a commit state cannot declare "label"`)
  }
  return errors
}

/**
 * The `modes:` map itself: every declared mode must carry at least one of
 * `format`/`validate`, and neither may be blank (a whitespace-only shell
 * command would run and "succeed", silently disabling the gate). The compiler
 * (`src/PatternConfig.ts`) enforces the TYPES; these are the semantic rules,
 * collected alongside every other finding.
 */
const validateModes = (def: WorkflowDefinition): string[] => {
  const errors: string[] = []
  for (const [mode, commands] of Object.entries(def.modes ?? {})) {
    if (mode === "") errors.push(`"modes" declares a mode with an empty name`)
    for (const key of ["format", "validate"] as const) {
      const command = commands[key]
      if (command !== undefined && command.trim() === "") {
        errors.push(`mode "${mode}": "${key}" must be a non-empty shell command`)
      }
    }
    if (commands.format === undefined && commands.validate === undefined) {
      errors.push(`mode "${mode}": must declare at least one of "format"/"validate"`)
    }
  }
  return errors
}

/**
 * `file`, when present, must be a non-empty string; forbidden on a commit
 * state — same rule family as `model` (`validateModel`): a commit state is
 * never at rest, so it has no file for a human/editor to look at.
 */
const validateFile = (name: string, state: StateDef): string[] => {
  const errors: string[] = []
  if (state.file !== undefined && state.file === "") {
    errors.push(`state "${name}": "file" must be a non-empty string`)
  }
  if (isCommitState(state) && state.file !== undefined) {
    errors.push(`state "${name}": a commit state cannot declare "file"`)
  }
  return errors
}

/**
 * `mode`, when present, must NAME a mode this definition knows — a built-in or
 * a `modes:` entry (`knownModes`) — and requires a sibling `file:`; forbidden
 * on a commit state — same rule family as `model`/`file`. The name check is
 * load-time on purpose: a typo'd mode would otherwise silently disable both the
 * capture gate and the LSP's diagnostics for that file.
 */
const validateMode = (def: WorkflowDefinition, name: string, state: StateDef): string[] => {
  if (state.mode === undefined) return []
  const errors: string[] = []
  if (!knownModes(def).includes(state.mode)) {
    errors.push(
      `state "${name}": "mode" must name a built-in mode (${KNOWN_BUILT_IN_MODES.join(", ")}) or one declared in "modes" (${
        declaredModes(def).length > 0 ? declaredModes(def).join(", ") : "none declared"
      }) (got "${state.mode}")`,
    )
  }
  if (state.file === undefined) {
    errors.push(`state "${name}": "mode" requires "file"`)
  }
  if (isCommitState(state)) {
    errors.push(`state "${name}": a commit state cannot declare "mode"`)
  }
  return errors
}

/**
 * `reviewWindow`/`reviewBase`, when present, are a boolean and a
 * boolean-or-string respectively (the compiler enforces the type) —
 * forbidden on a commit state, same rule family as `model`/`file`/`mode`: a
 * commit state is never at rest, so no window ever opens or anchors there.
 */
const validateReviewWindow = (name: string, state: StateDef): string[] => {
  if (!isCommitState(state)) return []
  const errors: string[] = []
  if (state.reviewWindow !== undefined) {
    errors.push(`state "${name}": a commit state cannot declare "reviewWindow"`)
  }
  if (state.reviewBase !== undefined) {
    errors.push(`state "${name}": a commit state cannot declare "reviewBase"`)
  }
  return errors
}

/**
 * When `reviewBase` is a STRING (the template form — see `StateDef.reviewBase`),
 * its source must be non-blank: a literal `reviewBase: ""` (or whitespace-only)
 * is an authoring error, distinct from the runtime concern of the RENDERED
 * result coming out blank (that refusal lives at the edge, at CLI time — not
 * checked here). Deliberately does NOT check that the template mentions a
 * declared var: a base may legitimately be a literal commitish like `main`.
 */
const validateReviewBaseTemplate = (name: string, state: StateDef): string[] => {
  if (typeof state.reviewBase !== "string") return []
  return state.reviewBase.trim() === ""
    ? [`state "${name}": "reviewBase" template must not be blank`]
    : []
}

/**
 * `requireProgress`, when present, is forbidden on a commit state (never at
 * rest — same rule family as `reviewWindow`/`reviewBase`) and REQUIRES a
 * `file:`: the edge gate refuses a turn whose sole change is deleting that
 * file, so a state with no `file:` to name has nothing to guard.
 */
const validateRequireProgress = (name: string, state: StateDef): string[] => {
  if (state.requireProgress === undefined) return []
  const errors: string[] = []
  if (isCommitState(state)) {
    errors.push(`state "${name}": a commit state cannot declare "requireProgress"`)
  }
  if (state.file === undefined) {
    errors.push(`state "${name}": "requireProgress" requires "file"`)
  }
  return errors
}

/**
 * `answerGate`, when present, is forbidden on a commit state (never at rest —
 * same rule family as `reviewWindow`/`requireProgress`) and REQUIRES a `file:`:
 * the edge gate reads that file's open questions to check every one is answered,
 * so a state with no `file:` to name has nothing to gate. The gate only ACTS
 * when the state also declares `mode: qa` (the built-in checkbox format), but
 * that pairing is an edge concern, not enforced here.
 */
const validateAnswerGate = (name: string, state: StateDef): string[] => {
  if (state.answerGate === undefined) return []
  const errors: string[] = []
  if (isCommitState(state)) {
    errors.push(`state "${name}": a commit state cannot declare "answerGate"`)
  }
  if (state.file === undefined) {
    errors.push(`state "${name}": "answerGate" requires "file"`)
  }
  return errors
}

/** Every `on` row parses, and its target names a defined state. */
const validateOnEdges = (name: string, state: StateDef, names: readonly string[]): string[] => {
  const errors: string[] = []
  for (const [patternStr, target] of state.on ?? []) {
    if (parsePattern(patternStr) === undefined) {
      errors.push(`state "${name}": pattern "${patternStr}" does not parse`)
    }
    if (!names.includes(target)) {
      errors.push(`state "${name}": "on" target "${target}" is not a defined state`)
    }
  }
  return errors
}

/** `retry.otherwise` names a defined state; `retry.max` is a non-negative integer. */
const validateRetry = (name: string, state: StateDef, names: readonly string[]): string[] => {
  if (state.retry === undefined) return []
  const errors: string[] = []
  if (!names.includes(state.retry.otherwise)) {
    errors.push(
      `state "${name}": retry.otherwise "${state.retry.otherwise}" is not a defined state`,
    )
  }
  if (!Number.isInteger(state.retry.max) || state.retry.max < 0) {
    errors.push(`state "${name}": retry.max must be a non-negative integer`)
  }
  return errors
}

/**
 * Every state is reachable from an ENTRY ROOT by walking `on` targets and
 * `retry.otherwise` redirects (a redirect ENTERS its `otherwise` state exactly
 * like an `on` match enters its target — see `applyRetry` — so both are real
 * edges). The roots are `def.entries` — `default` PLUS every state named in
 * `entries.manual`: a manual entry is entered directly (`gtd step <actor>
 * --entry <state>`), so a state reachable only from one of them is
 * legitimately reachable, not dead config (without seeding them, e.g. a
 * manual entry whose only inbound path is `--entry` would be wrongly
 * flagged). Plain BFS; targets naming undefined states are skipped here (they
 * are `validateOnEdges`/`validateRetry` findings of their own). Only called
 * when `validateEntries` found no problem: with an invalid `entries` there is
 * no well-defined start to walk from, and reporting every state as
 * unreachable would bury the real finding.
 *
 * An unreachable state is an ERROR, not a warning: a workflow is bound to a
 * project and edited as a project-wide change, so "kept on purpose for entry
 * via a hand-authored subject" is not a supported authoring pattern — an
 * unreachable state is a typo'd rename or a leftover, and silently-dead
 * config is exactly what load-time validation exists to catch.
 */
const validateReachability = (def: WorkflowDefinition, names: readonly string[]): string[] => {
  const roots = [def.entries.default, ...def.entries.manual]
  const visited = new Set<StateName>(roots)
  const queue: StateName[] = [...roots]
  while (queue.length > 0) {
    const state = def.states[queue.shift()!]!
    const targets = (state.on ?? []).map(([, target]) => target)
    if (state.retry !== undefined) targets.push(state.retry.otherwise)
    for (const target of targets) {
      if (def.states[target] !== undefined && !visited.has(target)) {
        visited.add(target)
        queue.push(target)
      }
    }
  }
  return names
    .filter((name) => !visited.has(name))
    .map(
      (name) =>
        `state "${name}" is unreachable from any entry state (${roots.join(", ")}) (no "on" target or "retry.otherwise" leads to it)`,
    )
}

/** All per-state rule checkers, run over one state. */
const validateState = (
  def: WorkflowDefinition,
  name: string,
  names: readonly string[],
): string[] => {
  const state = def.states[name]!
  return [
    ...validateContentKind(name, state),
    ...validateActorShape(name, state),
    ...validateOnEdges(name, state, names),
    ...validateRetry(name, state, names),
    ...validateModel(name, state),
    ...validateLabel(name, state),
    ...validateFile(name, state),
    ...validateMode(def, name, state),
    ...validateReviewWindow(name, state),
    ...validateReviewBaseTemplate(name, state),
    ...validateRequireProgress(name, state),
    ...validateAnswerGate(name, state),
  ]
}

/**
 * Validate a `WorkflowDefinition`, returning human-readable error strings
 * (empty = valid). Pure — Phase 2 calls this at config-load time. Checks:
 * at least one state; `entries.default` names a defined, non-commit state,
 * and every entry in `entries.manual`, when present, names a defined,
 * non-commit state distinct from `entries.default` with no duplicate within
 * `entries.manual` itself (see `validateEntries`); every state declares
 * exactly one content kind; commit states carry no `actor` and no `on`;
 * non-commit states carry an `actor`; every `on` pattern parses and every
 * `on` target and `retry.otherwise` names a defined state; `retry.max` is a
 * non-negative integer; `model`, when present, is a non-empty string and is
 * never declared on a commit state; `label`, when present, is a non-empty
 * string and is never declared on a commit state (same rule family as
 * `model`); `file`, when
 * present, is a non-empty string and is never declared on a commit state;
 * `mode`, when present, names a mode the definition knows (a built-in or a
 * `modes:` entry — see `knownModes`), requires a sibling `file`, and is
 * never declared on a commit state; every `modes:` entry declares at least
 * one non-blank `format`/`validate` command; `reviewWindow`/`reviewBase`,
 * when present, are never declared on a commit state, and a string-form
 * `reviewBase` template must not be blank (see `validateReviewBaseTemplate`);
 * every state is reachable from an entry root (`def.entries` — `default`
 * plus every `entries.manual` state) by walking `on` targets and
 * `retry.otherwise` redirects (checked only when `validateEntries` itself
 * found no problem — see `validateReachability`).
 */
export const validateDefinition = (def: WorkflowDefinition): readonly string[] => {
  const names = Object.keys(def.states)
  if (names.length === 0) return ["workflow must declare at least one state"]

  const entriesErrors = validateEntries(def, names)
  return [
    ...entriesErrors,
    ...validateModes(def),
    ...names.flatMap((name) => validateState(def, name, names)),
    ...(entriesErrors.length === 0 ? validateReachability(def, names) : []),
  ]
}
