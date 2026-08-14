/**
 * The pattern machine — gtd's state-machine core. This module is the pure
 * engine: definition types, the pattern grammar's
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
 * via `gtd --entry <state>`). A definition
 * may also declare `modes:` —
 * named pairs of format/validate shell commands a state's `mode:` can point
 * at (see `ModeDef`); they are inert data here too, rendered and executed
 * only at the edge (`src/SteeringMode.ts`).
 *
 * This module is intentionally pure — no git, no filesystem, no Effect, no
 * IO of any kind: every export is a plain function of its arguments.
 * Rendering templates (`src/PatternTemplates.ts`), walking git history for
 * the process trace (`src/Edge.ts`), and emitting the commit/squash scripts
 * a driver runs (`src/Edge.ts`/`src/Emit.ts`) are all EDGE concerns.
 *
 * Its one import is `./StateFields.js` — the state-field vocabulary
 * (`Actor`, `StateName`, `ContentKind`, `StateMode`, `OnEdge`, `RetryDef`,
 * `StateDef`, `isCommitState`) and the `STATE_FIELDS` table every state
 * property's declaration, compilation, validation, editor schema, and
 * visualizer presentation derive from, itself a zero-import leaf of `const`
 * data and total functions. Read that table for what a state may declare —
 * this module no longer enumerates the field vocabulary itself, only
 * re-exports it.
 */

// ── Definition types ─────────────────────────────────────────────────────────
//
// The field vocabulary (`Actor`, `StateName`, `ContentKind`, `StateMode`,
// `OnEdge`, `RetryDef`, `StateDef`, `isCommitState`) lives in
// `src/StateFields.ts` — a zero-import leaf of `const` data (`STATE_FIELDS`)
// plus total functions that every compilation/validation/schema/visualizer
// site derives from, so a new state property is one table entry plus its
// behaviour rather than an eight-site edit. Re-exported here (erased at
// build time by `verbatimModuleSyntax`) so every existing
// `from "./PatternMachine.js"` import keeps working unchanged.

import {
  CONTENT_FIELDS,
  STATE_FIELD_ENTRIES,
  isCommitState,
  validateFieldRules,
  type Actor,
  type ContentKind,
  type OnEdge,
  type RetryDef,
  type StateDef,
  type StateMode,
  type StateName,
} from "./StateFields.js"

export {
  isCommitState,
  type Actor,
  type ContentKind,
  type OnEdge,
  type RetryDef,
  type StateDef,
  type StateMode,
  type StateName,
}

/**
 * One steering-file mode: the two SHELL COMMANDS that format and validate a
 * file of this format. Both are Eta templates rendered with the state's usual
 * template context plus `it.file` (the rendered steering-file path — see
 * `PatternTemplates.ModeCommandContext`), and both are entirely EDGE concerns:
 * the pure engine never renders or executes either (`src/SteeringMode.ts`
 * does, for `gtd validate` and the `gtd land` capture gate). At least one of
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

/** Every mode name `def` declares in `modes:` (empty when it declares none) — the whole vocabulary a state's `mode:` may name, per this module (see `StateMode`'s doc comment for where the registry names come from). */
export const knownModes = (def: WorkflowDefinition): readonly StateMode[] =>
  Object.keys(def.modes ?? {})

/** The engine's own default for `WorkflowDefinition.stateDir` — see `stateDirOf`. The one place `.gtd` is spelled as the engine's default. */
export const DEFAULT_STATE_DIR = ".gtd"

/**
 * `def`'s declared plumbing directory — the raw Eta template source a
 * workflow carried on `stateDir:`, or `DEFAULT_STATE_DIR` when it declared
 * none (so a workflow declaring nothing, and every hand-built test fixture
 * that skipped the compiler, behaves exactly as before this key existed).
 * Rendering the template is an edge concern, exactly like `entryBaseTemplateOf`
 * — this module only carries and defaults the raw string.
 */
export const stateDirOf = (def: WorkflowDefinition): string => def.stateDir ?? DEFAULT_STATE_DIR

