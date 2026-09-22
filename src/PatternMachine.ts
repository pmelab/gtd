import {
  CONTENT_FIELDS,
  STATE_FIELD_ENTRIES,
  validateFieldRules,
  type Actor,
  type ContentKind,
  type OnEdge,
  type RetryDef,
  type RouteRow,
  type StateDef,
  type StateMode,
  type StateName,
} from "./StateFields.js"
import { renderStateTemplate, type TemplateContext } from "./PatternTemplates.js"

export {
  type Actor,
  type ContentKind,
  type OnEdge,
  type RetryDef,
  type RouteRow,
  type StateDef,
  type StateMode,
  type StateName,
}

/**
 * One steering-file mode: the two SHELL COMMANDS that format and validate a
 * file of this format, both Eta templates rendered with `it.file` bound to
 * the steering-file path. Both are EDGE concerns — the pure engine never
 * renders or executes either (`src/SteeringMode.ts` does). At least one must
 * be declared; the halves resolve INDEPENDENTLY, so declaring one leaves the
 * other at whatever the layer beneath provides.
 *
 * - `format` runs FIRST and rewrites the file in place; a non-zero exit is a
 *   hard error (the tooling is broken, not the file). gtd ships no formatter
 *   of its own.
 * - `validate` runs SECOND: exit 0 means valid, non-zero means invalid with
 *   findings on stdout/stderr, one per line.
 */
export interface ModeDef {
  readonly format?: string
  readonly validate?: string
}

export const knownModes = (def: WorkflowDefinition): readonly StateMode[] =>
  Object.keys(def.modes ?? {})

/**
 * The engine's own plumbing directory — the prefix `PatternConfig.ts`'s
 * `stateFile` compiler prepends onto every state's `file:` declaration. A
 * plain const, not a workflow-level declaration: the compiler, the
 * validator, and the runtime guard all import this one value rather than
 * re-deriving their own prefix string.
 */
export const STATE_DIR = ".gtd"

/**
 * The state names a process may START at. `default` is where an ordinary
 * "no active process" rest resumes. `manual` is every state that declared
 * `entry: true`, reached via `gtd --entry <state>` — a DELIBERATE, distinct
 * starting point from `default` (e.g. a review or fix process).
 */
export interface WorkflowEntries {
  readonly default: StateName
  /** Every state that declared `entry: true`, qualified and sorted. Empty array when none declared. */
  readonly manual: readonly StateName[]
}

export interface WorkflowDefinition {
  readonly states: Readonly<Record<StateName, StateDef>>
  readonly entries: WorkflowEntries
  /**
   * The steering-file modes available to this workflow's states — already the
   * MERGE of `src/SteeringFormats.ts`'s built-in registry, the workflow's own
   * `modes:`, and the top-level `.gtdrc` `modes:` layer, so the engine sees
   * one flat map with no privileged names of its own. Absent (or empty) only
   * for a hand-built `WorkflowDefinition` that skipped the compiler.
   */
  readonly modes?: Readonly<Record<StateMode, ModeDef>>
  /** `gtd summary`'s prompt template (an Eta template) — absent makes the command refuse rather than fail at load. */
  readonly summary?: string
}

export const contentKindOf = (state: StateDef): ContentKind | undefined => {
  if (state.script !== undefined) return "script"
  if (state.prompt !== undefined) return "prompt"
  if (state.message !== undefined) return "message"
  return undefined
}

/** The raw template source a state's own content kind carries — `script`/`prompt`/`message`. */
export const contentOf = (state: StateDef): string | undefined =>
  state.script ?? state.prompt ?? state.message

/** True when `state` anchors the review's diff base. Safe for an unknown state name (returns `false`). The string/template form of `reviewBase` is NOT this anchor form — this stays narrowed to `=== true` on purpose, never truthy. */
export const isReviewBaseState = (def: WorkflowDefinition, state: StateName): boolean =>
  def.states[state]?.reviewBase === true

/** The named state's `reviewBase` when it is a STRING (an Eta template rendering a commitish that fixes the whole process's diff base) — `undefined` when `reviewBase` is `true`, absent, or `state` doesn't exist. Pure accessor only: rendering the template is an edge concern. */
export const entryBaseTemplateOf = (
  def: WorkflowDefinition,
  state: StateName,
): string | undefined => {
  const reviewBase = def.states[state]?.reviewBase
  return typeof reviewBase === "string" ? reviewBase : undefined
}

export const isRequireRevertState = (def: WorkflowDefinition, state: StateName): boolean =>
  def.states[state]?.requireRevert === true

/**
 * Every declared state, sorted. This drives the CLI's `--entry <state>` guard
 * and its error message, a broader set than `entries.manual` on purpose.
 */
export const enterableStates = (def: WorkflowDefinition): readonly StateName[] =>
  Object.keys(def.states).sort()

// ── Commit-subject grammar ───────────────────────────────────────────────────

