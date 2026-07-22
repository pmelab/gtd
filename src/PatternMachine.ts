/**
 * The v3 "pattern machine": gtd's ground-up rewrite of the state-machine
 * core (see `docs/design/pattern-machine-plan.md`). Phase 1 scope only —
 * this module is the pure engine: definition types, the pattern grammar's
 * parser/matcher, HEAD resolution, and step decisions (refusals, no-ops,
 * commits, retry redirection, and the commit-state squash decision).
 *
 * A workflow here is nothing but named **states**: no gates, no guard
 * functions, no actor kinds, no counters-as-trailers, no interrupt/fallback
 * ladders. Every state declares who acts there (`actor`, absent on commit
 * states), exactly one content kind (`script` | `prompt` | `message` |
 * `commit`, all opaque strings — template rendering is NOT this module's
 * job), an ordered `on` map of change-patterns to next states (absent on
 * commit states), optionally `initial: true` (exactly one state must carry
 * it), and an optional `retry` cap.
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
 * One `on` row: a raw pattern string paired with its target state. Kept as
 * an ordered PAIR (not an object key) so declaration order survives
 * regardless of how a definition is built — object key order is an
 * incidental JS guarantee that a config compiler (YAML, merged definitions)
 * could easily break by rebuilding an object; a tuple array cannot silently
 * reorder or dedupe two rows that happen to share a pattern string.
 */
export type OnEdge = readonly [pattern: string, target: StateName]

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
  readonly initial?: true
  readonly retry?: RetryDef
}

/** A workflow: named states. Exactly one must declare `initial: true`. */
export interface WorkflowDefinition {
  readonly states: Readonly<Record<StateName, StateDef>>
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

// ── Commit-subject grammar ───────────────────────────────────────────────────

/**
 * `gtd(<actor>): <state>` — the subject a step commit carries. Per decision
 * 2, `<actor>` is WHO AUTHORED THE STEP (the invoker), and `<state>` is the
 * state being ENTERED; `resolveState` reads back only the state name.
 */
export const stateSubject = (actor: Actor, state: StateName): string => `gtd(${actor}): ${state}`

/** A parsed `gtd(<actor>): <state>` subject — `actor` is the step's author (the invoker), not necessarily `state`'s own declared actor. */
export interface ParsedStateSubject {
  readonly actor: Actor
  readonly state: StateName
}

const SUBJECT_RE = /^gtd\(([^()]+)\): (.+)$/

/**
 * Parse a raw commit subject as `gtd(<actor>): <state>`. Returns `undefined`
 * for anything else (non-gtd, malformed, or missing either half) — never
 * throws. Trims surrounding whitespace before matching.
 */
export const parseStateSubject = (subject: string): ParsedStateSubject | undefined => {
  const match = SUBJECT_RE.exec(subject.trim())
  if (match === null) return undefined
  const actor = match[1]
  const state = match[2]
  if (actor === undefined || actor === "" || state === undefined || state === "") return undefined
  return { actor, state }
}

// ── Resolve ──────────────────────────────────────────────────────────────────

/**
 * The workflow's declared initial state (exactly one `initial: true` state
 * is assumed — `validateDefinition` enforces this at config-load time).
 * Throws if none is declared: a caller invoking `resolveState`/`step`
 * against an unvalidated, malformed definition is a programmer error, not a
 * value this module tries to guess through.
 */
export const initialStateOf = (def: WorkflowDefinition): StateName => {
  for (const [name, state] of Object.entries(def.states)) {
    if (state.initial === true) return name
  }
  throw new Error("workflow definition has no initial state")
}

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
 * separator).
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
 * Commit everything pending as `gtd(<actor>): <to>` (the target after any
 * retry redirection). `actor` is the INVOKER who authored this step — per
 * decision 2, the subject records "the state being ENTERED and who authored
 * the step". This works for a cross-actor handoff (a transition whose target
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
 * Decide what invoking `invoker` at `state` does — a pure decision, not an
 * effect. Refusals: `invoker` isn't `state`'s declared actor (out-of-turn),
 * or the tree is dirty and no `on` pattern matches (no-match, naming the
 * declared patterns so the CLI can print them). A clean tree with no
 * matching pattern is a no-op (not a refusal) — the loop protocol's clean
 * steps are the default, silent case. A match's target is retry-redirected
 * (`applyRetry`) before being classified: a commit-state target yields a
 * `"squash"` decision carrying its `commit` template verbatim; anything
 * else yields a `"commit"` decision naming the `gtd(<invoker>): <to>` subject
 * to write — `<invoker>` is who authored this step, per decision 2, not `to`'s
 * own declared actor (see `StepCommit`'s doc comment). Throws only on a
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
  // entered state's own declared actor — see StepCommit's doc comment.
  return {
    kind: "commit",
    subject: stateSubject(invoker, finalTarget),
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

/** Exactly one `initial: true` state, and it must not be a commit state. */
const validateInitial = (def: WorkflowDefinition, names: readonly string[]): string[] => {
  const initialNames = names.filter((name) => def.states[name]!.initial === true)
  if (initialNames.length !== 1) {
    return [
      `workflow must declare exactly one initial state (found ${initialNames.length}${
        initialNames.length > 0 ? `: ${initialNames.join(", ")}` : ""
      })`,
    ]
  }
  const only = initialNames[0]!
  return isCommitState(def.states[only]!)
    ? [`initial state "${only}" must not be a commit state`]
    : []
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
  ]
}

/**
 * Validate a `WorkflowDefinition`, returning human-readable error strings
 * (empty = valid). Pure — Phase 2 calls this at config-load time. Checks:
 * at least one state; exactly one `initial: true` state (and it must not be
 * a commit state — a workflow can't start already finished, a small
 * addition beyond the plan's literal list, called out here since it's easy
 * to drop if a later phase disagrees); every state declares exactly one
 * content kind; commit states carry no `actor` and no `on`; non-commit
 * states carry an `actor`; every `on` pattern parses and every `on` target
 * and `retry.otherwise` names a defined state; `retry.max` is a
 * non-negative integer.
 */
export const validateDefinition = (def: WorkflowDefinition): readonly string[] => {
  const names = Object.keys(def.states)
  if (names.length === 0) return ["workflow must declare at least one state"]

  return [
    ...validateInitial(def, names),
    ...names.flatMap((name) => validateState(def, name, names)),
  ]
}