/**
 * The leading-`./` + trailing-`/` strip shared by `stateDirError` and
 * `src/Edge.ts`'s `renderStateDir` — the one tolerated rewrite of a
 * `stateDir` declaration, covering the two conventional spellings a
 * hand-written template or `.gtdrc` value commonly carries. Exported as one
 * function rather than duplicated at the edge so the two call sites can never
 * drift into tolerating different affixes. Anything beyond these two is a
 * spelling `stateDirError` rejects rather than rewrites — the strip is
 * tolerance, not full canonicalization; it does not touch an internal `.` or
 * empty segment.
 */
export const canonicalStateDir = (value: string): string =>
  value.replace(/^\.\//, "").replace(/\/+$/, "")

/**
 * The one place the engine interprets a `stateDir` VALUE (never the var
 * NAME) — pure and total, so both the edge (on the rendered, normalized
 * value, before any consumer sees it — see `src/Edge.ts`'s
 * `renderStateDirOrFail`) and a test can call it directly. Returns the
 * error message when `value` cannot name a usable plumbing directory,
 * `undefined` when it can.
 *
 * Rejects, in this order: blank/whitespace-only; the repo root (`.`, `./`,
 * `/`, or empty once a leading `./` and trailing `/` are stripped); an
 * absolute path (a leading `/` after that stripping); any `..` segment (an
 * escape); any other `.` or empty path segment (a non-canonical spelling —
 * `a/./state`, `a//state`, `a/.` — rejected rather than silently
 * canonicalized, since every downstream consumer compares `it.stateDir`
 * rather than re-normalizing it). The `..` escape check runs BEFORE the
 * segment-canonicality check so a value carrying BOTH is always reported as
 * an escape, never as a spelling to rewrite — `a/.././state` (segments `a`,
 * `..`, `.`, `state`) would, under the reverse order, suggest the canonical
 * spelling `"a/../state"`, a rewrite that still escapes the repo. `..` is
 * deliberately not in the canonicality predicate — it is an escape, not a
 * spelling. Deliberately does its own stripping rather than requiring an
 * already-normalized `value` — a caller may hand it either the raw
 * declaration or the edge's normalized form and get the same verdict, which
 * is what lets a unit test exercise `"./"` directly.
 */
export const stateDirError = (value: string): string | undefined => {
  const invalid = (): string =>
    `"stateDir": must name a directory inside the repository, not the repo root, an absolute path, or a path outside it (got ${JSON.stringify(value)})`
  if (value.trim() === "") return invalid()
  const stripped = canonicalStateDir(value)
  if (stripped === "" || stripped === ".") return invalid()
  if (stripped.startsWith("/")) return invalid()
  const segments = stripped.split("/")
  if (segments.includes("..")) return invalid()
  if (segments.some((segment) => segment === "." || segment === "")) {
    const canonical = segments.filter((segment) => segment !== "." && segment !== "").join("/")
    return `"stateDir": ${JSON.stringify(stripped)} is not a canonical path — write it as ${JSON.stringify(canonical)}`
  }
  return undefined
}

/**
 * The state names a process may START at. `default` is where an ordinary
 * "no active process" rest resumes (see `initialStateOf`) — required, so there
 * is always a value. `manual` is every OTHER state a process may start at:
 * every state that declared `entry: true` in the source config, qualified and
 * sorted by the compiler, empty when the workflow declares none. A manual
 * entry is reached via `gtd --entry <state>` (`src/program.ts`)
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
   * its format/validate commands (see `ModeDef`). Already the MERGE of
   * `src/SteeringFormats.ts`'s built-in registry (seeded as empty entries),
   * the workflow's own `modes:`, and the top-level `.gtdrc` `modes:` layer
   * over that (`PatternConfig.compileWorkflowConfig`/`mergeModes`, per half),
   * so the engine sees one flat map with no privileged names of its own — a
   * `qa` entry declaring only `format:` keeps that format's built-in `qa`
   * validation (resolved at the edge, see `src/SteeringMode.ts`) because the
   * registry seed is still present underneath, not because this module knows
   * the name `qa`. Absent (or empty) is possible only for a hand-built
   * `WorkflowDefinition` that skipped the compiler (e.g. a test fixture) —
   * every COMPILED definition always carries at least the registry's seeded
   * entries.
   */
  readonly modes?: Readonly<Record<StateMode, ModeDef>>
  /**
   * The raw Eta template source for where this workflow keeps its own
   * plumbing (gtd's scratch/bookkeeping directory, e.g. the review window's
   * revert pathspec and the step guards' code-vs-plumbing test) — carried
   * verbatim, exactly as authored, never rendered here (the same discipline
   * as a state's own `file:`). Absent when the workflow declared no
   * `stateDir:`; see `stateDirOf` for the defaulted accessor.
   *
   * This is a DIFFERENT thing from `it.vars.stateDir`, on purpose, despite
   * sharing a name: `stateDir:` here is the definition-level declaration the
   * engine reads (so the value can reach `enforceStepGuards`'s
   * once-per-call `hasCodeChange`, rather than any one guard reaching into
   * `it.vars` itself — a blessed-config-key the engine forbids); `vars.stateDir`
   * is an ordinary workflow var, the knob a user overrides, that the bundled
   * template happens to render this declaration from. Same call as the
   * per-state `entry:` flag sharing a name with the top-level `entry:`
   * machine key.
   */
  readonly stateDir?: string
}