/**
 * Exported (not just module-private) so a test can pin it against any OTHER
 * copy of this literal in the repo — `src/workflows/unified.yaml`'s
 * `healthGate.check` script greps commit subjects for `TRANSITION_SEP +
 * it.state` to bound its `PRIOR_FEEDBACK.md` search to the current episode
 * (see `src/workflows/templates.test.ts`); a change here that isn't mirrored
 * there would silently stop the judge state from ever being reached, with
 * every OTHER test still green.
 */
export const TRANSITION_SEP = " → "

/**
 * `gtd(<actor>): <from> → <to>` — the subject a step commit carries.
 * `<actor>` is WHO AUTHORED THE STEP (the invoker); `<to>` is the state being
 * ENTERED and `<from>` the state the changes were made in, so the subject
 * reads as what this commit DID. `from` is optional: omitted or equal to
 * `to` (a self-loop, or a manual entry with no meaningful source) collapses
 * to the bare `gtd(<actor>): <to>` form. `resolveState` reads back only
 * `<to>` — the ` → ` prefix is human context.
 */
export const stateSubject = (actor: Actor, to: StateName, from?: StateName): string =>
  from === undefined || from === to
    ? `gtd(${actor}): ${to}`
    : `gtd(${actor}): ${from}${TRANSITION_SEP}${to}`

/** A parsed `gtd(<actor>): <from> → <to>` subject — `state` is the entered state (`<to>`), `from` the source when the subject carried one. */
export interface ParsedStateSubject {
  readonly actor: Actor
  readonly state: StateName
  readonly from?: StateName
}

const SUBJECT_RE = /^gtd\(([^()]+)\): (.+)$/

/**
 * Parse a raw commit subject as `gtd(<actor>): <from> → <to>` (or the bare
 * `gtd(<actor>): <to>` form). Returns `undefined` for anything else, never
 * throws. `state` is always the ENTERED state (`<to>`); the pre-arrow
 * segment, when present, is surfaced as `from` but never consulted by
 * `resolveState`.
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

export const initialStateOf = (def: WorkflowDefinition): StateName => def.entries.default

/**
 * Every actor declared by ANY state in the workflow — the closed-world
 * vocabulary a parsed subject's actor is checked against by `resolveState`.
 */
const declaredActors = (def: WorkflowDefinition): ReadonlySet<Actor> => {
  const actors = new Set<Actor>()
  for (const state of Object.values(def.states)) {
    if (state.actor !== undefined) actors.add(state.actor)
  }
  return actors
}

/**
 * Resolve HEAD's commit subject to a state name — by STATE NAME ALONE. The
 * actor is checked only against the workflow's closed-world actor vocabulary
 * (`declaredActors`), never against the resolved state's own declared actor —
 * that's what makes a cross-actor handoff resolve correctly: a human stepping
 * into an agent state writes `gtd(human): <agent-state>`, and the next
 * invocation must still resolve to `<agent-state>` so the agent is the one
 * now awaited.
 *
 * An unrecognized subject — non-`gtd(...)`, malformed, naming an undefined
 * state, or an actor outside the vocabulary — resolves to the INITIAL state
 * (old histories land here).
 */
export const resolveState = (def: WorkflowDefinition, headSubject: string): StateName => {
  const parsed = parseStateSubject(headSubject)
  if (parsed === undefined) return initialStateOf(def)
  const state = def.states[parsed.state]
  if (state === undefined) return initialStateOf(def)
  if (!declaredActors(def).has(parsed.actor)) return initialStateOf(def)
  return parsed.state
}

// ── Pattern grammar: parser ──────────────────────────────────────────────────

export type ChangeStatus = "A" | "M" | "D"

export interface PendingChange {
  readonly status: ChangeStatus
  readonly path: string
}

export type ParsedPattern =
  | { readonly kind: "clean" }
  | { readonly kind: "diff"; readonly status: ChangeStatus | "*"; readonly glob: string }

const STATUSES = new Set(["A", "M", "D", "*"])

