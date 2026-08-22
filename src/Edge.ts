import { Effect, Option } from "effect"
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
  isCommitState,
  isReviewBaseState,
  isReviewWindowState,
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
import { HISTORY_REF, withHistoryTrailer } from "./RetainedHistory.js"
import {
  commitAll,
  commitAsIs,
  discardPending,
  mixedResetTo,
  softResetTo,
  updateRef,
} from "./GitScript.js"
import { emitScripts, type EmitPreconditions, type EmitStep, type EmittedScripts } from "./Emit.js"
import { COLLAPSED_TEXT, commitOutcome, noteOutcome, transitionOutcome } from "./OutcomeScript.js"

// git's empty-tree object — the diff/reset base when a process (or the whole
// repo) has no earlier commit to compare against.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

/**
 * The review checkout window's saved-head ref — duplicated from
 * `src/ReviewWindow.ts`'s own `REVIEW_HEAD_REF` rather than imported, to avoid
 * a circular module dependency (`ReviewWindow.ts` imports FROM this module).
 * Read (never written) here; the window itself is opened/closed elsewhere.
 */
const REVIEW_HEAD_REF = "refs/worktree/gtd/review-head"

const subjectOf = (message: string): string => (message.split("\n")[0] ?? "").trim()

// `gtd land --cost=<n> [--model=<name>]` records the token cost of the
// invocation that produced the pending changes as a `Gtd-Cost: <n> <model>`
// trailer on the turn commit; `computeProcessRun` sums these into
// `it.processCost`/`it.processCostByModel` for a squash `commit:` template.

const COST_TRAILER_PREFIX = "Gtd-Cost: "
// The number comes first so a model-less entry (`Gtd-Cost: 1450`) still parses.
const COST_TRAILER_RE = /^Gtd-Cost:[ \t]*([0-9]+(?:\.[0-9]+)?)(?:[ \t]+(.+?))?[ \t]*$/gm

/** The bucket a cost with no `--model` tag is grouped under, kept distinct so a mixed history still totals correctly. */
export const UNATTRIBUTED_MODEL = "unspecified"

export interface CostEntry {
  readonly cost: number
  readonly model: string
}

/** One model's summed token cost — the shape a squash `commit:` template iterates as `it.processCostByModel`. */
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

/** The currently-rested state, its definition, and its declared actor (never a commit state — `resolveState` excludes those explicitly). */
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
 * unparseable subject, an actor mismatch, a commit-state target) is left as
 * is — those are legitimately "no active process," not a renamed-out state.
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
  // `resolveState` never rests at a commit state (it excludes them
  // explicitly) — this is a defensive check against a programmer error,
  // not a real runtime path.
  if (stateDef.actor === undefined) {
    return {
      ok: false,
      error: new Error(`gtd: resolved at commit state "${state}" — a process never rests there`),
    }
  }
  return { ok: true, rest: { def, state, stateDef, actor: stateDef.actor } }
}

// ── Pending changes ──────────────────────────────────────────────────────────

const pendingChanges = (
  git: GitOperations,
  base?: string,
): Effect.Effect<readonly PendingChange[], Error> =>
  git
    .changedPaths(base)
    .pipe(
      Effect.map((entries) =>
        entries.map((e) => ({ status: normalizeStatus(e.status), path: e.path })),
      ),
    )

// ── The current process run ──────────────────────────────────────────────────

/** One process-trace entry: a state entered, plus the hash of the commit that entered it — the pair `memoryKeyFor` needs to anchor a memory key to the commit immediately BEFORE an unbroken scope entry began. */
export interface TraceEntry {
  readonly state: StateName
  readonly hash: string
}