/** Which content kind a state declares, or `undefined` if none (a validation error). */
export const contentKindOf = (state: StateDef): ContentKind | undefined => {
  if (state.script !== undefined) return "script"
  if (state.prompt !== undefined) return "prompt"
  if (state.message !== undefined) return "message"
  if (state.commit !== undefined) return "commit"
  return undefined
}

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

/** True when a step at `state` must be refused unless the human's review-round paths have actually been reverted from the working tree (see `StateDef.requireRevert`). Safe for an unknown state name (returns `false`). */
export const isRequireRevertState = (def: WorkflowDefinition, state: StateName): boolean =>
  def.states[state]?.requireRevert === true

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
 * self-loop, or a manual entry like `gtd --entry <state>` that
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
  /**
   * `true` for a fruitless `prompt`-state dispatch: the resting state declared
   * no `C` row, the tree came back clean, and the state's own actor is the
   * invoker — so this commit's diff is EMPTY. Landing it anyway (rather than
   * the old inert no-op) is what makes a stall a pure fold over history (see
   * `Edge.ts`'s `stalledAt`); the flag rides along so the two places that must
   * treat an attempt differently from an ordinary self-loop capture — the
   * initial-state collapse (`Edge.ts`'s `collapsesWith`) and the step-capture
   * guards (`StepGuards.ts`) — can tell the two apart without re-deriving
   * "empty diff" themselves. Present (`true`) only when it applies; never
   * `false`.
   */
  readonly attempt?: true
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
 * matching pattern is a plain no-op at a `script`/`message` rest — the loop
 * protocol's clean steps are the default, silent case there — but at a
 * `prompt` rest it is an ATTEMPT instead: the state itself becomes the raw
 * target, so it falls through the same retry/commit-state tail as a real
 * match, tagged `attempt: true` on the resulting `"commit"` (never on a
 * `"squash"`, which a redirect straight into a commit state still produces
 * unchanged) — see `StepCommit.attempt`'s doc comment for why a fruitless
 * dispatch is committed at all, and `wouldAttempt` for the "would another
 * dispatch just repeat this" question a step itself doesn't need to ask. A
 * match's target (or an attempt's self-target) is retry-redirected
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

  // A clean tree matching no declared `C` row is a plain no-op at a
  // `script`/`message` rest (unchanged), but at a `prompt` rest it is an
  // ATTEMPT: the dispatch cost something and produced nothing, so it must be
  // remembered across restarts (see `Edge.ts`'s `stalledAt`) rather than
  // vanish silently. Treating the resting state itself as the raw target and
  // falling through the ordinary retry/commit-state tail below means
  // `retry:` on this state counts attempts exactly like any other entry, and
  // a capped retry redirects an attempt to `otherwise` exactly like it would
  // redirect a real transition.
  let target = rawTarget
  let attempt = false
  if (target === undefined) {
    if (payload.changes.length !== 0) {
      return {
        kind: "refusal",
        reason: "no-match",
        state,
        patterns: onEdges.map(([pattern]) => pattern),
      }
    }
    if (contentKindOf(stateDef) !== "prompt") return { kind: "noop", state }
    target = state
    attempt = true
  }

  const finalTarget = applyRetry(def, target, payload.processTrace)
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
    ...(attempt ? { attempt: true as const } : {}),
  }
}