/**
 * Parse one `on`-row pattern string: `<status> <glob>` (status ∈ `A|M|D|*`)
 * or the bare token `C` (clean tree). `undefined` for anything else. Only the
 * FIRST space separates status from glob, so a glob containing further spaces
 * (e.g. a path with a literal space) is preserved intact. Operates on the
 * ALREADY-Eta-RENDERED pattern string — the edge substitutes `it.vars` before
 * this parser ever sees it.
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
//  - `*` matches within ONE path segment: it never crosses a `/`. So `*`
//    matches `TODO.md` but NOT `.gtd/FEEDBACK.md`.
//  - `**` matches across segments, including zero of them: `**` alone
//    matches any path at any depth. `src/**/*.ts` matches both `src/a.ts` and `src/sub/dir/a.ts` (illustrative, not real files). // gtd-path-exempt
//  - Dotfiles are NOT special-cased: `*`/`**` match a leading `.` like any
//    other character (this is a diff-path matcher, not a shell glob).
//  - `"* *"` is NOT a catch-all for every dirty tree — a workflow that ever
//    touches a subdirectory needs `"* **"` to catch it unconditionally.

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

/** Fires if any pending change matches both status and glob in full — a contains-match over the change list, not a substring match within one path. */
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

export interface StepPayload {
  readonly changes: readonly PendingChange[]
  /** State names entered since the current process started, oldest → newest (does NOT include the prospective new entry). */
  readonly processTrace: readonly StateName[]
  /**
   * The verdict answered THIS call (from `gtd judge answer`, rendered
   * straight off stdin) — `undefined` for an ordinary `gtd land`, which is
   * exactly the "skipped" case a judge state's own `C` fallback `on:` row
   * covers. Consulted by `step` only when `state` declares `routes:` AND not
   * `shadow:` — see `step`'s routing precedence.
   */
  readonly routeAnswers?: readonly RouteAnswer[]
}

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
 * Commit everything pending as `gtd(<actor>): <from> → <to>` (the target
 * after any retry redirection). `actor` is the INVOKER who authored this
 * step, not `to`'s own declared actor.
 */
export interface StepCommit {
  readonly kind: "commit"
  readonly subject: string
  readonly actor: Actor
  readonly from: StateName
  readonly to: StateName
  /**
   * `true` for a fruitless `prompt`-state dispatch whose diff is EMPTY (no `C`
   * row, clean tree, invoker is the state's own actor). Landed anyway (rather
   * than an inert no-op) so a stall is a pure fold over history (`Edge.ts`'s
   * `stalledAt`); the flag lets the step-capture guards tell an attempt apart
   * from an ordinary capture without re-deriving "empty diff" themselves.
   * Present only when it applies; never `false`.
   */
  readonly attempt?: true
}

export type StepDecision = StepRefusal | StepNoOp | StepCommit

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
 * One answered question from a rendered judge verdict: `{ id, answer, p }`.
 * `answer` is compared against a route row's `is`; `p` against its `minP`.
 */
export interface RouteAnswer {
  readonly id: string
  readonly answer: string
  readonly p: number
}

/**
 * A rendered `minP`/`maxP` string, parsed to a finite number — or `undefined`
 * when the field wasn't declared (the caller supplies its own open-ended
 * default). A declared-but-non-finite value (blank, "off", anything
 * `Number()` can't parse) is reported as `invalid`, never silently coerced:
 * `Number("")` is `0`, which would make a `minP` meant to gate a row instead
 * open it to ANY probability — exactly the failure mode a repo's blank-value
 * "disable this" idiom (`reviewBase: ""`, `judgeIdenticalMinP: ""`) must NOT
 * trigger. `matchRoute` below treats `invalid` as "this row can never match"
 * (fail closed) — the same effect a blank value's AUTHOR actually wants when
 * using it to turn a gate off, and safe by construction for any other typo.
 */
type ParsedBound =
  | { readonly kind: "open" }
  | { readonly kind: "invalid" }
  | { readonly kind: "value"; readonly n: number }
const parseProbabilityBound = (raw: string | undefined): ParsedBound => {
  if (raw === undefined) return { kind: "open" }
  // `Number("")` (and whitespace-only) is `0` — finite, and exactly the
  // dangerous silent-open-floor case this guard exists for — so blank is
  // checked explicitly rather than trusted to `Number.isFinite`.
  if (raw.trim() === "") return { kind: "invalid" }
  const n = Number(raw)
  return Number.isFinite(n) ? { kind: "value", n } : { kind: "invalid" }
}

/**
 * Resolve a judge state's `routes:` against a rendered verdict —
 * first-match-wins, exactly like `matchOn`. A row with no `question` is the
 * catch-all and always matches (a validated definition guarantees it's last).
 * Every other row matches only when `answers` carries a `RouteAnswer` for
 * `row.question` whose `answer` equals `row.is`, whose `p` clears `row.minP`
 * (`>=`, floor `0` when undeclared), AND whose `p` stays under `row.maxP`
 * (`<`, no ceiling when undeclared) — `minP`/`maxP` are ALREADY Eta-rendered
 * here, the same discipline `matchOn` applies to an `on` pattern: the edge
 * substitutes `it.vars` before either ever runs. A row whose declared
 * `minP`/`maxP` doesn't parse to a finite number (`parseProbabilityBound`)
 * never matches, fail-closed. Returns `undefined` only when no row matches at
 * all — a validated definition always ends in a catch-all, so this return
 * only fires for a hand-built/unvalidated `WorkflowDefinition`.
 */
export const matchRoute = (
  routes: readonly RouteRow[],
  answers: readonly RouteAnswer[],
): StateName | undefined => {
  for (const row of routes) {
    if (row.question === undefined) return row.to
    const answer = answers.find((a) => a.id === row.question)
    if (answer === undefined) continue
    if (answer.answer !== row.is) continue
    const minP = parseProbabilityBound(row.minP)
    const maxP = parseProbabilityBound(row.maxP)
    if (minP.kind === "invalid" || maxP.kind === "invalid") continue
    const clearsFloor = minP.kind === "open" || answer.p >= minP.n
    const underCeiling = maxP.kind === "open" || answer.p < maxP.n
    if (clearsFloor && underCeiling) return row.to
  }
  return undefined
}

/** Every state `state`'s edges can enter: its `on` targets, its `routes:` targets, plus its `retry.otherwise` redirect. */
const edgeTargets = (state: StateDef): readonly StateName[] => [
  ...(state.on ?? []).map(([, target]) => target),
  ...(state.routes ?? []).map((row) => row.to),
  ...(state.retry !== undefined ? [state.retry.otherwise] : []),
]

/** Every state whose edges can enter `target` — structural, derived from `def` alone. */
const sourcesOf = (def: WorkflowDefinition, target: StateName): ReadonlySet<StateName> =>
  new Set(
    Object.entries(def.states)
      .filter(([, state]) => edgeTargets(state).includes(target))
      .map(([name]) => name),
  )

/** `target`'s entries since the process last left `target`'s loop. */
const episodeVisits = (
  def: WorkflowDefinition,
  target: StateName,
  trace: readonly StateName[],
): number => {
  const sources = sourcesOf(def, target)
  let count = 0
  for (const name of trace) {
    if (name === target) count += 1
    else if (!sources.has(name)) count = 0
  }
  return count
}

/**
 * Apply retry redirection to a raw `on`-match target: if the target has a
 * `retry` cap and has already been entered `max` times in this EPISODE (see
 * `episodeVisits` — an unrelated red no longer spends this target's budget),
 * redirect to `otherwise`, recursively. `visited` guards against a redirect
 * cycle (A's otherwise is B, B's otherwise is A, both over cap): once a target
 * is seen twice, the chain stops and that target is accepted as final rather
 * than looping forever.
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
  const priorVisits = episodeVisits(def, target, trace)
  if (priorVisits < targetDef.retry.max) return target
  return applyRetry(def, targetDef.retry.otherwise, trace, new Set([...visited, target]))
}

/**
 * Is `state` inside `scope`'s subtree? `scope === ""` is the root scope,
 * matching every state; otherwise an exact match or a TRUE dotted descendant
 * (`state.startsWith(scope + ".")`) — a same-prefix SIBLING is deliberately
 * not a match: `inScope("packages.itemx.building", "packages.item")` is
 * `false`, since `"packages.itemx"` lacks the `.` separator.
 */
export const inScope = (state: string, scope: string): boolean =>
  scope === "" || state === scope || state.startsWith(`${scope}.`)

/**
 * Resolve the memory scope for `state`, given the process `trace` so far.
 * `undefined` means `state` isn't in `scopes` — memory is an optimization,
 * never a correctness input, so this resolves toward "fresh". Otherwise the
 * result carries `state`'s scope `M` plus `entryIndex`: the trace position
 * where the CURRENT unbroken run of "in `M`'s subtree" rows began, so a
 * state's conversation can dip into child scopes and back without losing its
 * place — only a row whose scope is a sibling or ancestor of `M` breaks the
 * run. `entryIndex: -1` covers both an empty trace and one with nothing ever
 * inside `M`'s subtree.
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
 * A verdict answered THIS call (`payload.routeAnswers`) routes via `routes:`
 * instead of `on:` — but only when the state actually declares `routes:` and
 * isn't `shadow:` (a shadowed judgment records but never routes). No verdict
 * this call (an ordinary `gtd land`, or a `shadow:` state) falls through to
 * the state's ordinary `on:` matching in `step` — exactly the "skipped
 * judgment" path, resolved by its own `C` row.
 */
const resolveRoutedTarget = (stateDef: StateDef, payload: StepPayload): StateName | undefined =>
  stateDef.routes !== undefined && stateDef.shadow !== true && payload.routeAnswers !== undefined
    ? matchRoute(stateDef.routes, payload.routeAnswers)
    : undefined

/**
 * The `on:` fallback once no `routes:` verdict picked a target this call: a
 * clean tree with no matching pattern is a plain no-op at a
 * `script`/`message` rest, but at a `prompt` rest it's an ATTEMPT instead —
 * the state itself becomes the raw target, tagged `attempt: true` on the
 * eventual `"commit"` so a fruitless dispatch is still remembered across
 * restarts. Returns either a terminal decision (`refusal`/`noop`) or the raw
 * target plus its attempt flag for `step` to retry-redirect.
 */
const resolveOnTarget = (
  state: StateName,
  stateDef: StateDef,
  payload: StepPayload,
): StepDecision | { readonly target: StateName; readonly attempt: boolean } => {
  const onEdges = stateDef.on ?? []
  const rawTarget = matchOn(onEdges, payload.changes)
  if (rawTarget !== undefined) return { target: rawTarget, attempt: false }
  if (payload.changes.length !== 0) {
    return {
      kind: "refusal",
      reason: "no-match",
      state,
      patterns: onEdges.map(([pattern]) => pattern),
    }
  }
  if (contentKindOf(stateDef) !== "prompt") return { kind: "noop", state }
  // Using the resting state itself as the target means `retry:` on this
  // state counts an attempt exactly like any other entry, redirecting to
  // `otherwise` once capped just like a real transition would.
  return { target: state, attempt: true }
}

/**
 * Decide what invoking `invoker` at `state` does — a pure decision, not an
 * effect. Refusals: `invoker` isn't `state`'s declared actor (out-of-turn),
 * or the tree is dirty and no `on` pattern matches. The target (or attempt's
 * self-target) is retry-redirected (`applyRetry`) before being classified —
 * always yielding `"commit"`. Throws only on a structurally invalid call: an
 * undefined `state`.
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
    throw new Error(`step: "${state}" declares no actor — a process never rests there`)
  }

  if (invoker !== stateDef.actor) {
    return { kind: "refusal", reason: "out-of-turn", state, awaits: stateDef.actor }
  }

  const routedTarget = resolveRoutedTarget(stateDef, payload)
  let target: StateName
  let attempt: boolean
  if (routedTarget !== undefined) {
    target = routedTarget
    attempt = false
  } else {
    const resolved = resolveOnTarget(state, stateDef, payload)
    if ("kind" in resolved) return resolved
    target = resolved.target
    attempt = resolved.attempt
  }

  const finalTarget = applyRetry(def, target, payload.processTrace)
  const targetDef = def.states[finalTarget]
  if (targetDef === undefined) {
    throw new Error(`step: "${state}" transitions to undefined state "${finalTarget}"`)
  }

  // A validated definition guarantees every state declares an actor; an
  // unvalidated one surfaces the gap as a thrown structural error, matching
  // the throws above.
  if (targetDef.actor === undefined) {
    throw new Error(`step: "${finalTarget}" declares no actor`)
  }

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
 * Would a clean step at `state`, invoked by its own declared actor, record
 * ANOTHER attempt that stays AT `state`? Runs `step` itself rather than
 * restating its retry-redirect precedence: a capped `retry` that would
 * redirect the attempt elsewhere makes this `false` — a further dispatch
 * would actually escalate, not repeat the same fruitless turn.
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

const validateEntries = (def: WorkflowDefinition, names: readonly string[]): string[] => {
  const errors: string[] = []
  const checkEntry = (key: "default" | "manual", state: StateName) => {
    if (!names.includes(state)) {
      errors.push(`entries.${key} "${state}" is not a defined state`)
      return
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

const validateContentKind = (name: string, state: StateDef): string[] => {
  const kindCount = CONTENT_FIELDS.filter(
    (key) => (state as unknown as Record<string, unknown>)[key] !== undefined,
  ).length
  return kindCount === 1
    ? []
    : [`state "${name}": must declare exactly one of script/prompt/message (found ${kindCount})`]
}

const validateActorShape = (name: string, state: StateDef): string[] =>
  state.actor === undefined ? [`state "${name}" must declare an actor`] : []

/**
 * A declared mode's `format`/`validate`, when present, may not be blank (a
 * whitespace-only shell command would run and "succeed", silently disabling
 * the gate). An empty entry (`{}`) is legal — the FORMAT-ONLY tier any
 * workflow can use for a name with no gtd-side schema.
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
 * `mode`, when present, must NAME a mode this definition knows (a key of
 * `def.modes`). Load-time on purpose: a typo'd mode would otherwise silently
 * disable both the capture guard and the LSP's diagnostics for that file.
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
 * When `reviewBase` is a STRING, its source must be non-blank — distinct from
 * the runtime concern of the RENDERED result coming out blank (checked at
 * the edge, not here). Deliberately does NOT check that the template mentions
 * a declared var: a base may legitimately be a literal commitish like `main`.
 */
const validateReviewBaseTemplate = (name: string, state: StateDef): string[] => {
  if (typeof state.reviewBase !== "string") return []
  return state.reviewBase.trim() === ""
    ? [`state "${name}": "reviewBase" template must not be blank`]
    : []
}

/**
 * A compiled `file:` must sit under `STATE_DIR` — the compiler already
 * guarantees this for anything it compiles, so this can only fire for a
 * definition hand-built in TypeScript that skipped the compiler entirely.
 */
const validateFileUnderStateDir = (name: string, state: StateDef): string[] => {
  const file = state.file
  if (file === undefined) return []
  return file === STATE_DIR || file.startsWith(`${STATE_DIR}/`)
    ? []
    : [`state "${name}": "file" must be under "${STATE_DIR}/" (got "${file}")`]
}

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
 * One render of `judgeTemplate` against a stub context whose `read` always
 * returns `readStub` (never throws) and whose `vars` are real — extracts
 * `questions[].id` from the rendered JSON, or `undefined` when the render
 * throws or doesn't parse as the expected shape.
 */
const renderJudgeQuestionIds = (
  name: string,
  judgeTemplate: string,
  vars: Record<string, string>,
  readStub: string,
): readonly string[] | undefined => {
  try {
    const ctx: TemplateContext = {
      startCommit: "",
      currentCommit: "",
      previousCommit: "",
      state: name,
      actor: "",
      reviewBase: "",
      processBase: "",
      processCost: 0,
      processCostByModel: [],
      read: () => readStub,
      // Always empty regardless of `readStub`: a load-time stub has no real
      // markdown to parse, and this must agree across BOTH stub renders
      // (`STUB-A`/`STUB-B`) for `judgeQuestionIds` to trust either — see its
      // own comment on why a dynamic-count `judge:` template pads its
      // `questions[]` out to a fixed slot count rather than varying it here.
      sections: () => [],
      // Same "always empty, must agree across both stub renders" rationale as
      // `sections` above — a load-time stub has no real `qa`-mode markdown to
      // parse either.
      openQuestions: () => [],
      openQuestionOptions: () => [],
      vars,
      edges: [],
    }
    const rendered = renderStateTemplate(judgeTemplate, ctx)
    const doc: unknown = JSON.parse(rendered)
    if (typeof doc !== "object" || doc === null || !("questions" in doc)) return undefined
    const questions = (doc as { questions: unknown }).questions
    if (!Array.isArray(questions)) return undefined
    const ids = questions.map((q: unknown) =>
      typeof q === "object" && q !== null && "id" in q ? (q as { id: unknown }).id : undefined,
    )
    return ids.every((id): id is string => typeof id === "string") ? ids : undefined
  } catch {
    return undefined
  }
}

/**
 * Best-effort extraction of a `judge:` template's own declared question ids,
 * for cross-checking a `routes:` row's `question` at LOAD TIME — without any
 * real evidence (git plumbing/working tree). `state`'s value legitimately
 * needs `it.read(...)`, but the `questions` array is declared as a JSON
 * literal inside the same template (Task 1: "computed at render time, never
 * declared in YAML" refers to it being part of the RENDERED document, not
 * authored as a structured field — it is still literal JSON text in the
 * template, not derived from evidence). `vars` are the workflow's OWN
 * declared `vars:` DEFAULTS (`.gtdrc`/entry-commit/env layers don't exist yet
 * at load time, but the declared default is exactly what a `<%= it.vars.x %>`
 * reference resolves to absent those) — so a template that only ever varies
 * `state`/uses a var for prose still renders and parses cleanly here.
 *
 * Rendered TWICE, against two DIFFERENT `it.read` stub values, and only
 * TRUSTED when both renders agree byte-for-byte on every id: `state` — the
 * one field allowed to depend on evidence — is never compared, but a
 * `questions[].id` computed FROM `it.read(...)` (not just `state`) would
 * leak the differing stub through and disagree between the two renders,
 * exactly the false positive a single fixed stub value couldn't catch (an
 * `it.read(...).trim()`-derived id rendering to a real string either way,
 * cross-checked as if it were the evidence-free literal it claims to be).
 * Returns `undefined` — the same "couldn't verify" signal as a render/parse
 * failure — the moment either render fails OR the two disagree, so
 * `validateRoutesQuestionCheck` turns EITHER case into a WARNING, never a
 * false-positive load ERROR.
 */
const judgeQuestionIds = (
  name: string,
  judgeTemplate: string,
  vars: Record<string, string>,
): readonly string[] | undefined => {
  const idsA = renderJudgeQuestionIds(name, judgeTemplate, vars, "STUB-A")
  const idsB = renderJudgeQuestionIds(name, judgeTemplate, vars, "STUB-B")
  if (idsA === undefined || idsB === undefined) return undefined
  if (idsA.length !== idsB.length) return undefined
  return idsA.every((id, i) => id === idsB[i]) ? idsA : undefined
}

/** A row carrying NONE of `question`/`is`/`minP`/`maxP` (only `to`) — `maxP` counts here too, or a `{ maxP, to }` row would misclassify as the catch-all, silently discarding its declared ceiling with no load error and no runtime signal. */
const isCatchAllRoute = (row: RouteRow): boolean =>
  row.question === undefined &&
  row.is === undefined &&
  row.minP === undefined &&
  row.maxP === undefined

/** `question`/`is` are the only fields REQUIRED non-blank on a non-catch-all row — `minP`/`maxP` are each independently optional (`StateFields.ts`'s `RouteRow` doc: "Either bound alone is legal"; a row with neither matches at any probability). */
const ROUTE_ROW_REQUIRED_FIELDS = ["question", "is"] as const

/** Every non-catch-all row's REQUIRED field left blank — the shape errors specific to that case. */
const blankRouteFields = (name: string, row: RouteRow, i: number): string[] =>
  ROUTE_ROW_REQUIRED_FIELDS.filter((field) => row[field] === undefined || row[field] === "").map(
    (field) => `state "${name}": "routes.${i}.${field}" must be a non-empty string`,
  )

/** A non-catch-all row's `question` against the state's own `judge:` question ids — silent (no error) when either side is unavailable: a blank `question` is already a `blankRouteFields` error, and an unresolvable `questionIds` means `judgeQuestionIds` couldn't render/parse (reported separately, once per state, as a warning — see `validateRoutesQuestionCheck`). */
const questionIdError = (
  name: string,
  row: RouteRow,
  i: number,
  questionIds: readonly string[] | undefined,
): string[] => {
  if (row.question === undefined || row.question === "" || questionIds === undefined) return []
  if (questionIds.includes(row.question)) return []
  return [
    `state "${name}": "routes.${i}.question" "${row.question}" is not one of this state's judge: question ids (${questionIds.join(", ")})`,
  ]
}

