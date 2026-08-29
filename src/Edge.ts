import { Effect } from "effect"
import { Narrator } from "./Commentary.js"
import { GitService, type GitOperations } from "./Git.js"
import { ConfigService } from "./Config.js"
import { RepoFiles, templateRead } from "./RepoFiles.js"
import { EnvVars } from "./EnvVars.js"
import {
  contentKindOf,
  enterableStates,
  entryBaseTemplateOf,
  initialStateOf,
  isReviewBaseState,
  memoryScopeAt,
  parseStateSubject,
  resolveState,
  stateSubject,
  step,
  wouldAttempt,
  type ChangeStatus,
  type ContentKind,
  type OnEdge,
  type PendingChange,
  type StateDef,
  type StateName,
  type StepDecision,
  type StepRefusal,
  type WorkflowDefinition,
} from "./PatternMachine.js"
import { STATE_FIELD_ENTRIES, type FieldValue, type StateFieldsTable } from "./StateFields.js"
import {
  renderStateTemplate,
  varsOnlyContext,
  type TemplateContext,
  type TemplateEdge,
} from "./PatternTemplates.js"
import { commitAll } from "./GitScript.js"
import { emitScripts, type EmitStep, type EmittedScripts } from "./Emit.js"
import { commitOutcome, transitionOutcome } from "./OutcomeScript.js"

// git's empty-tree object — the diff/reset base when a process (or the whole
// repo) has no earlier commit to compare against.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

const subjectOf = (message: string): string => (message.split("\n")[0] ?? "").trim()

// `gtd land --cost=<n> [--model=<name>]` records the token cost of the
// invocation that produced the pending changes as a `Gtd-Cost: <n> <model>`
// trailer on the turn commit; `computeProcessRun` sums these into
// `it.processCost`/`it.processCostByModel`, rendered by `gtd summary`.

const COST_TRAILER_PREFIX = "Gtd-Cost: "
// The number comes first so a model-less entry (`Gtd-Cost: 1450`) still parses.
const COST_TRAILER_RE = /^Gtd-Cost:[ \t]*([0-9]+(?:\.[0-9]+)?)(?:[ \t]+(.+?))?[ \t]*$/gm

/** The bucket a cost with no `--model` tag is grouped under, kept distinct so a mixed history still totals correctly. */
export const UNATTRIBUTED_MODEL = "unspecified"

export interface CostEntry {
  readonly cost: number
  readonly model: string
}

/** One model's summed token cost — the shape `gtd summary`'s template iterates as `it.processCostByModel`. */
export interface ModelCost {
  readonly model: string
  readonly cost: number
}

/**
 * Append a `Gtd-Cost: <cost>[ <model>]` trailer to `subject` (unchanged when
 * no cost was supplied) — the subject's first line is never touched, so
 * `parseStateSubject`/`resolveState` still read `gtd(<actor>): <state>` back
 * exactly as before.
 */
const withCostTrailer = (
  subject: string,
  cost: number | undefined,
  model: string | undefined,
): string =>
  cost === undefined
    ? subject
    : `${subject}\n\n${COST_TRAILER_PREFIX}${cost}${model !== undefined ? ` ${model}` : ""}`

const parseCostTrailers = (messages: readonly string[]): CostEntry[] => {
  const entries: CostEntry[] = []
  for (const message of messages) {
    for (const match of message.matchAll(COST_TRAILER_RE)) {
      const model = match[2]?.trim()
      entries.push({
        cost: Number(match[1]),
        model: model !== undefined && model !== "" ? model : UNATTRIBUTED_MODEL,
      })
    }
  }
  return entries
}

// `gtd --entry <state>` (`planEntry`) can carry a `Gtd-Review-Base:` trailer
// naming the resolved commitish's full hash. `computeProcessRun` reads it off
// the process's oldest commit to override `ProcessRun.diffBase` — everything
// keyed to the diff base (`it.startCommit`, the review window's default base)
// then operates over `<commitish>..HEAD`. The trace/retry boundary
// (`startParentHash`) is unaffected — only the diff base moves.

const REVIEW_BASE_TRAILER_PREFIX = "Gtd-Review-Base: "
const REVIEW_BASE_TRAILER_RE = /^Gtd-Review-Base:[ \t]*(\S+)[ \t]*$/m

const parseReviewBaseTrailer = (message: string): string | undefined =>
  REVIEW_BASE_TRAILER_RE.exec(message)?.[1]

// An entry commit can also carry `Gtd-Var: <name>=<value>` trailers — fixed
// `it.vars` overrides read (only off the oldest commit) into
// `ProcessRun.entryVars` and folded into `resolveVars` below the env layer.

const ENTRY_VAR_TRAILER_PREFIX = "Gtd-Var: "
// The value is everything after the FIRST `=`, so a value containing `=` round-trips.
const ENTRY_VAR_TRAILER_RE = /^Gtd-Var:[ \t]*([^=\s]+)=(.*)$/gm

const withEntryTrailers = (
  subject: string,
  opts: { base?: string; vars: Record<string, string> },
): string => {
  const lines: string[] = []
  if (opts.base !== undefined) lines.push(`${REVIEW_BASE_TRAILER_PREFIX}${opts.base}`)
  for (const [name, value] of Object.entries(opts.vars))
    lines.push(`${ENTRY_VAR_TRAILER_PREFIX}${name}=${value}`)
  return lines.length === 0 ? subject : `${subject}\n\n${lines.join("\n")}`
}

const parseEntryVarTrailers = (message: string): Record<string, string> => {
  const vars: Record<string, string> = {}
  for (const match of message.matchAll(ENTRY_VAR_TRAILER_RE)) vars[match[1]!] = match[2]!
  return vars
}

const totalCostOf = (entries: readonly CostEntry[]): number =>
  entries.reduce((sum, entry) => sum + entry.cost, 0)