/**
 * Would a clean step (an empty change set) at `state`, invoked by its own
 * declared actor, record ANOTHER attempt that stays AT `state` — "another
 * dispatch would just record another attempt" (see `Edge.ts`'s `stalledAt`,
 * the derived stall's other half). Runs `step` itself rather than
 * restating its retry-redirect precedence: a capped `retry` that would
 * redirect the attempt to `otherwise` (or squash it into a commit state)
 * makes this `false` — a further dispatch would actually escalate, not
 * repeat the same fruitless turn. `false` for an unknown/commit state, or
 * any state whose clean step is a signal (`C`) or a plain no-op
 * (`script`/`message`).
 */
export const wouldAttempt = (
  def: WorkflowDefinition,
  state: StateName,
  processTrace: readonly StateName[],
): boolean => {
  const stateDef = def.states[state]
  if (stateDef?.actor === undefined) return false
  const decision = step(def, state, stateDef.actor, { changes: [], processTrace })
  return decision.kind === "commit" && decision.attempt === true && decision.to === state
}

// ── Definition validation ────────────────────────────────────────────────────
//
// Split into one small checker per rule (each returns its own error strings)
// so no single function accumulates the whole rule set's branching — kept
// deliberately flat/composable rather than one large function, to stay under
// fallow's complexity gate as much as for readability.

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
  const kindCount = CONTENT_FIELDS.filter(
    (key) => (state as unknown as Record<string, unknown>)[key] !== undefined,
  ).length
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

/**
 * The `modes:` map itself: a declared mode's `format`/`validate`, when
 * present, may not be blank (a whitespace-only shell command would run and
 * "succeed", silently disabling the gate). An empty entry (`{}`) is legal — the
 * FORMAT-ONLY tier any workflow can use for a name with no gtd-side schema
 * (e.g. a project's own `modes: { adr: {} }` before it plugs in any command
 * at all). The compiler
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
  }
  return errors
}

/**
 * `mode`, when present, must NAME a mode this definition knows — i.e. a key of
 * `def.modes`, which the compiler seeds with `src/SteeringFormats.ts`'s
 * built-in registry names before layering `modes:` over them, so this module
 * blesses no name of its own. Load-time on purpose: a typo'd mode would
 * otherwise silently disable both the capture guard and the LSP's diagnostics
 * for that file. The "forbidden on a commit state" and "requires a sibling
 * `file:`" halves are `STATE_FIELDS.mode`'s generic `commit`/`requires` rules
 * (see `validateFieldRules`) — this bespoke checker only owns the name
 * resolution a generic rule can't express.
 */
const validateKnownMode = (def: WorkflowDefinition, name: string, state: StateDef): string[] => {
  const known = knownModes(def)
  if (state.mode === undefined || known.includes(state.mode)) return []
  return [
    `state "${name}": "mode" must name a mode this workflow knows (${
      known.length > 0 ? known.join(", ") : "none declared"
    }) (got "${state.mode}")`,
  ]
}

/**
 * `stateDir`, when DECLARED, must be non-blank — the same
 * blank/whitespace-only check `validateReviewBaseTemplate` runs for a string
 * `reviewBase` template. Deliberately checks nothing else: `stateDirError`'s
 * repo-root/absolute/escape rules apply to the RENDERED value, which this
 * load-time pass can't see (the bundled declaration is itself a template,
 * e.g. `<%= it.vars.stateDir %>`, whose var can arrive at runtime via a
 * `GTD_STATEDIR` override no load-time check could ever observe — see
 * `renderStateDirOrFail` in `src/Edge.ts` for the one site that does own
 * that rule).
 */