/** One `routes:` row's shape errors — a single row in isolation, blind to its position in the list. */
const validateRouteRow = (
  name: string,
  row: RouteRow,
  i: number,
  isLast: boolean,
  names: readonly string[],
  questionIds: readonly string[] | undefined,
): string[] => {
  const isCatchAll = isCatchAllRoute(row)
  const errors: string[] = [
    ...(isCatchAll && !isLast
      ? [`state "${name}": "routes.${i}" is a catch-all (only "to") but is not the last row`]
      : []),
    ...(isCatchAll ? [] : blankRouteFields(name, row, i)),
    ...(isCatchAll ? [] : questionIdError(name, row, i, questionIds)),
  ]
  if (!names.includes(row.to)) {
    errors.push(`state "${name}": "routes.${i}.to" target "${row.to}" is not a defined state`)
  }
  return errors
}

/**
 * `routes:` rows, checked in declaration order. Every row's `to` must name a
 * defined state. A non-catch-all row's `question`/`is` are checked for SHAPE
 * (non-blank, and REQUIRED — `minP`/`maxP` are each independently optional,
 * see `ROUTE_ROW_REQUIRED_FIELDS`) and, when the state's own `judge:`
 * template renders and parses cleanly (`judgeQuestionIds`), `question` is
 * also checked against the template's OWN declared question ids — catching a
 * typo'd `question` that would otherwise never match any answer and silently
 * degrade the gate to "no judgment" via the catch-all, with no error
 * anywhere. A `routes:` list must end with EXACTLY one catch-all row (only
 * `to` set) — earlier or missing is a load error, never a runtime surprise.
 */