/** Per-model token totals, highest-cost first (ties broken by model name for a stable order). */
const costByModel = (entries: readonly CostEntry[]): ModelCost[] => {
  const byModel = new Map<string, number>()
  for (const entry of entries)
    byModel.set(entry.model, (byModel.get(entry.model) ?? 0) + entry.cost)
  return [...byModel.entries()]
    .map(([model, cost]) => ({ model, cost }))
    .sort((a, b) => b.cost - a.cost || a.model.localeCompare(b.model))
}

/** Collapse an arbitrary git status letter to the pattern grammar's closed `A|M|D` set — only those three are meaningful statuses. */
const normalizeStatus = (raw: string): ChangeStatus => (raw === "A" ? "A" : raw === "D" ? "D" : "M")

// ── Resolving the current rest ──────────────────────────────────────────────

/** The currently-rested state, its definition, and its declared actor. */
export interface ResolvedRest {
  readonly def: WorkflowDefinition
  readonly state: StateName
  readonly stateDef: StateDef
  readonly actor: string
}

/** `resolveRestFrom`'s outcome: `error` is a finished, user-facing message, not a raw Effect failure. */
type RestResolution =
  | { readonly ok: true; readonly rest: ResolvedRest }
  | { readonly ok: false; readonly error: Error }

/**
 * Resolve a HEAD commit's subject against the active workflow definition —
 * PURE: no git, no Effect.
 *
 * A HEAD subject that DOES parse as `gtd(actor): state`, but whose state the
 * CURRENT definition doesn't declare at all, is refused loudly here rather
 * than silently falling through `resolveState`'s initial-state fallback: a
 * process left resting at a state a workflow upgrade removed would otherwise
 * look like a fresh idle repo instead of pointing at `gtd abandon`. Every
 * other case `resolveState` folds into "rest at the initial state" (an
 * unparseable subject, an actor mismatch) is left as is — those are
 * legitimately "no active process," not a renamed-out state.
 */
export const resolveRestFrom = (def: WorkflowDefinition, headSubject: string): RestResolution => {
  const parsedHead = parseStateSubject(headSubject)
  if (parsedHead !== undefined && def.states[parsedHead.state] === undefined) {
    return {
      ok: false,
      error: new Error(
        `gtd: HEAD rests at "${parsedHead.state}", which the active workflow no longer declares ` +
          `— this looks like a process left in-flight from before a workflow change. Run \`gtd ` +
          `abandon\` to discard it and start over (or check out the workflow version it started ` +
          `under).`,
      ),
    }
  }
  const state = resolveState(def, headSubject)
  const stateDef = def.states[state]!
  // A validated definition guarantees every state declares an actor — this
  // is a defensive check against a programmer error, not a real runtime path.
  if (stateDef.actor === undefined) {
    return {
      ok: false,
      error: new Error(`gtd: resolved at state "${state}" declaring no actor`),
    }
  }
  return { ok: true, rest: { def, state, stateDef, actor: stateDef.actor } }
}

// ── Pending changes ──────────────────────────────────────────────────────────

const pendingChanges = (git: GitOperations): Effect.Effect<readonly PendingChange[], Error> =>
  git
    .changedPaths()
    .pipe(
      Effect.map((entries) =>
        entries.map((e) => ({ status: normalizeStatus(e.status), path: e.path })),
      ),
    )

// ── The current process run ──────────────────────────────────────────────────

/** One process-trace entry: a state entered, the hash of the commit that entered it — the pair `memoryKeyFor` needs to anchor a memory key to the commit immediately BEFORE an unbroken scope entry began — and the invoking actor (parsed off the commit subject), which `summaryRun`'s human-commit derivation filters on. */
export interface TraceEntry {
  readonly state: StateName
  readonly hash: string
  readonly actor: string
}

/** The contiguous run of `gtd(actor): state` commits ending at HEAD. */
export interface ProcessRun {
  /** The run's first commit's hash, or HEAD's own hash when the run is empty (no turn has landed yet this process). */
  readonly startHash: string
  /** The parent of the run's first commit — `EMPTY_TREE` when the run covers the whole history. This is the process's TRACE/retry boundary, never overridden by a `Gtd-Review-Base:` trailer. */
  readonly startParentHash: string
  /**
   * The base `it.startCommit` renders, and the review's default diff base:
   * normally identical to `startParentHash`, but overridden to a
   * `Gtd-Review-Base: <hash>` trailer's hash when the
   * process's FIRST (oldest) commit carries one (see
   * `withEntryTrailers`/`parseReviewBaseTrailer` — written by `planEntry`).
   * The trace/retry boundary itself is untouched by this; only which commit a
   * template/window compares against moves.
   */
  readonly diffBase: string
  /** States entered so far this process, oldest→newest, each paired with the hash of the commit that entered it (empty when no turn has landed yet). */
  readonly trace: readonly TraceEntry[]
  /** Every `Gtd-Cost:` entry recorded on the process's turn commits — summed into `it.processCost` and grouped into `it.processCostByModel` (empty when none were recorded). */
  readonly costEntries: readonly CostEntry[]
  /** The `Gtd-Var:` trailers recorded on the process's FIRST (oldest) commit — an entry commit's fixed `it.vars` overrides, folded into `resolveVars`'s merge (empty when the process's oldest commit carries none, or the process is empty). */
  readonly entryVars: Record<string, string>
  /**
   * HEAD's own commit, when its subject parses to a state the ACTIVE
   * definition still declares (non-commit) — `undefined` for a
   * foreign/unparseable subject or a removed state. `empty` is `stalledAt`'s
   * "did this turn's commit change anything" question, read off the same
   * `commitHistory` array `trace` is built from. Keyed off HEAD directly
   * rather than `trace`'s last entry because a commit entering the initial
   * state is excluded from `trace` (it's the process boundary) — an attempt
   * landing at a prompt state that's also the initial state would otherwise
   * leave `trace` empty while HEAD still carries the turn.
   */
  readonly headTurn:
    | { readonly state: StateName; readonly actor: string; readonly empty: boolean }
    | undefined
  /**
   * Set only by `summaryRun`'s boundary-inclusive walk, when HEAD itself is a
   * commit entering the workflow's initial state — the hash of that closing
   * commit. `undefined` for `currentRun`/`computeProcessRun`'s ordinary
   * (boundary-exclusive) walk, and for a `summaryRun` call whose HEAD isn't
   * itself a boundary (a process still in flight).
   */
  readonly closingHash: string | undefined
}