const validateStateDir = (def: WorkflowDefinition): string[] =>
  def.stateDir !== undefined && def.stateDir.trim() === ""
    ? [`"stateDir" template must not be blank`]
    : []

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
 * `entries.manual`: a manual entry is entered directly (`gtd --entry
 * <state>`), so a state reachable only from one of them is
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

/**
 * The per-field checks that a generic `validateFieldRules` walk can't
 * express, keyed by the field they own — a LOOKUP, not an enumeration: it
 * does not grow when a new field is added to `STATE_FIELDS`, only when a new
 * field needs a bespoke rule (a pattern parsing, a name resolving against
 * dynamic vocabulary, a template being non-blank). Every survivor here is
 * called BEFORE that same field's generic rules in `validateState`'s table
 * walk, matching each field's own historical check order.
 */
const BESPOKE: Readonly<
  Record<
    string,
    (def: WorkflowDefinition, name: string, state: StateDef, names: readonly string[]) => string[]
  >
> = {
  on: (_def, name, state, names) => validateOnEdges(name, state, names),
  retry: (_def, name, state, names) => validateRetry(name, state, names),
  mode: (def, name, state) => validateKnownMode(def, name, state),
  reviewBase: (_def, name, state) => validateReviewBaseTemplate(name, state),
}

/**
 * All per-state rule checkers, run over one state: the two group-rule
 * checkers that don't fit the field table (`validateContentKind`,
 * `validateActorShape` — both span multiple fields at once), then every
 * `STATE_FIELDS` entry in table order, each running its bespoke check (if
 * any, from `BESPOKE`) before its generic `nonEmpty`/`commit`/`requires`
 * rules (`validateFieldRules`).
 */
const validateState = (
  def: WorkflowDefinition,
  name: string,
  names: readonly string[],
): string[] => {
  const state = def.states[name]!
  return [
    ...validateContentKind(name, state),
    ...validateActorShape(name, state),
    ...STATE_FIELD_ENTRIES.flatMap(([key, spec]) => [
      ...(BESPOKE[key]?.(def, name, state, names) ?? []),
      ...validateFieldRules(name, state, key, spec),
    ]),
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
 * non-commit states carry an `actor`; every `modes:` entry declares at least
 * one non-blank `format`/`validate` command; a DECLARED `stateDir` template is
 * non-blank (`validateStateDir` — the value-shape rule, `stateDirError`, is a
 * runtime/edge concern, not checked here); every state is reachable from an
 * entry root (`def.entries` — `default` plus every `entries.manual` state) by
 * walking `on` targets and `retry.otherwise` redirects (checked only when
 * `validateEntries` itself found no problem — see `validateReachability`).
 *
 * Every OTHER per-field rule (`on`/`retry` targets resolving, `retry.max`
 * being a non-negative integer, a text field's non-empty/commit-forbidden
 * shape, `mode` naming a known vocabulary and requiring a sibling `file`,
 * `reviewWindow`/`reviewBase`/`requireProgress`/`answerGate` each being
 * forbidden on a commit state and (where declared) requiring a `file`, a
 * string-form `reviewBase` template not being blank) is declared ONCE, in
 * `src/StateFields.ts`'s `STATE_FIELDS` table — see that module for the
 * authoritative per-field contract; `validateState` walks it via
 * `validateFieldRules` plus the small `BESPOKE` set of checks a generic rule
 * can't express.
 */
export const validateDefinition = (def: WorkflowDefinition): readonly string[] => {
  const names = Object.keys(def.states)
  if (names.length === 0) return ["workflow must declare at least one state"]

  const entriesErrors = validateEntries(def, names)
  return [
    ...entriesErrors,
    ...validateModes(def),
    ...validateStateDir(def),
    ...names.flatMap((name) => validateState(def, name, names)),
    ...(entriesErrors.length === 0 ? validateReachability(def, names) : []),
  ]
}