const validateRoutes = (
  name: string,
  state: StateDef,
  names: readonly string[],
  vars: Record<string, string>,
): string[] => {
  const rows = state.routes
  if (rows === undefined) return []
  const errors: string[] = []
  if (rows.length === 0) {
    errors.push(`state "${name}": "routes" must declare at least one row`)
    return errors
  }
  const questionIds =
    state.judge !== undefined ? judgeQuestionIds(name, state.judge, vars) : undefined
  rows.forEach((row, i) => {
    errors.push(...validateRouteRow(name, row, i, i === rows.length - 1, names, questionIds))
  })
  if (!isCatchAllRoute(rows[rows.length - 1]!)) {
    errors.push(`state "${name}": "routes" must end with a catch-all row carrying only "to"`)
  }
  return errors
}

/**
 * `judgeQuestionIds` couldn't render/parse this state's `judge:` template
 * under the load-time stub — the question-id cross-check ran for every OTHER
 * `routes:` row in this process, but had nothing to check THIS state's
 * `question`s against. A WARNING (not an error): the template may be
 * perfectly valid at runtime, with real evidence available then that isn't
 * here — but staying silent would leave a typo'd `question` on THIS state
 * genuinely unchecked with no signal anywhere, the exact gap round 2's
 * review flagged. Fires at most once per state (not once per row).
 */