/**
 * `ProcessRun.headTurn` from an already-fetched `commitHistory` array
 * (oldest→newest) — HEAD is its last entry. `undefined` for an empty
 * history, an unparseable/foreign subject, or a subject naming a state the
 * ACTIVE definition doesn't declare (never a real rest).
 */
const headTurnFrom = (
  def: WorkflowDefinition,
  history: ReadonlyArray<{ readonly message: string; readonly touched: ReadonlyArray<string> }>,
): ProcessRun["headTurn"] => {
  if (history.length === 0) return undefined
  const head = history[history.length - 1]!
  const parsed = parseStateSubject(subjectOf(head.message))
  if (parsed === undefined) return undefined
  const stateDef = def.states[parsed.state]
  if (stateDef === undefined) return undefined
  return { state: parsed.state, actor: parsed.actor, empty: head.touched.length === 0 }
}

/**
 * The `Gtd-Review-Base:`/`Gtd-Var:` overrides carried by the process's OLDEST
 * commit (its entry commit, when `planEntry` started this process) — a later
 * turn's message is never mistaken for it. `{reviewBase: undefined, vars:
 * {}}` when the process has no commits yet.
 */
const parseEntryCommitOverrides = (
  processCommits: ReadonlyArray<{ readonly message: string }>,
): { readonly reviewBase: string | undefined; readonly vars: Record<string, string> } => {
  if (processCommits.length === 0) return { reviewBase: undefined, vars: {} }
  const message = processCommits[0]!.message
  return { reviewBase: parseReviewBaseTrailer(message), vars: parseEntryVarTrailers(message) }
}

/**
 * The boundary-exclusive backward walk `computeProcessRun` needs, split out
 * so the surrounding Effect.gen body stays under the complexity gate. Returns
 * the trace/retry boundary's history index (`i`, `-1` when the whole history
 * belongs to the process) and, when `includeClosingBoundary` folded HEAD's own
 * closing commit into the process, its hash.
 */
const walkProcessBoundary = (
  history: ReadonlyArray<{ readonly message: string; readonly hash: string }>,
  initialState: StateName,
  includeClosingBoundary: boolean,
): { readonly boundaryIndex: number; readonly closingHash: string | undefined } => {
  let i = history.length - 1
  let closingHash: string | undefined
  if (includeClosingBoundary && i >= 0) {
    const parsedLast = parseStateSubject(subjectOf(history[i]!.message))
    if (parsedLast !== undefined && parsedLast.state === initialState) {
      closingHash = history[i]!.hash
      i--
    }
  }
  while (i >= 0) {
    const parsed = parseStateSubject(subjectOf(history[i]!.message))
    if (parsed === undefined || parsed.state === initialState) break
    i--
  }
  return { boundaryIndex: i, closingHash }
}

/**
 * Walk first-parent history backward from HEAD while each commit's subject
 * parses as `gtd(actor): state` and that state isn't the workflow's initial
 * state; stop — excluding that boundary commit, which belongs to the
 * finished process — at a non-matching commit or a commit entering the
 * initial state (the boundary between one approved process and the next;
 * without it, consecutive processes' commits would fuse and `retry` counts
 * would pool across them). HEAD itself being such a boundary yields an EMPTY
 * run (`trace: []`).
 *
 * `head` overrides the literal `HEAD` the walk would otherwise end at.
 *
 * `includeClosingBoundary` (default `false`) is `summaryRun`'s one-flag
 * difference from `currentRun`'s ordinary walk: when set AND the walk's very
 * last history entry (HEAD itself) is a commit entering the initial state, that
 * boundary commit is folded INTO the trace instead of excluded, and its hash
 * is recorded as `ProcessRun.closingHash`. A process still in flight (HEAD is
 * not itself such a boundary) resolves identically to the flag being unset.
 */
const computeProcessRun = (
  git: GitOperations,
  def: WorkflowDefinition,
  includeClosingBoundary = false,
): Effect.Effect<ProcessRun, Error> =>
  Effect.gen(function* () {
    const initialState = initialStateOf(def)
    const history = yield* git.commitHistory() // oldest -> newest, full first-parent history
    const { boundaryIndex: i, closingHash } = walkProcessBoundary(
      history,
      initialState,
      includeClosingBoundary,
    )
    const startIdx = i + 1
    const processCommits = history.slice(startIdx)
    const trace: TraceEntry[] = processCommits.map((h) => {
      const parsed = parseStateSubject(subjectOf(h.message))!
      return { state: parsed.state, hash: h.hash, actor: parsed.actor }
    })
    const costEntries = parseCostTrailers(processCommits.map((h) => h.message))
    const startParentHash = i >= 0 ? history[i]!.hash : EMPTY_TREE
    const startHash =
      startIdx < history.length ? history[startIdx]!.hash : history[history.length - 1]!.hash
    const { reviewBase: reviewBaseOverride, vars: entryVars } =
      parseEntryCommitOverrides(processCommits)
    const diffBase = reviewBaseOverride ?? startParentHash
    const headTurn = headTurnFrom(def, history)
    return {
      startHash,
      startParentHash,
      diffBase,
      trace,
      costEntries,
      entryVars,
      headTurn,
      closingHash,
    }
  })

/**
 * The run alone, WITHOUT resolving a rest — `gtd abandon`'s escape hatch: it
 * must still work when HEAD names a state `currentRest` would refuse on,
 * since abandon IS the recovery command for that case.
 */