/** The contiguous run of `gtd(actor): state` commits ending at HEAD. */
export interface ProcessRun {
  /** The run's first commit's hash, or HEAD's own hash when the run is empty (no turn has landed yet this process). */
  readonly startHash: string
  /** The parent of the run's first commit — `EMPTY_TREE` when the run covers the whole history. The squash reset target — this is the process's TRACE/retry boundary, never overridden by a `Gtd-Review-Base:` trailer. */
  readonly startParentHash: string
  /**
   * The base `it.startCommit` renders, and the review checkout window's
   * default base compares against: normally identical to `startParentHash`,
   * but overridden to a `Gtd-Review-Base: <hash>` trailer's hash when the
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
}

/**
 * `ProcessRun.headTurn` from an already-fetched `commitHistory` array
 * (oldest→newest) — HEAD is its last entry. `undefined` for an empty
 * history, an unparseable/foreign subject, or a subject naming a state the
 * ACTIVE definition doesn't declare or that is a commit state (never a real
 * rest).
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
  if (stateDef === undefined || isCommitState(stateDef)) return undefined
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
 * Walk first-parent history backward from HEAD while each commit's subject
 * parses as `gtd(actor): state` and that state isn't the workflow's initial
 * state; stop — excluding that boundary commit, which belongs to the
 * finished process — at a non-matching commit or a commit entering the
 * initial state (the boundary between one approved process and the next;
 * without it, consecutive processes' commits would fuse and `retry` counts
 * would pool across them). HEAD itself being such a boundary yields an EMPTY
 * run (`trace: []`).
 *
 * `head` overrides the literal `HEAD` the walk would otherwise end at:
 * `restAt`'s window-aware branch passes the saved-head hash here while a
 * review window is open, so the trace still covers commits a real `git log`
 * would miss with HEAD rewound to the review base.
 */
const computeProcessRun = (
  git: GitOperations,
  def: WorkflowDefinition,
  head?: string,
): Effect.Effect<ProcessRun, Error> =>
  Effect.gen(function* () {
    const initialState = initialStateOf(def)
    const history = yield* git.commitHistory(undefined, head) // oldest -> newest, full first-parent history
    let i = history.length - 1
    while (i >= 0) {
      const parsed = parseStateSubject(subjectOf(history[i]!.message))
      if (parsed === undefined || parsed.state === initialState) break
      i--
    }
    const startIdx = i + 1
    const processCommits = history.slice(startIdx)
    const trace: TraceEntry[] = processCommits.map((h) => ({
      state: parseStateSubject(subjectOf(h.message))!.state,
      hash: h.hash,
    }))
    const costEntries = parseCostTrailers(processCommits.map((h) => h.message))
    const startParentHash = i >= 0 ? history[i]!.hash : EMPTY_TREE
    const startHash =
      startIdx < history.length ? history[startIdx]!.hash : history[history.length - 1]!.hash
    const { reviewBase: reviewBaseOverride, vars: entryVars } =
      parseEntryCommitOverrides(processCommits)
    const diffBase = reviewBaseOverride ?? startParentHash
    const headTurn = headTurnFrom(def, history)
    return { startHash, startParentHash, diffBase, trace, costEntries, entryVars, headTurn }
  })

/**
 * The run alone, WITHOUT resolving a rest — `gtd abandon`'s escape hatch (it
 * must still work when HEAD names a state `currentRest` would refuse on,
 * since abandon IS the recovery command for that case) and the review
 * window's re-arm, which degrades gracefully (stays closed) rather than
 * erroring on the same kind of foreign/refused rest.
 *
 * Window-aware on exactly the same terms as `restAt`: while a review checkout
 * window is open, real HEAD is rewound to the review base, so walking the
 * trace from literal HEAD would see a process that has not started. Both
 * callers need the REAL head, so the saved head is the walk's origin.
 */
export const currentRun: Effect.Effect<ProcessRun, Error, GitService | ConfigService | Narrator> =
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    const windowHead = Option.getOrUndefined(yield* git.readRefOption(REVIEW_HEAD_REF))
    return yield* computeProcessRun(git, config.workflow, windowHead)
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
 * (`renderOnEdges`). `currentCost`/`currentModel` are the in-flight step's own
 * `--cost`/`--model`, folded into the process's committed cost entries so a
 * `commit:` squash template sees the whole-process total including the
 * squashing step (`0`/absent for the pure emitters, where no step runs). No
 * diff is computed here — `it.reviewBase`/`it.retainedBase` are bases a
 * template tells the agent to `git diff` itself.
 */
const buildTemplateContext = (
  git: GitOperations,
  read: (path: string) => string,
  state: StateName,
  actor: string,
  run: ProcessRun,
  vars: Record<string, string>,
  edges: readonly OnEdge[] | undefined,
  currentCost: number,
  currentModel: string | undefined,
  reviewBase: string,
): Effect.Effect<TemplateContext, Error> =>
  Effect.gen(function* () {
    const currentCommit = yield* git.resolveRef("HEAD")
    const previousCommit = yield* git
      .resolveRef("HEAD~1")
      .pipe(Effect.catchAll(() => Effect.succeed(run.startParentHash)))
    // Fold the in-flight step's own cost into the committed entries so a squash
    // template (rendered against the pending tree) counts the squashing step too.
    const stepEntry =
      currentCost > 0 || currentModel !== undefined
        ? [{ cost: currentCost, model: currentModel ?? UNATTRIBUTED_MODEL }]
        : []
    const allCostEntries = [...run.costEntries, ...stepEntry]
    return {
      startCommit: run.diffBase,
      currentCommit,
      previousCommit,
      state,
      actor,
      reviewBase,
      retainedBase: run.startParentHash,
      processCost: totalCostOf(allCostEntries),
      processCostByModel: costByModel(allCostEntries),
      read,
      vars,
      edges: toTemplateEdges(edges),
    }
  })

/**
 * True when this process would retain NOTHING: nothing pending and no net
 * change between its trace/retry boundary and HEAD. Used by `planStep`'s
 * "returned to the initial state retaining nothing" mixed-reset branch.
 */
const retainsNothing = (
  git: GitOperations,
  run: ProcessRun,
  changes: readonly PendingChange[],
): Effect.Effect<boolean, Error> =>
  Effect.gen(function* () {
    if (changes.length > 0) return false
    const touched = yield* git.changedPathsSince(run.startParentHash)
    return touched.length === 0
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
 * before any mutation — see AGENTS.md: never read a `Rest` after a `perform`,
 * and never let one span the review-window bracket.
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
  /**
   * The open review checkout window's SAVED HEAD (`REVIEW_HEAD_REF`), when one
   * is open — the commit this snapshot's state, trace and `changes` were all
   * resolved against, because real git HEAD is rewound to the review base
   * while the window is open. `undefined` when no window is open, or when the
   * rest was resolved at an explicit `ref`.
   *
   * Carried on the snapshot rather than re-read per caller: it is the
   * PRE-TURN head that a guard's `readFileAtRef` read (`src/StepGuards.ts`)
   * must resolve against, not real `HEAD` — which is rewound to the review
   * base there, where a file the process itself wrote does not exist yet.
   */
  readonly windowHead: string | undefined
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

/**
 * Resolve `Rest` at an arbitrary ref (`gtd visualize` reading the review
 * window's saved head via `REVIEW_HEAD_REF`, or `undefined` for HEAD itself).
 *
 * Window-aware ONLY at `ref === undefined`: when the review checkout window's
 * saved-head ref resolves, its hash is used as the effective head for
 * `lastCommitSubject` and `computeProcessRun`'s trace walk — real git HEAD
 * has been rewound to the review base while the window is open, so reading
 * literal `HEAD` there would resolve state/trace/memory against the wrong
 * commit.
 */
export const restAt = (ref: string | undefined): Effect.Effect<Rest, Error, RestRequirements> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    const files = yield* RepoFiles
    const envVars = yield* EnvVars
    const def = config.workflow

    let windowHead: string | undefined
    if (ref === undefined) {
      windowHead = Option.getOrUndefined(yield* git.readRefOption(REVIEW_HEAD_REF))
    }
    const effectiveRef = windowHead ?? ref

    const headSubject = yield* git.lastCommitSubject(effectiveRef)
    const resolution = resolveRestFrom(def, headSubject)
    if (!resolution.ok) return yield* Effect.fail(resolution.error)
    const resolved = resolution.rest
    yield* (yield* Narrator).narrate(`rest resolved: ${resolved.state} (awaits ${resolved.actor})`)

    const run = yield* computeProcessRun(git, def, windowHead)
    const vars = resolveVars(config.workflowVars, config.rcVars, run.entryVars, envVars.all)
    const on = yield* renderOnEdgesOrFail(resolved.stateDef.on, vars)
    const stepDef = withRenderedOn(def, resolved.state, on)
    const reviewBase = reviewBaseFor(def, run)
    // Measure pending changes against the open window's saved head, not real
    // HEAD (rewound to the review base) — else the whole reviewed diff reads
    // as pending, and a reviewer's deletion of a window-staged file is missed.
    const changes = yield* pendingChanges(git, windowHead)
    const context = yield* buildTemplateContext(
      git,
      templateRead(files),
      resolved.state,
      resolved.actor,
      run,
      vars,
      on,
      0,
      undefined,
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
      windowHead,
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
  /** The resolved rest's `on` edges as `{ pattern, target, describe? }` — the same list templates see as `it.edges`. Always present (an empty array at a commit state); `gtd next --json` emits it so a driver has the routing (and its human-readable `describe`s) alongside the rendered content. */
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
 * Render a `Rest`'s declared content (script/prompt/message — never `commit`,
 * since a `Rest` never rests at a commit state) plus every `STATE_FIELDS`
 * field carrying a `rest` kind and its computed memory key — all of which
 * already live on `rest` (`rest.context`/`rest.hints`/`rest.memory`, built
 * once by `restAt` via `renderHints`), so this takes no other parameters.
 */
export const renderRest = (rest: Rest): Effect.Effect<RenderedRest, Error> =>
  Effect.gen(function* () {
    const kind = contentKindOf(rest.stateDef)
    if (kind === undefined) {
      return yield* Effect.fail(
        new Error(`state "${rest.state}" declares no content — invalid definition`),
      )
    }
    const template =
      rest.stateDef.script ?? rest.stateDef.prompt ?? rest.stateDef.message ?? rest.stateDef.commit!
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

/** A decision whose emitted script writes git — the two kinds a guard may run before. Exported for `src/StepGuards.ts`. */
export type ExecutableDecision = Extract<StepDecision, { kind: "commit" | "squash" }>

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

/**
 * Build the `TemplateContext` for rendering a DIFFERENT state than `rest`'s
 * own resting one, with a step's `cost`/`model` folded in — a squash's commit
 * template needs this; it is NOT interchangeable with `rest.context`, which
 * is pinned to the resting state with `cost: 0`. Exported for `program.ts`'s
 * `planLanding`, which assembles the same script by hand and must pick the
 * same context.
 */
export const contextAt = (
  rest: Rest,
  targetState: StateName,
  invoker: string,
  cost: number | undefined,
  model: string | undefined,
): Effect.Effect<TemplateContext, Error, GitService | RepoFiles> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const files = yield* RepoFiles
    const onEdges =
      targetState === rest.state
        ? rest.on
        : yield* renderOnEdgesOrFail(rest.def.states[targetState]?.on, rest.vars)
    return yield* buildTemplateContext(
      git,
      templateRead(files),
      targetState,
      invoker,
      rest.run,
      rest.vars,
      onEdges,
      cost ?? 0,
      model,
      reviewBaseFor(rest.def, rest.run),
    )
  })

/** `updateRef(HISTORY_REF, tip)` as a single-element (or empty) step list — OMITTED when `tip === startParentHash`, mirroring `retainHistory`'s own no-op check. Shared by the squash branch and the commit branch's collapse case below. */
const retainHistoryStep = (tip: string, startParentHash: string): readonly EmitStep[] =>
  tip === startParentHash ? [] : [{ kind: "gitWrite", command: updateRef(HISTORY_REF, tip) }]

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
 * True for a `"commit"` decision that is the "green re-entry into the initial
 * state retaining nothing" collapse — target is the initial state, the
 * process started somewhere other than the empty tree, and nothing pending or
 * already-committed since its start parent survives (`retainsNothing`).
 * Always `false` for a `"squash"` decision and for an ATTEMPT: an agent that
 * did nothing must never rewind a process, and an attempt landing at a prompt
 * state that's also the initial state would otherwise satisfy every other
 * criterion identically to a genuine collapse.
 */
const collapsesWith = (
  git: GitOperations,
  rest: Rest,
  decision: ExecutableDecision,
): Effect.Effect<boolean, Error> =>
  Effect.gen(function* () {
    if (decision.kind === "squash" || decision.attempt === true) return false
    const target = parseStateSubject(decision.subject)?.state
    return (
      target === initialStateOf(rest.def) &&
      rest.run.startParentHash !== EMPTY_TREE &&
      (yield* retainsNothing(git, rest.run, rest.changes))
    )
  })

/**
 * The service-requiring twin of `collapsesWith`, for `program.ts` to ask
 * instead of reaching into `GitService` itself — the boundary AGENTS.md pins.
 * `planLanding` calls this to fill `LandResult.settled` for a `"commit"`/
 * `"squash"` plan, off the same `rest`/`decision` `renderDecision` already
 * decided against, so the two git reads (`changedPathsSince` + `resolveRef`)
 * can never disagree with each other.
 */
export const collapsesToInitialState = (
  rest: Rest,
  decision: ExecutableDecision,
): Effect.Effect<boolean, Error, GitService> =>
  Effect.gen(function* () {
    const git = yield* GitService
    return yield* collapsesWith(git, rest, decision)
  })

/**
 * Render a `"commit"`/`"squash"` decision as the `EmitStep`s the external
 * driver runs to produce its git effect — the ONE place a decision becomes
 * git commands. Every git call here is a READ; nothing is written — gtd
 * itself never writes git, only a driven script does.
 *
 * The commit branch carries one non-obvious case: a commit whose target is
 * the workflow's INITIAL state, from a process that retained nothing, is a
 * no-op probe (`gtd --entry fix-precheck` against a green suite is the
 * shipped example) and must leave no trace — it emits retain-history plus a
 * mixed reset to the process start instead of a commit, so the entry commit
 * and the probe collapse away together rather than dirtying the log with a
 * round trip to `idle`.
 */
export const renderDecision = (
  git: GitOperations,
  rest: Rest,
  decision: ExecutableDecision,
  context: TemplateContext,
  cost: number | undefined,
  model: string | undefined,
): Effect.Effect<readonly EmitStep[], Error> =>
  Effect.gen(function* () {
    const run = rest.run
    switch (decision.kind) {
      case "commit": {
        if (yield* collapsesWith(git, rest, decision)) {
          const tip = yield* git.resolveRef("HEAD")
          return [
            ...retainHistoryStep(tip, run.startParentHash),
            { kind: "gitWrite", command: mixedResetTo(run.startParentHash) },
            { kind: "outcome", command: noteOutcome(COLLAPSED_TEXT) },
          ]
        }
        const command = commitAll(withCostTrailer(decision.subject, cost, model))
        return [{ kind: "gitWrite", command }, commitDecisionOutcome(decision)]
      }
      case "squash": {
        const message = yield* Effect.try({
          try: () => renderStateTemplate(decision.template, context),
          catch: (e) =>
            new Error(
              `gtd: rendering the "${decision.state}" commit template failed — nothing was committed: ${
                e instanceof Error ? e.message : String(e)
              }`,
            ),
        })
        const tip = yield* git.resolveRef("HEAD")
        return [
          ...retainHistoryStep(tip, run.startParentHash),
          { kind: "gitWrite", command: softResetTo(run.startParentHash) },
          { kind: "gitWrite", command: commitAsIs(withHistoryTrailer(message, tip)) },
          { kind: "gitWrite", command: discardPending() },
          { kind: "outcome", command: commitOutcome(subjectOf(message)) },
        ]
      }
    }
  })

/**
 * The `EmitPreconditions` a step's/entry's assembled scripts assert against:
 * `expectedHead` is the resolved HEAD hash the `Rest` snapshot was taken at.
 * When `targetState` declares `reviewWindow: true` and a window is currently
 * open, the script also pins the window's saved-head hash — a later run whose
 * window has since closed or moved must re-decide rather than trust a stale
 * script.
 */
const buildPreconditions = (
  git: GitOperations,
  rest: Rest,
  targetState: StateName,
): Effect.Effect<EmitPreconditions, Error> =>
  Effect.gen(function* () {
    const expectedHead = rest.context.currentCommit
    if (!isReviewWindowState(rest.def, targetState)) {
      return { expectedHead }
    }
    const windowHead = yield* git.readRefOption(REVIEW_HEAD_REF)
    if (Option.isNone(windowHead)) return { expectedHead }
    return { expectedHead, reviewWindow: { ref: REVIEW_HEAD_REF, expectedHash: windowHead.value } }
  })

/**
 * The `EmittedScripts` a `"commit"`/`"squash"` `StepPlan` carries alongside
 * `perform` — built from the SAME `renderDecision` output, but a render
 * failure collapses to an EMPTY script (`emitScripts` with no steps) instead
 * of failing this Effect: `perform` stays the one place a render failure is
 * ever reported to a caller, unchanged by this addition.
 */
const buildStepScripts = (
  git: GitOperations,
  rest: Rest,
  decision: ExecutableDecision,
  context: TemplateContext,
  cost: number | undefined,
  model: string | undefined,
): Effect.Effect<EmittedScripts, Error> =>
  Effect.gen(function* () {
    const targetState = decision.kind === "commit" ? decision.to : decision.state
    const preconditions = yield* buildPreconditions(git, rest, targetState)
    const steps = yield* renderDecision(git, rest, decision, context, cost, model).pipe(
      Effect.catchAll(() => Effect.succeed<readonly EmitStep[]>([])),
    )
    return emitScripts(preconditions, steps)
  })

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
      readonly kind: "commit" | "squash"
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
 * already halts on. This is one of TWO settled shapes — the other is the
 * initial-state collapse, decided independently by `program.ts`'s
 * `planLanding`.
 */
const noOpSettles = (rest: Rest): boolean => contentKindOf(rest.stateDef) === "script"

/**
 * Decide what landing at `rest` does, authenticated as `rest.actor` (the
 * state's own declared actor, so out-of-turn is unreachable by construction),
 * and — for a `"commit"`/`"squash"` decision — assemble the emitted `scripts`
 * a driver runs to land it (against `rest.context` for a commit, or a
 * freshly built `contextAt` for a squash, which renders a DIFFERENT state's
 * template with the step's cost folded in).
 */
export const planStep = (
  rest: Rest,
  opts: { readonly cost?: number; readonly model?: string } = {},
): Effect.Effect<StepPlan, Error, RestRequirements> =>
  Effect.gen(function* () {
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
    const git = yield* GitService
    const scriptContext =
      decision.kind === "commit"
        ? rest.context
        : yield* contextAt(rest, decision.state, rest.actor, cost, model)
    const scripts = yield* buildStepScripts(git, rest, decision, scriptContext, cost, model)

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
 * declared, non-commit state — writing an ordinary turn commit carrying zero
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
    const scriptsGit = yield* GitService
    const preconditions = yield* buildPreconditions(scriptsGit, rest, entryState)
    const scripts = emitScripts(preconditions, [
      { kind: "gitWrite", command: commitAll(message) },
      { kind: "outcome", command: commitOutcome(subject) },
    ])

    return { kind: "entry", state: entryState, subject, scripts }
  })