const validateRoutesQuestionCheck = (
  name: string,
  state: StateDef,
  vars: Record<string, string>,
): string[] => {
  const rows = state.routes
  if (rows === undefined || state.judge === undefined) return []
  const hasNonCatchAllRow = rows.some((row) => !isCatchAllRoute(row))
  if (!hasNonCatchAllRow) return []
  if (judgeQuestionIds(name, state.judge, vars) !== undefined) return []
  return [
    `state "${name}": "routes.*.question" could not be checked against "judge:"'s own question ids — the template did not render/parse under a load-time stub (no working-tree/git evidence available yet); a typo'd question here will not be caught until runtime`,
  ]
}

/**
 * Every state is reachable from an ENTRY ROOT by walking `on` targets and
 * `retry.otherwise` redirects (both are real edges — a redirect ENTERS its
 * `otherwise` state exactly like an `on` match enters its target). The roots
 * are `default` PLUS every `entries.manual` state, since a manual entry is
 * entered directly (`gtd --entry <state>`) — a state reachable only from one
 * of them is legitimately reachable, not dead config. Only called when
 * `validateEntries` found no problem, since an invalid `entries` has no
 * well-defined start to walk from. An unreachable state is an ERROR, not a
 * warning: silently-dead config is exactly what load-time validation exists
 * to catch.
 */