export const currentRun: Effect.Effect<ProcessRun, Error, GitService | ConfigService | Narrator> =
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    return yield* computeProcessRun(git, config.workflow)
  })

/**
 * The process HEAD closes or sits inside — `gtd summary`'s run resolution.
 * Identical to `currentRun` for a process still in flight; for a finished
 * process (HEAD is itself a commit entering the initial state), the closing
 * commit is folded back into the trace and its hash recorded as
 * `closingHash` — see `computeProcessRun`'s `includeClosingBoundary` flag.
 */
export const summaryRun: Effect.Effect<ProcessRun, Error, GitService | ConfigService | Narrator> =
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    return yield* computeProcessRun(git, config.workflow, true)
  })

/**
 * PURE: the most-recent in-process turn commit that entered a `reviewBase`
 * state, or `run.diffBase` when none did. A backwards walk of `run.trace`,
 * so no git call, no matter how deep the process.
 */
export const reviewBaseFor = (def: WorkflowDefinition, run: ProcessRun): string => {
  let base: string | undefined
  for (const entry of run.trace) {
    if (isReviewBaseState(def, entry.state)) base = entry.hash
  }
  return base ?? run.diffBase
}

// The display name for the root machine instance's own memory scope
// (`scopes[state] === ""`, per `src/Machines.ts`'s `InstancePath` convention)
// — `memoryScopeAt` never names the root itself, so a driver keying memory
// off a root-owned prompt state needs SOME label rather than a bare
// `#<hash>` key.
const ROOT_MEMORY_SCOPE_NAME = "root"

/**
 * Compute the commit-anchored memory key for the currently-rested state, or
 * `undefined` when none applies (a non-`prompt` rest, or `memoryScopeAt`
 * can't resolve a scope) — a driver groups consecutive agent turns by this
 * key.
 *
 * The key is `${scope || ROOT_MEMORY_SCOPE_NAME}#${token.slice(0, 7)}`, where
 * `token` anchors to the commit the CURRENT unbroken scope entry started
 * FROM, not the entry's own commit: anchoring to the entry's own commit would
 * give a workflow whose initial state is a prompt state two different tokens
 * across its first two turns (nothing committed yet before the very first
 * turn).
 */
const memoryKeyFor = (
  scopes: Readonly<Record<StateName, string>>,
  rest: ResolvedRest,
  run: ProcessRun,
): string | undefined => {
  if (contentKindOf(rest.stateDef) !== "prompt") return undefined
  const resolved = memoryScopeAt(
    scopes,
    rest.state,
    run.trace.map((entry) => entry.state),
  )
  if (resolved === undefined) return undefined
  const { scope, entryIndex } = resolved
  const token = entryIndex <= 0 ? run.startParentHash : run.trace[entryIndex - 1]!.hash
  return `${scope || ROOT_MEMORY_SCOPE_NAME}#${token.slice(0, 7)}`
}

/**
 * True iff a `prompt` rest in the CURRENT unbroken scope-run has already been
 * passed — the derivation `src/Sessions.ts`'s `resolveSession` takes its
 * `resume` flag from.
 *
 * Computed over the process's rests, oldest→newest, with the starting state
 * prefixed (so the very first turn of a workflow whose `entries.default` IS a
 * prompt state still has a predecessor to look back at). The root scope
 * (`scope === ""`) matches every state, so filtering the prior-rests slice
 * down to `prompt`-kind states (not merely non-empty) stops a message state
 * like `idle` from counting as a prior conversation turn — otherwise the very
 * first agent beat of a process would claim `resume: true` for an id nobody
 * ever created.
 */
export const memoryResumedFor = (
  def: WorkflowDefinition,
  scopes: Readonly<Record<StateName, string>>,
  rest: ResolvedRest,
  run: ProcessRun,
): boolean => {
  if (contentKindOf(rest.stateDef) !== "prompt") return false
  const rests = [initialStateOf(def), ...run.trace.map((entry) => entry.state)]
  const resolved = memoryScopeAt(scopes, rest.state, rests)
  if (resolved === undefined) return false
  const { entryIndex } = resolved
  return rests
    .slice(Math.max(entryIndex, 0), rests.length - 1)
    .some((state) => contentKindOf(def.states[state]!) === "prompt")
}

// ── Variables (`it.vars`) ────────────────────────────────────────────────────

const PREFIX = "GTD_"

/**
 * Assemble the merged `it.vars` map every template sees, from four layers
 * (later wins): the workflow's own `vars:` defaults, the top-level `.gtdrc`
 * `vars:`, the current process's entry commit's `Gtd-Var:` trailers
 * (`entryVars`), and — for each name declared by any of those three — a
 * `GTD_<UPPERCASE-name>` environment variable if defined. The environment can
 * only OVERRIDE a name an earlier layer declared, never introduce a new one
 * (an uppercased env key can't round-trip to an arbitrary camelCase name), so
 * an unmatched `GTD_*` var is silently ignored.
 */
const resolveVars = (
  workflowVars: Record<string, string>,
  rcVars: Record<string, string>,
  entryVars: Record<string, string>,
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const merged = { ...workflowVars, ...rcVars, ...entryVars }
  for (const name of Object.keys(merged)) {
    const value = env[PREFIX + name.toUpperCase()]
    if (value !== undefined) merged[name] = value
  }
  return merged
}

// ── Template context ─────────────────────────────────────────────────────────

const toTemplateEdges = (edges: readonly OnEdge[] | undefined): readonly TemplateEdge[] =>
  (edges ?? []).map(([pattern, target, describe, action]) => ({
    pattern,
    target,
    ...(describe !== undefined ? { describe } : {}),
    ...(action !== undefined ? { action } : {}),
  }))

