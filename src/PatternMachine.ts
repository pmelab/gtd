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
}

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

/** True when a rest at `state` should open the review checkout window. Safe for an unknown state name (returns `false`). */
export const isReviewWindowState = (def: WorkflowDefinition, state: StateName): boolean =>
  def.states[state]?.reviewWindow === true

/** True when `state` anchors the review window's diff base. Safe for an unknown state name (returns `false`). The string/template form of `reviewBase` is NOT a window anchor — this stays narrowed to `=== true` on purpose, never truthy. */
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

export const isRequireProgressState = (def: WorkflowDefinition, state: StateName): boolean =>
  def.states[state]?.requireProgress === true

export const isAnswerGateState = (def: WorkflowDefinition, state: StateName): boolean =>
  def.states[state]?.answerGate === true

export const isRequireRevertState = (def: WorkflowDefinition, state: StateName): boolean =>
  def.states[state]?.requireRevert === true

/**
 * Every declared state that is NOT a commit state, sorted. Intentionally ALL
 * non-commit states, not just ones that declared `entry: true` — this drives
 * the CLI's `--entry <state>` guard and its error message, a broader set on
 * purpose.
 */
export const enterableStates = (def: WorkflowDefinition): readonly StateName[] =>
  Object.keys(def.states)
    .filter((name) => !isCommitState(def.states[name]!))
    .sort()

// ── Commit-subject grammar ───────────────────────────────────────────────────

const TRANSITION_SEP = " → "

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
 * Resolve HEAD's commit subject to a state name — by STATE NAME ALONE. The
 * actor is checked only against the workflow's closed-world actor vocabulary
 * (`declaredActors`), never against the resolved state's own declared actor —
 * that's what makes a cross-actor handoff resolve correctly: a human stepping
 * into an agent state writes `gtd(human): <agent-state>`, and the next
 * invocation must still resolve to `<agent-state>` so the agent is the one
 * now awaited.
 *
 * An unrecognized subject — non-`gtd(...)`, malformed, naming an undefined
 * state, an actor outside the vocabulary, or a commit state — resolves to the
 * INITIAL state (old histories and every completed process's squash commit
 * land here). Commit states are excluded explicitly rather than via an
 * actor-mismatch trick, since a hand-authored subject could still name one
 * even though `step` never writes one.
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
//    matches any path at any depth. `src/**/*.ts` matches both `src/a.ts`
//    and `src/sub/dir/a.ts`.
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
   * `stalledAt`); the flag lets the initial-state collapse and the
   * step-capture guards tell an attempt apart from an ordinary capture
   * without re-deriving "empty diff" themselves. Present only when it
   * applies; never `false`.
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

/** Every state `state`'s edges can enter: its `on` targets plus its `retry.otherwise` redirect. */
const edgeTargets = (state: StateDef): readonly StateName[] => [
  ...(state.on ?? []).map(([, target]) => target),
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
 * Decide what invoking `invoker` at `state` does — a pure decision, not an
 * effect. Refusals: `invoker` isn't `state`'s declared actor (out-of-turn),
 * or the tree is dirty and no `on` pattern matches. A clean tree with no
 * matching pattern is a plain no-op at a `script`/`message` rest, but at a
 * `prompt` rest it's an ATTEMPT instead: the state itself becomes the raw
 * target, falling through the same retry/commit-state tail as a real match,
 * tagged `attempt: true` on the resulting `"commit"` — a fruitless `prompt`
 * dispatch still costs money and must be remembered across restarts, so it's
 * committed rather than treated as an inert no-op. The target (or attempt's
 * self-target) is retry-redirected (`applyRetry`) before being classified: a
 * commit-state target yields `"squash"`; anything else yields `"commit"`.
 * Throws only on a structurally invalid call — an undefined `state`, or a
 * commit-state `state` (stepping AT a commit state is a caller error).
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

  // Using the resting state itself as the raw target means `retry:` on this
  // state counts an attempt exactly like any other entry, redirecting to
  // `otherwise` once capped just like a real transition would.
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
  // an unvalidated one surfaces the gap as a thrown structural error, matching
  // the throws above. A target state with no actor at all is still a
  // malformed definition worth failing loudly on.
  if (targetDef.actor === undefined) {
    throw new Error(`step: "${finalTarget}" is not a commit state but declares no actor`)
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
        `state "${name}" is unreachable from any entry state (${roots.join(", ")}) (no "on" target or "retry.otherwise" leads to it)`,
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
    (def: WorkflowDefinition, name: string, state: StateDef, names: readonly string[]) => string[]
  >
> = {
  on: (_def, name, state, names) => validateOnEdges(name, state, names),
  retry: (_def, name, state, names) => validateRetry(name, state, names),
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
 * (empty = valid). Pure — called at config-load time. Checks at least one
 * state, `entries` shape (`validateEntries`), per-state content/actor/mode/
 * file shape (`validateState`), `modes:` shape, and reachability from an
 * entry root (`validateReachability`, only when entries validated clean).
 * Every per-field rule not listed above (`on`/`retry` targets resolving,
 * `mode` naming a known vocabulary, etc.) is declared once in
 * `src/StateFields.ts`'s `STATE_FIELDS` table instead.
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