const validateReachability = (def: WorkflowDefinition, names: readonly string[]): string[] => {
  const roots = [def.entries.default, ...def.entries.manual]
  const visited = new Set<StateName>(roots)
  const queue: StateName[] = [...roots]
  while (queue.length > 0) {
    const state = def.states[queue.shift()!]!
    const targets = [...edgeTargets(state)]
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
        `state "${name}" is unreachable from any entry state (${roots.join(", ")}) (no "on" target, "routes" target, or "retry.otherwise" leads to it)`,
    )
}

/**
 * The per-field checks a generic `validateFieldRules` walk can't express,
 * keyed by the field they own — a LOOKUP, not an enumeration: it grows only
 * when a new field needs a bespoke rule. Called BEFORE that field's generic
 * rules in `validateState`'s table walk.
 */
const BESPOKE: Readonly<
  Record<
    string,
    (
      def: WorkflowDefinition,
      name: string,
      state: StateDef,
      names: readonly string[],
      vars: Record<string, string>,
    ) => string[]
  >
> = {
  on: (_def, name, state, names) => validateOnEdges(name, state, names),
  retry: (_def, name, state, names) => validateRetry(name, state, names),
  routes: (_def, name, state, names, vars) => validateRoutes(name, state, names, vars),
  mode: (def, name, state) => validateKnownMode(def, name, state),
  reviewBase: (_def, name, state) => validateReviewBaseTemplate(name, state),
  file: (_def, name, state) => validateFileUnderStateDir(name, state),
}