/**
 * Render every `on` edge's pattern key as an Eta template over `vars` ONLY —
 * a pattern never needs diffs/commit hashes, and restricting to `vars` avoids
 * an ordering circularity (the full `TemplateContext`'s `it.edges` is itself
 * derived from these same `on` edges). `target`/`describe`/`action` pass
 * through verbatim. Throws whatever Eta throws on a malformed pattern
 * template.
 */
const renderOnEdges = (
  edges: readonly OnEdge[] | undefined,
  vars: Record<string, string>,
): readonly OnEdge[] => {
  const ctx = varsOnlyContext(vars)
  return (edges ?? []).map(([pattern, target, describe, action]): OnEdge => {
    const renderedPattern = renderStateTemplate(pattern, ctx)
    if (action !== undefined) return [renderedPattern, target, describe, action]
    if (describe !== undefined) return [renderedPattern, target, describe]
    return [renderedPattern, target]
  })
}

/** Wraps `renderOnEdges`, turning a thrown Eta error into a plain `Error` failure — exactly like a content render failure. */
const renderOnEdgesOrFail = (
  onEdges: readonly OnEdge[] | undefined,
  vars: Record<string, string>,
): Effect.Effect<readonly OnEdge[], Error> =>
  Effect.try({
    try: () => renderOnEdges(onEdges, vars),
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

/**
 * A shallow clone of `def` whose `state`'s `on` is replaced by
 * `renderedOnEdges` — used to feed `PatternMachine.step`, which matches only
 * `def.states[state].on` for the state it's invoked at. Only the RESTING
 * state needs patching, even though `step`'s retry counter now reads every
 * state's `on` targets (plus `retry.otherwise`) to derive a capped state's
 * source set. That's still sound because `renderOnEdges` renders a pattern
 * KEY only and passes each edge's `target` through verbatim — the source-set
 * computation reads only `target` strings, never pattern keys, so every
 * other state's un-patched, unrendered-key `on` still reports the right
 * targets. Warning: if a future change ever templated a state's `on`
 * TARGET (not just its pattern key), that would silently mis-scope every
 * retry budget, because the source-set computation reads targets from every
 * state, and `withRenderedOn` patches only the one being rested at.
 */
const withRenderedOn = (
  def: WorkflowDefinition,
  state: StateName,
  renderedOnEdges: readonly OnEdge[],
): WorkflowDefinition => ({
  ...def,
  states: {
    ...def.states,
    [state]: { ...def.states[state]!, on: renderedOnEdges },
  },
})

/**
 * Build the `PatternTemplates.TemplateContext` for rendering `state`'s content
 * at the resolved rest. `edges` must already be rendered by the caller
 * (`renderOnEdges`). `it.processCost`/`it.processCostByModel` total only the
 * process's already-committed cost entries — rest resolution always happens
 * BEFORE a step's own `--cost`/`--model` exist, so there is never an
 * in-flight step's cost to fold in here. No diff is computed here —
 * `it.reviewBase`/`it.processBase` are bases a template tells the agent to
 * `git diff` itself.
 */
const buildTemplateContext = (
  git: GitOperations,
  read: (path: string) => string,
  state: StateName,
  actor: string,
  run: ProcessRun,
  vars: Record<string, string>,
  edges: readonly OnEdge[] | undefined,
  reviewBase: string,
): Effect.Effect<TemplateContext, Error> =>
  Effect.gen(function* () {
    const currentCommit = yield* git.resolveRef("HEAD")
    const previousCommit = yield* git
      .resolveRef("HEAD~1")
      .pipe(Effect.catchAll(() => Effect.succeed(run.startParentHash)))
    return {
      startCommit: run.diffBase,
      currentCommit,
      previousCommit,
      state,
      actor,
      reviewBase,
      processBase: run.startParentHash,
      processCost: totalCostOf(run.costEntries),
      processCostByModel: costByModel(run.costEntries),
      read,
      vars,
      edges: toTemplateEdges(edges),
    }
  })

/**
 * The `TemplateContext` `gtd summary` renders `def.summary` against — no
 * resting state, no `on` edges (a summary isn't rendered AT a state), `cost`/
 * `model` both absent (the command writes nothing, so there is no in-flight
 * step to fold in).
 */
export const summaryTemplateContext = (
  run: ProcessRun,
): Effect.Effect<
  TemplateContext,
  Error,
  GitService | ConfigService | RepoFiles | EnvVars | Narrator
> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    const files = yield* RepoFiles
    const envVars = yield* EnvVars
    const def = config.workflow
    const vars = resolveVars(config.workflowVars, config.rcVars, run.entryVars, envVars.all)
    const reviewBase = reviewBaseFor(def, run)
    return yield* buildTemplateContext(
      git,
      templateRead(files),
      "",
      "",
      run,
      vars,
      undefined,
      reviewBase,
    )
  })

// ── The resolved rest, fully assembled ───────────────────────────────────────

export type RestRequirements = GitService | ConfigService | RepoFiles | EnvVars | Narrator

/**
 * Every field a resolved rest carries as a hint (`rest: "rendered"` or
 * `"verbatim"` in `STATE_FIELDS`) — a derived mapped type, so a new field
 * declaring either `rest` kind shows up here, on `RenderedRest`, and in the
 * hint loops below with no separate edit.
 */
type RestFieldName = {
  [K in keyof StateFieldsTable]: StateFieldsTable[K] extends { rest: "rendered" | "verbatim" }
    ? K
    : never
}[keyof StateFieldsTable]

/** A state's declared hints, RENDERED. Optional keys omitted, never `undefined`-valued. */
export type RestHints = {
  readonly [K in RestFieldName]?: FieldValue[StateFieldsTable[K]["kind"]]
}

/**
 * Where the process rests right now, fully resolved. ONE SNAPSHOT, taken
 * before any mutation — see AGENTS.md: never read a `Rest` after a `perform`.
 */
export interface Rest extends ResolvedRest {
  readonly run: ProcessRun
  /** The merged four-layer `it.vars`. */
  readonly vars: Record<string, string>
  /** The resting state's `on` edges, already rendered against `vars`. */
  readonly on: readonly OnEdge[]
  /** `def` with `on` patched onto the resting state — what `PatternMachine.step` must be fed. */
  readonly stepDef: WorkflowDefinition
  readonly changes: readonly PendingChange[]
  readonly memory: string | undefined
  /** `memoryResumedFor`'s verdict — `false` for a non-`prompt` rest or one whose scope doesn't resolve, exactly like `memory` but never `undefined` (there is always an answer, even when there is no key to answer about). */
  readonly memoryResumed: boolean
  readonly hints: RestHints
  readonly context: TemplateContext
}

// Drops undefined-valued entries so optional hint fields are OMITTED (not
// `undefined`-valued) on the rendered result.
const omitUndefined = <T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>
  }

/** Resolve `Rest` at an arbitrary ref, or `undefined` for HEAD itself. */
export const restAt = (ref: string | undefined): Effect.Effect<Rest, Error, RestRequirements> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    const files = yield* RepoFiles
    const envVars = yield* EnvVars
    const def = config.workflow

    const headSubject = yield* git.lastCommitSubject(ref)
    const resolution = resolveRestFrom(def, headSubject)
    if (!resolution.ok) return yield* Effect.fail(resolution.error)
    const resolved = resolution.rest
    yield* (yield* Narrator).narrate(`rest resolved: ${resolved.state} (awaits ${resolved.actor})`)

    const run = yield* computeProcessRun(git, def)
    const vars = resolveVars(config.workflowVars, config.rcVars, run.entryVars, envVars.all)
    const on = yield* renderOnEdgesOrFail(resolved.stateDef.on, vars)
    const stepDef = withRenderedOn(def, resolved.state, on)
    const reviewBase = reviewBaseFor(def, run)
    const changes = yield* pendingChanges(git)
    const context = yield* buildTemplateContext(
      git,
      templateRead(files),
      resolved.state,
      resolved.actor,
      run,
      vars,
      on,
      reviewBase,
    )
    const memory = memoryKeyFor(config.stateScopes, resolved, run)
    const memoryResumed = memoryResumedFor(def, config.stateScopes, resolved, run)
    const hints = yield* renderHints(resolved.stateDef, context)

    return {
      ...resolved,
      run,
      vars,
      on,
      stepDef,
      changes,
      memory,
      memoryResumed,
      hints,
      context,
    }
  })

export const currentRest: Effect.Effect<Rest, Error, RestRequirements> = restAt(undefined)

// ── Rendering the resolved rest's content ────────────────────────────────────

export interface RenderedRest extends RestHints {
  readonly state: StateName
  readonly actor: string
  readonly kind: ContentKind
  readonly content: string
  /** The resolved rest's COMPUTED memory key (`memoryKeyFor`) — a commit-anchored `<scope>#<hash7>` string, omitted (not `undefined`-valued) for a non-`prompt` rest or when no scope resolves, same discipline as the `RestHints` fields. Not sourced from the state's own (still-accepted, but now unread) `memory:` declaration. */
  readonly memory?: string
  /** `rest.memoryResumed`, verbatim — ALWAYS present (unlike `memory`, this is not a hint a driver can treat as absent-when-inapplicable; `false` is itself the answer for a non-`prompt` rest). */
  readonly memoryResumed: boolean
  /** The resolved rest's `on` edges as `{ pattern, target, describe? }` — the same list templates see as `it.edges`. Always present (possibly empty); `gtd next --json` emits it so a driver has the routing (and its human-readable `describe`s) alongside the rendered content. */
  readonly edges: readonly TemplateEdge[]
}