/**
 * All per-state rule checkers, run over one state: the two group-rule
 * checkers that don't fit the field table (both span multiple fields at
 * once), then every `STATE_FIELDS` entry in table order, each running its
 * bespoke check (if any) before its generic rules.
 */
const validateState = (
  def: WorkflowDefinition,
  name: string,
  names: readonly string[],
  vars: Record<string, string>,
): string[] => {
  const state = def.states[name]!
  return [
    ...validateContentKind(name, state),
    ...validateActorShape(name, state),
    ...STATE_FIELD_ENTRIES.flatMap(([key, spec]) => [
      ...(BESPOKE[key]?.(def, name, state, names, vars) ?? []),
      ...validateFieldRules(name, state, key, spec),
    ]),
  ]
}

/**
 * A `script`/`message` state with no `C` row commits nothing on a clean tree
 * (the documented no-op default) — that's often deliberate, but silent for a
 * state whose author never considered the clean case. Warn, don't error.
 * Three exemptions, all load-bearing:
 *
 * - The workflow's initial state — a `C` row there would author a commit on
 *   every bare driver invocation.
 * - A `prompt` state — its clean step is an ATTEMPT by design, not a no-op.
 * - A `human`-actor state — `docs/driver.md`'s driver protocol lands a human
 *   gate's OPENING beat unconditionally on every restart while a process
 *   rests there ("Some gates could accept by INACTION..."), specifically
 *   because today that's a harmless no-op when the state has no `C` row. A
 *   `C` row on a human gate would turn every such restart into a real commit
 *   before the human has acted at all — the exact hazard the initial-state
 *   exemption above already exists to avoid, generalized to any human gate a
 *   process can rest at more than once.
 *
 * No exemption for a bare `"* **"` catch-all row or a declared `file:` — a
 * `diff` pattern (including `"* **"`) never matches a clean tree
 * (`matchesPattern`), so neither says anything about the clean case; a state
 * with either and no `C` row still no-ops on a clean tree exactly like one
 * with neither.
 */
const validateHasCRow = (def: WorkflowDefinition, name: string, state: StateDef): string[] => {
  if (name === initialStateOf(def)) return []
  if (state.actor === "human") return []
  const kind = contentKindOf(state)
  if (kind !== "script" && kind !== "message") return []
  const edges = state.on ?? []
  if (edges.some(([pattern]) => pattern === "C")) return []
  return [`state "${name}" declares no "C" row`]
}

/**
 * Validate a `WorkflowDefinition`, returning human-readable error strings
 * (empty = valid) plus non-fatal warning strings. Pure — called at
 * config-load time. Checks at least one state, `entries` shape
 * (`validateEntries`), per-state content/actor/mode/file shape
 * (`validateState`), `modes:` shape, and reachability from an entry root
 * (`validateReachability`, only when entries validated clean). Every
 * per-field rule not listed above (`on`/`retry` targets resolving, `mode`
 * naming a known vocabulary, etc.) is declared once in `src/StateFields.ts`'s
 * `STATE_FIELDS` table instead.
 *
 * `vars` (default `{}`) is the workflow's own declared `vars:` DEFAULTS —
 * the only var layer that exists at load time (`.gtdrc`/entry-commit/env
 * layers don't) — threaded through to `judgeQuestionIds`'s stub render so a
 * `judge:` template referencing `it.vars.x` still resolves for the
 * `routes:` question-id cross-check. Every OTHER call site in this
 * repo (`PatternMachine.test.ts`'s many hand-built definitions) omits it
 * deliberately: those tests aren't exercising the judge/routes surface.
 */
export const validateDefinition = (
  def: WorkflowDefinition,
  vars: Record<string, string> = {},
): { readonly errors: readonly string[]; readonly warnings: readonly string[] } => {
  const names = Object.keys(def.states)
  if (names.length === 0) {
    return { errors: ["workflow must declare at least one state"], warnings: [] }
  }

  const entriesErrors = validateEntries(def, names)
  return {
    errors: [
      ...entriesErrors,
      ...validateModes(def),
      ...names.flatMap((name) => validateState(def, name, names, vars)),
      ...(entriesErrors.length === 0 ? validateReachability(def, names) : []),
    ],
    warnings: [
      ...names.flatMap((name) => validateHasCRow(def, name, def.states[name]!)),
      ...names.flatMap((name) => validateRoutesQuestionCheck(name, def.states[name]!, vars)),
    ],
  }
}