const renderStateField = (
  stateDef: StateDef,
  key: string,
  context: TemplateContext,
): Effect.Effect<string | undefined, Error> =>
  Effect.try({
    try: () => {
      const value = (stateDef as unknown as Record<string, unknown>)[key]
      return typeof value === "string" ? renderStateTemplate(value, context) : undefined
    },
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

/**
 * Every `STATE_FIELDS` hint for one state, resolved against `context`:
 * `rest: "rendered"` fields (`model`/`label`/`file`) go through
 * `renderStateField`, `rest: "verbatim"` fields (`mode`, a closed literal
 * never Eta-rendered) pass through as-is. Derived from the table, so a new
 * hint field needs no edit here — and computed ONCE, when the `Rest`
 * snapshot is built, rather than per consumer.
 */
const renderHints = (
  stateDef: StateDef,
  context: TemplateContext,
): Effect.Effect<RestHints, Error> =>
  Effect.gen(function* () {
    const hints: Record<string, unknown> = {}
    for (const [key, spec] of STATE_FIELD_ENTRIES) {
      if (spec.rest === "rendered") {
        hints[key] = yield* renderStateField(stateDef, key, context)
      } else if (spec.rest === "verbatim") {
        hints[key] = (stateDef as unknown as Record<string, unknown>)[key]
      }
    }
    return omitUndefined(hints) as RestHints
  })

/**
 * Render a `Rest`'s declared content (script/prompt/message) plus every
 * `STATE_FIELDS` field carrying a `rest` kind and its computed memory key —
 * all of which already live on `rest` (`rest.context`/`rest.hints`/
 * `rest.memory`, built once by `restAt` via `renderHints`), so this takes no
 * other parameters.
 */
export const renderRest = (rest: Rest): Effect.Effect<RenderedRest, Error> =>
  Effect.gen(function* () {
    const kind = contentKindOf(rest.stateDef)
    if (kind === undefined) {
      return yield* Effect.fail(
        new Error(`state "${rest.state}" declares no content — invalid definition`),
      )
    }
    const template = rest.stateDef.script ?? rest.stateDef.prompt ?? rest.stateDef.message!
    const content = yield* Effect.try({
      try: () => renderStateTemplate(template, rest.context),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    })
    return {
      state: rest.state,
      actor: rest.actor,
      kind,
      content,
      ...rest.hints,
      ...(rest.memory !== undefined ? { memory: rest.memory } : {}),
      memoryResumed: rest.memoryResumed,
      // `rest.context.edges` is the resting state's `on` edges, already
      // rendered against `it.vars` — not re-derived from `rest.stateDef.on`
      // here, which would be the unrendered literal.
      edges: rest.context.edges,
    }
  })

/**
 * Derived stall detection: PURE, restart-proof by construction (any process
 * that re-resolves the same HEAD reaches the same verdict). `true` iff the
 * working tree is clean, HEAD's own commit already rests at `rest.state` with
 * an EMPTY diff (the previous dispatch's attempt landed and did nothing), and
 * another dispatch right now would just repeat that same fruitless attempt
 * (`wouldAttempt` — false once a retry cap would redirect it elsewhere,
 * which is the escalation path out of a stall). Sticky by design: resolving
 * `true` twice in a row is the correct answer, not a bug.
 */
export const stalledAt = (rest: Rest): boolean =>
  rest.changes.length === 0 &&
  rest.run.headTurn?.state === rest.state &&
  rest.run.headTurn.empty &&
  // A clean-tree `gtd --entry` commit (a different actor) must read as a
  // fresh dispatch, never a stall — only the state's own actor can attempt.
  rest.run.headTurn.actor === rest.actor &&
  wouldAttempt(
    rest.stepDef,
    rest.state,
    rest.run.trace.map((entry) => entry.state),
  )

// ── Planning a step ──────────────────────────────────────────────────────────

/** A decision whose emitted script writes git — the one kind a guard may run before. Exported for `src/StepGuards.ts`. */
export type ExecutableDecision = Extract<StepDecision, { kind: "commit" }>

/**
 * The user-facing message for a `land` refusal — out-of-turn names the
 * awaited actor, no-match names every declared pattern. `land` derives its
 * invoker from `rest.actor` itself, so out-of-turn is
 * unreachable by construction there; this branch stays reachable only via
 * `PatternMachine.step`'s own tests (a defensive message beats a lie).
 */
const formatStepRefusal = (refusal: StepRefusal): string =>
  refusal.reason === "out-of-turn"
    ? `gtd land: out of turn — "${refusal.state}" awaits ${refusal.awaits}`
    : `gtd land: no declared pattern matches the pending changes at "${refusal.state}" — declared patterns: ${
        refusal.patterns.length > 0 ? refusal.patterns.join(", ") : "(none)"
      }`

/** The commit branch's own trailing outcome: a bare `commitOutcome` for a self-loop (`from === to`), else a `transitionOutcome` naming both states. */
const commitDecisionOutcome = (decision: {
  readonly subject: string
  readonly from: StateName
  readonly to: StateName
}): EmitStep => ({
  kind: "outcome",
  command:
    decision.from === decision.to
      ? commitOutcome(decision.subject)
      : transitionOutcome(decision.from, decision.to),
})

/**
 * Render a `"commit"` decision as the `EmitStep`s the external driver runs to
 * produce its git effect — the ONE place a decision becomes git commands.
 * Pure: no git read, no failure mode — a commit decision always becomes an
 * ordinary commit plus its outcome report.
 */
export const renderDecision = (
  rest: Rest,
  decision: ExecutableDecision,
  cost: number | undefined,
  model: string | undefined,
): readonly EmitStep[] => {
  const command = commitAll(withCostTrailer(decision.subject, cost, model))
  return [{ kind: "gitWrite", command }, commitDecisionOutcome(decision)]
}

/** The `EmittedScripts` a `"commit"` `StepPlan` carries alongside `perform` — built from `renderDecision`'s output. */
const buildStepScripts = (
  rest: Rest,
  decision: ExecutableDecision,
  cost: number | undefined,
  model: string | undefined,
): EmittedScripts => emitScripts(renderDecision(rest, decision, cost, model))

/**
 * Decide a step — WITHOUT performing it. gtd never writes git: the decision
 * becomes the `scripts` field's emitted bash, and only a driver running that
 * script writes anything. The capture guards (`src/StepGuards.ts`) sit
 * between `planStep` and the script's emission by construction.
 */
export type StepPlan =
  | { readonly kind: "refusal"; readonly message: string }
  | { readonly kind: "noop"; readonly state: StateName; readonly settled: boolean }
  | {
      readonly kind: "commit"
      readonly state: StateName
      /** Inspectable — the pure engine's own verdict. */
      readonly decision: StepDecision
      /** The `required`/`optional` bash a driver runs to land this decision — built by `buildStepScripts` from `renderDecision`'s output. */
      readonly scripts: EmittedScripts
    }

/**
 * A no-op is TERMINAL only at a `script` rest: gtd rendered the script, the
 * driver ran it, it left nothing any pattern claims, and re-running it can't
 * change that — the loop should exit rather than spin (`gtd land`'s exit-3
 * `settled` signal). A `prompt` rest can't produce a no-op at all (a clean
 * tree with no `C` row there commits an ATTEMPT instead; `stalledAt` is its
 * own signal for that). A no-op at a `message` rest is a human gate the loop
 * already halts on. This is the ONLY settled shape — `gtd land` never moves
 * HEAD, so a commit decision is never settled, even one re-entering the
 * initial state.
 */
const noOpSettles = (rest: Rest): boolean => contentKindOf(rest.stateDef) === "script"

/**
 * Decide what landing at `rest` does, authenticated as `rest.actor` (the
 * state's own declared actor, so out-of-turn is unreachable by construction),
 * and — for a `"commit"` decision — assemble the emitted `scripts` a driver
 * runs to land it, against `rest.context`.
 */
export const planStep = (
  rest: Rest,
  opts: { readonly cost?: number; readonly model?: string } = {},
): Effect.Effect<StepPlan, Error, RestRequirements> =>
  Effect.sync(() => {
    const decision = step(rest.stepDef, rest.state, rest.actor, {
      changes: rest.changes,
      // The pure engine's retry-entry counting only compares state NAMES,
      // never commit hashes, so `processTrace` stays `readonly StateName[]`.
      processTrace: rest.run.trace.map((entry) => entry.state),
    })

    if (decision.kind === "refusal") {
      return { kind: "refusal", message: formatStepRefusal(decision) } as const
    }
    if (decision.kind === "noop") {
      return { kind: "noop", state: decision.state, settled: noOpSettles(rest) } as const
    }

    const { cost, model } = opts
    const scripts = buildStepScripts(rest, decision, cost, model)

    return { kind: decision.kind, state: rest.state, decision, scripts }
  })

// ── Planning an entry ────────────────────────────────────────────────────────

/** Decide starting a brand-new process. Same refusal/scripts vocabulary as `StepPlan`, kept as a separate type: an entry has no `StepDecision`, so folding it into `StepPlan` would force every ordinary `planStep` caller to narrow away a variant that can never occur there. */
export type EntryPlan =
  | { readonly kind: "refusal"; readonly message: string }
  | {
      readonly kind: "entry"
      readonly state: StateName
      readonly subject: string
      /** The `required`/`optional` bash a driver runs to write the entry commit — one `commitAll(message)` line plus its outcome report. */
      readonly scripts: EmittedScripts
    }

/**
 * `gtd --entry <state>`: start a brand NEW process at `entry.state` — any
 * declared state — writing an ordinary turn commit carrying zero
 * or more `Gtd-Var:` trailers for each `entry.vars` override, plus — when
 * `entry.state` declares a string `reviewBase:` — a `Gtd-Review-Base:`
 * trailer pinning the new process's diff base. Captures whatever the working
 * tree carries at the moment of entry, exactly like an ordinary land capture,
 * rather than demanding a clean tree first.
 *
 * All validation is a REFUSAL, not an Effect failure.
 */
export const planEntry = (
  rest: Rest,
  actor: string,
  entry: {
    readonly state: string
    readonly commandLabel: string
    readonly vars: Record<string, string>
  },
): Effect.Effect<EntryPlan, Error, RestRequirements> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const { state: entryState, commandLabel, vars: varOverrides } = entry

    if (rest.state !== initialStateOf(rest.def)) {
      return {
        kind: "refusal",
        message: `${commandLabel}: a process is already underway (resting at "${rest.state}") — finish it, or run \`gtd abandon\`, before entering`,
      }
    }

    const enterable = enterableStates(rest.def)
    if (!enterable.includes(entryState)) {
      return {
        kind: "refusal",
        message: `${commandLabel}: "${entryState}" is not an enterable state — enterable states:\n${enterable
          .map((s) => `  ${s}`)
          .join("\n")}`,
      }
    }

    const config = yield* (yield* ConfigService).load
    const declaredNames = Object.keys({ ...config.workflowVars, ...config.rcVars })
    const undeclared = Object.keys(varOverrides).filter((name) => !declaredNames.includes(name))
    if (undeclared.length > 0) {
      return {
        kind: "refusal",
        message: `${commandLabel}: --var name(s) not declared by this workflow: ${undeclared.join(
          ", ",
        )} — declared: ${declaredNames.length > 0 ? declaredNames.join(", ") : "(none)"}`,
      }
    }

    const envVars = yield* EnvVars
    const vars = resolveVars(config.workflowVars, config.rcVars, varOverrides, envVars.all)

    let base: string | undefined
    const baseTemplate = entryBaseTemplateOf(rest.def, entryState)
    if (baseTemplate !== undefined) {
      const git = yield* GitService
      const rendered = yield* Effect.try({
        try: () => renderStateTemplate(baseTemplate, varsOnlyContext(vars, entryState)),
        catch: (e) => new Error(`${commandLabel}: ${e instanceof Error ? e.message : String(e)}`),
      })
      if (rendered.trim() === "") {
        const refs = Array.from(
          new Set(Array.from(baseTemplate.matchAll(/it\.vars\.(\w+)/g)).map((m) => m[1]!)),
        )
        return {
          kind: "refusal",
          message: `${commandLabel}: "${entryState}"'s reviewBase template rendered blank — template: ${JSON.stringify(
            baseTemplate,
          )}; it.vars references: ${
            refs.length > 0 ? refs.map((r) => `it.vars.${r}`).join(", ") : "(none found)"
          }`,
        }
      }
      const resolvedBase = yield* Effect.either(git.resolveRef(rendered))
      if (resolvedBase._tag === "Left") {
        return {
          kind: "refusal",
          message: `${commandLabel}: "${rendered}" does not resolve to a commit`,
        }
      }
      const isBaseAncestor = yield* git.isAncestor(resolvedBase.right, "HEAD")
      if (!isBaseAncestor) {
        return {
          kind: "refusal",
          message: `${commandLabel}: "${rendered}" is not an ancestor of HEAD`,
        }
      }
      const headHash = yield* git.resolveRef("HEAD")
      if (resolvedBase.right === headHash) {
        return {
          kind: "refusal",
          message: `${commandLabel}: "${rendered}" is HEAD — nothing to review`,
        }
      }
      base = resolvedBase.right
    }

    const subject = stateSubject(actor, entryState)
    const message = withEntryTrailers(subject, {
      ...(base !== undefined ? { base } : {}),
      vars: varOverrides,
    })
    // The outcome step names the bare subject, never `message` (which may
    // carry the trailers) — same discipline as `renderDecision`'s commit branch.
    const scripts = emitScripts([
      { kind: "gitWrite", command: commitAll(message) },
      { kind: "outcome", command: commitOutcome(subject) },
    ])

    return { kind: "entry", state: entryState, subject, scripts }
  })
