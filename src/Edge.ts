import { Effect } from "effect"
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
import { retainHistory, withHistoryTrailer } from "./RetainedHistory.js"

/**
 * The v3 Effect edge. Everything git/filesystem-shaped lives here —
 * `program.ts` calls this module and never touches `GitService` or
 * `PatternMachine`'s pure functions directly (with the narrow exceptions
 * `AGENTS.md` names: the abandon/restore resets, and the two gates' own
 * `readFileAtRef` reads).
 *
 * The module's one entry point is `currentRest`/`restAt`: a SNAPSHOT of
 * everything derivable from where the process rests right now — never read a
 * `Rest` after a `perform`, and never let one span the review-window bracket
 * (`src/ReviewWindow.ts` opens/closes around every command; a `Rest` resolved
 * before that bracket runs would resolve against the wrong HEAD).
 *
 * `currentRest`/`restAt` resolve the following stages, in order, threading a
 * single `hasCommits()` read through every stage that needs it (today's three
 * separate calls collapse to one):
 *
 *  1. `config.load`
 *  2. `hasCommits()`
 *  3. `lastCommitSubject(ref)` when there are commits
 *  4. the pure `resolveRestFrom(def, headSubject)` → `ResolvedRest`, or the
 *     renamed-state refusal
 *  5. `commitHistory()` → `ProcessRun`
 *  6. `vars` — the four-layer merge (workflow < rc < entry commit < env)
 *  7. `on` — the resting state's `on` edges, rendered against `vars` (Eta
 *     templates; `vars` must precede this)
 *  8. `stepDef` — `def` with `on` patched onto the resting state, the shape
 *     `PatternMachine.step` must be fed
 *  9. `reviewBase` — the pure `reviewBaseFor(def, run)`
 * 10. `changes` — `changedPaths()`
 * 11. `context` — the full `TemplateContext` (`on` and `reviewBase` both feed
 *     it — `it.edges` derives from `on`)
 * 12. `memory`, then `hints` (`model`/`label`/`file` rendered against
 *     `context`; `mode` passed through verbatim)
 *
 * Two module rules, enforced on this file itself: a private helper with only
 * ONE caller stays unexported (`contextAt` and `restWithVars` both fold this
 * way), and `Rest.stepDef` is the one deliberate exception — it exists solely
 * as the type-level statement that `compileWorkflowConfig`'s output is not
 * what `PatternMachine.step` consumes, despite having a single reader.
 */

// git's empty-tree object — the diff/reset base when a process (or the whole
// repo) has no earlier commit to compare against.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

const subjectOf = (message: string): string => (message.split("\n")[0] ?? "").trim()

// ── Token-cost trailers ──────────────────────────────────────────────────────
//
// `gtd step <actor> --cost=<n> [--model=<name>]` records the token cost of the
// invocation that just produced the pending changes — and the model it ran on
// — as a `Gtd-Cost: <n> <model>` trailer on the turn commit, persisted in the
// git log, one entry per turn. `computeProcessRun` collects every such entry
// across the current process's commits; the edge sums them into
// `it.processCost` and groups them by model into `it.processCostByModel`, so a
// `commit:` squash template can render both the whole-process total and a
// per-model breakdown (token cost only tells you the price once you know which
// model spent it).

const COST_TRAILER_PREFIX = "Gtd-Cost: "
// One `Gtd-Cost: <number>[ <model>]` trailer line — a non-negative integer or
// decimal, followed by an OPTIONAL model tag (the rest of the line). The number
// comes first so a model-less entry (`Gtd-Cost: 1450`) still parses. Matched
// anywhere in a commit message body (multiline).
const COST_TRAILER_RE = /^Gtd-Cost:[ \t]*([0-9]+(?:\.[0-9]+)?)(?:[ \t]+(.+?))?[ \t]*$/gm

/** The bucket a cost with no `--model` tag is grouped under, kept distinct so a mixed history still totals correctly. */
export const UNATTRIBUTED_MODEL = "unspecified"

/** One recorded invocation cost: its token count and the model it ran on (`UNATTRIBUTED_MODEL` when none was tagged). */
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
 * Append a `Gtd-Cost: <cost>[ <model>]` trailer (after a blank line) to a
 * commit `subject`, or return the subject unchanged when no cost was supplied.
 * The subject (first line) is never touched, so `parseStateSubject`/
 * `resolveState` still read `gtd(<actor>): <state>` back exactly as before.
 */
const withCostTrailer = (
  subject: string,
  cost: number | undefined,
  model: string | undefined,
): string =>
  cost === undefined
    ? subject
    : `${subject}\n\n${COST_TRAILER_PREFIX}${cost}${model !== undefined ? ` ${model}` : ""}`

/** Every `Gtd-Cost:` entry found across the given commit messages (each entry's model defaults to `UNATTRIBUTED_MODEL`). */
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

// ── Review-base trailer ──────────────────────────────────────────────────────
//
// `gtd step <actor> --entry <state>` (`planEntry` below) starts a brand NEW
// review process by writing an ordinary empty turn commit into a state whose
// template-form `reviewBase:` renders to a commitish, carrying that
// commitish's full hash as a `Gtd-Review-Base:` trailer. `computeProcessRun`
// reads that trailer back off the process's own first (oldest) commit to
// override the run's DIFF base (`ProcessRun.diffBase`) — everything
// downstream keyed to the diff base (`it.startCommit`, the review checkout
// window's default base) keys off that one value, so re-pointing it makes the
// whole existing review flow (reviewing → await-review → feedback laps)
// operate over `<commitish>..HEAD` with no duplicated logic. The process's
// TRACE/retry boundary (`startParentHash`) is UNCHANGED by this — the entry
// commit's own parent is a non-workflow commit (a plain PR-branch commit), so
// the existing boundary rule already stops the trace walk there; only the
// DIFF base moves.

const REVIEW_BASE_TRAILER_PREFIX = "Gtd-Review-Base: "
// One `Gtd-Review-Base: <hash>` trailer line — mirrors `COST_TRAILER_RE`'s
// shape/placement (a blank line, then the trailer, below the untouched
// subject), but carries a single bare token (the resolved commitish's full
// hash) rather than a number/model pair.
const REVIEW_BASE_TRAILER_RE = /^Gtd-Review-Base:[ \t]*(\S+)[ \t]*$/m

/**
 * The `Gtd-Review-Base: <hash>` trailer recorded on a `gtd step <actor>
 * --entry <state>` entry commit (see `withEntryTrailers`), or `undefined`
 * when `message` carries none. Read back by `computeProcessRun` — ONLY off
 * the process's first (oldest) commit — to override the run's diff base.
 */
const parseReviewBaseTrailer = (message: string): string | undefined =>
  REVIEW_BASE_TRAILER_RE.exec(message)?.[1]

// ── Entry-var trailers ───────────────────────────────────────────────────────
//
// An entry commit (e.g. `gtd step <actor> --entry <state>`) can carry,
// alongside its optional `Gtd-Review-Base:` trailer, zero or more `Gtd-Var:
// <name>=<value>` trailers — arbitrary `it.vars` overrides fixed at the moment
// the process started, read back by `computeProcessRun` (again, ONLY off the
// process's oldest commit — never a later turn's) into `ProcessRun.entryVars`,
// and folded into `resolveVars`'s merge below the environment layer.

const ENTRY_VAR_TRAILER_PREFIX = "Gtd-Var: "
// One `Gtd-Var: <name>=<value>` trailer line — the value is everything after
// the FIRST `=`, so a value containing `=` itself round-trips. Matched
// anywhere in a commit message body (multiline), like `COST_TRAILER_RE`.
const ENTRY_VAR_TRAILER_RE = /^Gtd-Var:[ \t]*([^=\s]+)=(.*)$/gm

/**
 * Compose, after a blank line, a `Gtd-Review-Base: <base>` line (when
 * `opts.base !== undefined`, readable back by `parseReviewBaseTrailer`),
 * followed by one `Gtd-Var: <name>=<value>` line per `opts.vars` entry (in
 * `Object.entries` order) — the single place that formats either trailer, for
 * every entry commit `planEntry` writes. Mirrors `withCostTrailer`'s "nothing
 * to add → unchanged" shape: with no base and an empty `opts.vars`, `subject`
 * is returned untouched.
 */
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

/**
 * Every `Gtd-Var: <name>=<value>` trailer found in `message` (each value
 * split on the FIRST `=` only, so a value containing `=` round-trips), or
 * `{}` when `message` carries none. Read back by `computeProcessRun` — ONLY
 * off the process's first (oldest) commit — into `ProcessRun.entryVars`.
 */
const parseEntryVarTrailers = (message: string): Record<string, string> => {
  const vars: Record<string, string> = {}
  for (const match of message.matchAll(ENTRY_VAR_TRAILER_RE)) vars[match[1]!] = match[2]!
  return vars
}

/** The total token cost across the given entries (`0` when none). */
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

/** Collapse an arbitrary git status letter to the pattern grammar's closed `A|M|D` set (mirrors the plan's decision 5 — only those three are meaningful statuses). */
const normalizeStatus = (raw: string): ChangeStatus => (raw === "A" ? "A" : raw === "D" ? "D" : "M")

// ── Resolving the current rest ──────────────────────────────────────────────

/** The currently-rested state, its definition, and its declared actor (never a commit state — see `resolveRestFrom`'s docs). */
export interface ResolvedRest {
  readonly def: WorkflowDefinition
  readonly state: StateName
  readonly stateDef: StateDef
  readonly actor: string
}

/** `resolveRestFrom`'s outcome: either a resolved rest, or a finished, user-facing refusal message. */
type RestResolution =
  | { readonly ok: true; readonly rest: ResolvedRest }
  | { readonly ok: false; readonly error: Error }

/**
 * Resolve a HEAD commit's subject against the active workflow definition —
 * PURE: no git, no Effect. `headSubject` is `""` when the repo has no commits
 * yet (the caller supplies it, already read).
 *
 * A HEAD subject that DOES parse as a `gtd(actor): state` commit, but whose
 * named state the CURRENT workflow definition doesn't declare AT ALL, is
 * refused loudly here rather than silently falling through `resolveState`'s
 * own initial-state fallback: an in-flight process left resting at a state a
 * workflow upgrade then renamed/removed out from under it would otherwise
 * look like a perfectly fresh, idle repo, pointing at the command that
 * actually resolves it (`gtd abandon`) rather than a generic failure.
 * Distinct from `memoryScopeAt`'s graceful "unmapped state reads as fresh
 * entry" behavior (`src/PatternMachine.ts`), which handles a state that IS
 * declared but merely missing from `scopes` (a compiler bug, not a rename) —
 * this is about a state that no longer exists in the definition at all. Every
 * OTHER case `resolveState` already folds into "rest at the initial state"
 * (an unparseable subject, an actor mismatch, a commit-state target) is left
 * exactly as it was — those are legitimately "no active process" readings,
 * not a renamed-out-from-under-us one.
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

/** The working tree's pending changes vs HEAD, as the pattern grammar's `{status, path}[]`. */
const pendingChanges = (git: GitOperations): Effect.Effect<readonly PendingChange[], Error> =>
  git
    .changedPaths()
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
  /** The parent of the run's first commit — `EMPTY_TREE` when the run covers the whole history. The squash reset target — this is the process's TRACE/retry boundary, never overridden by a `Gtd-Review-Base:` trailer (see `diffBase`). */
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
 * parses as `gtd(actor): state` (a v3 workflow commit) AND that state isn't
 * the workflow's initial state; the walk stops — EXCLUDING that boundary
 * commit itself, which belongs to the finished process — at whichever comes
 * first:
 *
 * - a non-matching commit (a foreign boundary: legacy/pre-v3 history, the
 *   repo's own root commit), or
 * - a workflow commit that ENTERS the initial state (e.g. the bundled
 *   default's `gtd(human): idle`) — with no `commit:`/squash state in the
 *   default workflow anymore, this is the process boundary between one
 *   approved process and the next: without it, consecutive processes' commits
 *   would fuse into one process and `retry` counts would pool across processes.
 *
 * HEAD itself being such an initial-entering commit yields an EMPTY run
 * (`trace: []`, `startHash`/`startParentHash` both HEAD's own hash) — the
 * same shape a fresh rest at a squashed boundary has always had.
 *
 * `hasCommits` is supplied by the caller (already read once — see the module
 * doc comment's stage ordering) rather than re-read here.
 */
const computeProcessRun = (
  git: GitOperations,
  def: WorkflowDefinition,
  hasCommits: boolean,
): Effect.Effect<ProcessRun, Error> =>
  Effect.gen(function* () {
    if (!hasCommits)
      return {
        startHash: "",
        startParentHash: EMPTY_TREE,
        diffBase: EMPTY_TREE,
        trace: [],
        costEntries: [],
        entryVars: {},
      }

    const initialState = initialStateOf(def)
    const history = yield* git.commitHistory() // oldest -> newest, full first-parent history
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
    return { startHash, startParentHash, diffBase, trace, costEntries, entryVars }
  })

/**
 * The run alone, WITHOUT resolving a rest — `gtd abandon`'s escape hatch (it
 * must still work when HEAD names a state `currentRest` would refuse on,
 * since abandon IS the recovery command for that case) and the review
 * window's re-arm (`openReviewWindow` stays graceful there too — see its own
 * doc comment).
 */
export const currentRun: Effect.Effect<ProcessRun, Error, GitService | ConfigService> = Effect.gen(
  function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    const hasCommits = yield* git.hasCommits()
    return yield* computeProcessRun(git, config.workflow, hasCommits)
  },
)

/**
 * PURE: the most-recent in-process turn commit that entered a `reviewBase`
 * state, or `run.diffBase` when none did (moved out of `src/ReviewWindow.ts`,
 * folding its `?? run.diffBase` fallback in). `run.trace` already carries
 * `{state, hash}` for exactly the commits the old `reviewBaseHash` re-walked
 * with a second `commitHistory(startParentHash)` git call — this is a
 * backwards walk of that trace instead, so no git call, no matter how deep
 * the process.
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
// — `memoryScopeAt` (package 04) never names the root itself, so a driver
// keying memory off a root-owned prompt state needs SOME label rather than a
// bare `#<hash>` key.
const ROOT_MEMORY_SCOPE_NAME = "root"

/**
 * Compute the commit-anchored memory key for the currently-rested state, or
 * `undefined` when none applies — the pure `memoryScopeAt` result turned into
 * an actual key string a memory-aware driver can group consecutive agent
 * turns by (see `TraceEntry`/`ProcessRun.trace`).
 *
 * Only a `prompt`-content rest carries a memory key — mirrors the rule that
 * only a prompt state carries `model` (kept here, not inside `memoryScopeAt`,
 * so that stays a clean, reusable primitive with no content-kind opinion).
 * `undefined` also propagates when `memoryScopeAt` itself can't resolve a
 * scope (`rest.state` absent from `scopes` — see its own doc comment).
 *
 * The key is `${scope || ROOT_MEMORY_SCOPE_NAME}#${token.slice(0, 7)}`, where
 * `token` anchors to the commit the CURRENT unbroken scope entry started
 * FROM, not the entry's own commit: `run.startParentHash` at `entryIndex <=
 * 0` (an empty trace, or the entry sitting at trace position 0 — no earlier
 * commit exists yet), else `run.trace[entryIndex - 1].hash`. Anchoring to the
 * entry's own commit would give a workflow whose initial state is a prompt
 * state two different tokens across its first two turns (nothing committed
 * yet before the very first turn) — anchoring to the commit the entry
 * started FROM makes the empty-trace and position-0 cases coincide by
 * construction.
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

// ── Variables (`it.vars`) ────────────────────────────────────────────────────

const PREFIX = "GTD_"

/**
 * Assemble the merged `it.vars` map every template sees, from four layers
 * (later wins): the active workflow's own declared `vars:` defaults
 * (`ConfigOperations.workflowVars`), the top-level `.gtdrc` `vars:` key
 * (`ConfigOperations.rcVars`), the current process's entry commit's
 * `Gtd-Var:` trailers (`ProcessRun.entryVars` — fixed overrides recorded at
 * the moment a process like `gtd step <actor> --entry <state>` started it),
 * and — for each name declared by any of those three layers — a
 * `GTD_<UPPERCASE-name>` environment variable, if defined. Unlike the first
 * three layers, the environment can only OVERRIDE a name some earlier layer
 * already declared; it can never introduce a new one (an uppercased env key
 * can't round-trip back to an arbitrary camelCase name), so a `GTD_*` var
 * matching no declared name is silently ignored. A `value === undefined`
 * entry (a name declared-but-unset in the environment) is skipped, never
 * coerced to the string `"undefined"`. `entryVars`, by contrast, needs no
 * such filtering — it's a plain unconditional spread, so a name from an old
 * commit that matches neither the workflow nor the rc layer still lands in
 * the merged map (pure and total; never throws). Pure: `env` is whatever the
 * caller's `EnvVars` service handed it, never `process.env` read directly
 * here.
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

/** Map a state's raw `on` edges to the `{ pattern, target, describe?, action? }` shape templates see as `it.edges`. `action` follows the same presence discipline as `describe` — included only when defined, never set to `undefined` — so an edge with an `action` but no `describe` (the slot-3 placeholder case) yields `{ pattern, target, action }` with no `describe` key at all. `undefined` (a commit state, no `on`) yields an empty list. Callers pass already-rendered edges (see `renderOnEdges`) — this never renders anything itself. */
const toTemplateEdges = (edges: readonly OnEdge[] | undefined): readonly TemplateEdge[] =>
  (edges ?? []).map(([pattern, target, describe, action]) => ({
    pattern,
    target,
    ...(describe !== undefined ? { describe } : {}),
    ...(action !== undefined ? { action } : {}),
  }))

/**
 * Render every `on` edge's pattern key as an Eta template over `vars` ONLY
 * (`PatternTemplates.varsOnlyContext`) — a pattern names a path; it never
 * needs diffs/commit hashes, and restricting to `vars` avoids an ordering
 * circularity (the full `TemplateContext`'s `it.edges` is itself derived from
 * these same `on` edges). `target`/`describe`/`action` pass through verbatim —
 * both `describe` and `action` are inert to the engine and are never
 * rendered, unlike the pattern key; an edge carrying an `action` but no
 * `describe` round-trips through the same slot-3 `undefined` placeholder
 * `PatternConfig.compileOnEdge` produces. Throws whatever Eta throws on a
 * malformed pattern template; the caller turns that into a step refusal /
 * command error, exactly like a content render failure.
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

/** Render a state's `on` edges against `vars` (see `renderOnEdges`), surfacing a malformed pattern template as a plain `Error`, exactly like a content render failure. */
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
 * state needs patching: `step`'s retry/target logic keys on state NAMES, not
 * on any other state's `on`, so every other state is left as-is.
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
 * at the resolved rest. `vars` is the already-merged four-layer map (see
 * `resolveVars`); `edges` is the resting state's own `on` edges, ALREADY
 * RENDERED by the caller (`renderOnEdges`) — this function never renders a
 * pattern itself, it only maps the given edges into `it.edges`
 * (`toTemplateEdges`). `currentCost`/`currentModel` are the in-flight step's own
 * `--cost`/`--model` (folded into the process's committed cost entries so a
 * `commit:` squash template sees the whole-process total AND per-model
 * breakdown including the squashing step) — `0`/absent for the pure emitters
 * (`gtd next`/`gtd status`), where no step is being performed. No diff is ever
 * computed here — `it.reviewBase`/`it.retainedBase` are bases a template tells
 * the agent to `git diff` itself. `hasCommits` is supplied by the caller
 * (already read once — see the module doc comment's stage ordering) rather
 * than re-read here.
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
  hasCommits: boolean,
): Effect.Effect<TemplateContext, Error> =>
  Effect.gen(function* () {
    const currentCommit = hasCommits ? yield* git.resolveRef("HEAD") : ""
    const previousCommit = hasCommits
      ? yield* git
          .resolveRef("HEAD~1")
          .pipe(Effect.catchAll(() => Effect.succeed(run.startParentHash)))
      : ""
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

/** The four services resolving a rest needs. */
export type RestRequirements = GitService | ConfigService | RepoFiles | EnvVars

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
 * before any mutation: never read a `Rest` after a `perform`, and never let
 * one span the review-window bracket (see the module doc comment).
 */
export interface Rest extends ResolvedRest {
  readonly run: ProcessRun
  /** The merged four-layer `it.vars`. */
  readonly vars: Record<string, string>
  /** The resting state's `on` edges, already rendered against `vars`. */
  readonly on: readonly OnEdge[]
  /** `def` with `on` patched onto the resting state — what `PatternMachine.step` must be fed. The one deliberate exception to this module's two-caller rule (see the module doc comment). */
  readonly stepDef: WorkflowDefinition
  readonly changes: readonly PendingChange[]
  readonly memory: string | undefined
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
 * window's saved head via `REVIEW_HEAD_REF`, or `undefined` for HEAD itself —
 * see `currentRest`). Assembles every stage documented in the module doc
 * comment, threading one `hasCommits()` read through stages 3/5/11.
 */
export const restAt = (ref: string | undefined): Effect.Effect<Rest, Error, RestRequirements> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    const files = yield* RepoFiles
    const envVars = yield* EnvVars
    const def = config.workflow

    const hasCommits = yield* git.hasCommits()
    const headSubject = hasCommits ? yield* git.lastCommitSubject(ref) : ""
    const resolution = resolveRestFrom(def, headSubject)
    if (!resolution.ok) return yield* Effect.fail(resolution.error)
    const resolved = resolution.rest

    const run = yield* computeProcessRun(git, def, hasCommits)
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
      0,
      undefined,
      reviewBase,
      hasCommits,
    )
    const memory = memoryKeyFor(config.stateScopes, resolved, run)
    const hints = yield* renderHints(resolved.stateDef, context)

    return { ...resolved, run, vars, on, stepDef, changes, memory, hints, context }
  })

/** THE call. No parens, no options — an Effect value, like `openReviewWindow`. */
export const currentRest: Effect.Effect<Rest, Error, RestRequirements> = restAt(undefined)

// ── Rendering the resolved rest's content ────────────────────────────────────

export interface RenderedRest extends RestHints {
  readonly state: StateName
  readonly actor: string
  readonly kind: ContentKind
  readonly content: string
  /** The resolved rest's COMPUTED memory key (`memoryKeyFor`) — a commit-anchored `<scope>#<hash7>` string, omitted (not `undefined`-valued) for a non-`prompt` rest or when no scope resolves, same discipline as the `RestHints` fields. Not sourced from the state's own (still-accepted, but now unread) `memory:` declaration. */
  readonly memory?: string
  /** The resolved rest's `on` edges as `{ pattern, target, describe? }` — the same list templates see as `it.edges` (see `toTemplateEdges`). Always present (an empty array at a commit state); `gtd next --json` emits it so a driver has the routing (and its human-readable `describe`s) alongside the rendered content. */
  readonly edges: readonly TemplateEdge[]
}

/**
 * Render one state field (`model`/`label`/`file`/…) through the SAME
 * template context as its content — a plain string with no Eta tags (e.g.
 * `"smart"`) passes through unchanged, but `"<%= it.vars.reviewModel %>"`
 * now resolves against the merged `it.vars`. `undefined` (the field absent,
 * or not a string) passes through as `undefined`. A render failure behaves
 * exactly like a content render failure at the same call site (`gtd next`/
 * `gtd status` error out, nothing committed) — see `renderRest`.
 */
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
      // `rest.context.edges` is the resting state's `on` edges, already
      // rendered against `it.vars` — not re-derived from `rest.stateDef.on`
      // here, which would be the unrendered literal.
      edges: rest.context.edges,
    }
  })

// ── Planning + performing a step ─────────────────────────────────────────────

/** A step's outcome, for the CLI to report. */
export type StepOutcome =
  | { readonly kind: "commit"; readonly subject: string }
  | { readonly kind: "squash"; readonly subject: string }
  | { readonly kind: "noop"; readonly state: StateName }
  /** The mixed-reset branch: a process that returned to the initial state retaining nothing was rewound instead of committed. */
  | { readonly kind: "reset"; readonly state: StateName }
  /** `planEntry`'s successful commit. */
  | { readonly kind: "entry"; readonly state: StateName; readonly subject: string }

/** The two `StepDecision` kinds that actually perform IO — `"refusal"` and `"noop"` are handled by `planStep` itself before a `perform` closure is ever built. */
/** A decision that actually writes git — the two kinds a guard may run before. Exported for `src/StepGuards.ts`. */
export type ExecutableDecision = Extract<StepDecision, { kind: "commit" | "squash" }>

/** The user-facing message for a `step` refusal — out-of-turn names the awaited actor, no-match names every declared pattern. */
const formatStepRefusal = (invoker: string, refusal: StepRefusal): string =>
  refusal.reason === "out-of-turn"
    ? `gtd step ${invoker}: out of turn — "${refusal.state}" awaits ${refusal.awaits}`
    : `gtd step ${invoker}: no declared pattern matches the pending changes at "${refusal.state}" — declared patterns: ${
        refusal.patterns.length > 0 ? refusal.patterns.join(", ") : "(none)"
      }`

/**
 * Build the `TemplateContext` for rendering a DIFFERENT state than `rest`'s
 * own resting one, with a step's `cost`/`model` folded in — `planStep`'s
 * squash branch is its only caller (the commit branch never reads a
 * `TemplateContext` — see `executeDecision`), so this stays unexported per
 * the module's two-caller rule.
 */
const contextAt = (
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
    const hasCommits = yield* git.hasCommits()
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
      hasCommits,
    )
  })

/**
 * Execute a `"commit"`/`"squash"` decision: a `"commit"` decision stages and
 * commits everything pending under the decided subject, with an optional
 * `Gtd-Cost: <cost>[ <model>]` trailer; a `"squash"` decision renders the
 * commit-state template against the PENDING tree — a render failure REFUSES
 * the step, touching nothing — then records the pre-squash tip on the
 * retained-history ref (`retainHistory`, a no-op for an empty process) before
 * soft-resetting to the process's start parent, writes ONE commit with the
 * rendered message plus a `Gtd-History: <hash>` trailer pointing at that tip,
 * and discards everything left pending (the template file included). The
 * whole-process total and per-model breakdown reach the message through
 * `it.processCost`/`it.processCostByModel` in the rendered template.
 */
const executeDecision = (
  git: GitOperations,
  run: ProcessRun,
  decision: ExecutableDecision,
  context: TemplateContext,
  cost: number | undefined,
  model: string | undefined,
): Effect.Effect<StepOutcome, Error> =>
  Effect.gen(function* () {
    switch (decision.kind) {
      case "commit": {
        yield* git.commitAllWithPrefix(withCostTrailer(decision.subject, cost, model))
        return { kind: "commit", subject: decision.subject }
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
        yield* retainHistory(git, tip, run.startParentHash)
        yield* git.softResetTo(run.startParentHash)
        yield* git.commitAsIs(withHistoryTrailer(message, tip))
        yield* git.discardPending()
        return { kind: "squash", subject: subjectOf(message) }
      }
    }
  })

/**
 * Decide + perform a step. Nothing writes git until `perform` runs, so the
 * capture gates (`program.ts`'s `enforce*Gate` family) sit between `planStep`
 * and `plan.perform` by construction rather than by statement order.
 */
export type StepPlan =
  | { readonly kind: "refusal"; readonly message: string }
  | { readonly kind: "noop"; readonly state: StateName }
  | {
      readonly kind: "commit" | "squash"
      readonly state: StateName
      /** Inspectable — do not hide it behind `perform`. */
      readonly decision: StepDecision
      readonly perform: Effect.Effect<StepOutcome, Error, RestRequirements>
    }

/**
 * Decide what invoking `invoker` at `rest` does (`PatternMachine.step` over
 * `rest.stepDef`/`rest.changes`/`rest.run.trace`), and — for a `"commit"`/
 * `"squash"` decision — build the `perform` Effect that actually writes it.
 * `opts.cost`/`opts.model` ride along for the `Gtd-Cost:` trailer and the
 * squash template's folded `it.processCost`/`it.processCostByModel`.
 *
 * `perform` itself, in order: the "returned to the initial state retaining
 * nothing" mixed-reset branch (a green re-entry into the initial state that
 * kept nothing useful is rewound like `gtd abandon` rather than committed),
 * else `executeDecision` — against `rest.context` for a commit (which never
 * reads it) or a freshly built `contextAt` for a squash (which renders a
 * DIFFERENT state's template with the step's cost folded in).
 */
export const planStep = (
  rest: Rest,
  invoker: string,
  opts: { readonly cost?: number; readonly model?: string } = {},
): Effect.Effect<StepPlan, Error, RestRequirements> => {
  // Pure decision — no Effect needed to reach it, so this stays a plain
  // function returning `Effect.succeed`/the `perform` closure rather than an
  // `Effect.gen` with nothing to `yield*` at this level.
  const decision = step(rest.stepDef, rest.state, invoker, {
    changes: rest.changes,
    // `StepPayload.processTrace` stays `readonly StateName[]` — the pure
    // engine's retry-entry counting (`applyRetry`) only ever compares state
    // NAMES, never commit hashes, so widening it to carry `TraceEntry`s
    // would just churn every `step` test that builds a payload for data the
    // engine never reads.
    processTrace: rest.run.trace.map((entry) => entry.state),
  })

  if (decision.kind === "refusal") {
    return Effect.succeed({ kind: "refusal", message: formatStepRefusal(invoker, decision) })
  }
  if (decision.kind === "noop") {
    return Effect.succeed({ kind: "noop", state: decision.state })
  }

  const { cost, model } = opts
  const perform: Effect.Effect<StepOutcome, Error, RestRequirements> = Effect.gen(function* () {
    const git = yield* GitService
    if (decision.kind === "commit") {
      const target = parseStateSubject(decision.subject)?.state
      if (
        target === initialStateOf(rest.def) &&
        rest.run.startParentHash !== EMPTY_TREE &&
        (yield* retainsNothing(git, rest.run, rest.changes))
      ) {
        const tip = yield* git.resolveRef("HEAD")
        yield* retainHistory(git, tip, rest.run.startParentHash)
        yield* git.mixedResetTo(rest.run.startParentHash)
        return { kind: "reset", state: target }
      }
      return yield* executeDecision(git, rest.run, decision, rest.context, cost, model)
    }
    const context = yield* contextAt(rest, decision.state, invoker, cost, model)
    return yield* executeDecision(git, rest.run, decision, context, cost, model)
  })

  return Effect.succeed({ kind: decision.kind, state: rest.state, decision, perform })
}

// ── Planning + performing an entry ───────────────────────────────────────────

/** Decide + perform starting a brand-new process. Same refusal/perform vocabulary as `StepPlan`, kept as a separate type: an entry has no `StepDecision`, so folding it into `StepPlan` would force every ordinary `planStep` caller to narrow away a variant that can never occur there. */
export type EntryPlan =
  | { readonly kind: "refusal"; readonly message: string }
  | {
      readonly kind: "entry"
      readonly state: StateName
      readonly subject: string
      readonly perform: Effect.Effect<StepOutcome, Error, RestRequirements>
    }

/**
 * `gtd step <actor> --entry <state>` (or its subcommand-less short form `gtd
 * --entry <state>`): start a brand NEW process at `entry.state` — any
 * declared, non-commit state (see `enterableStates`) — writing an ordinary
 * turn commit (`gtd(<actor>): <state>`) carrying zero or more `Gtd-Var:
 * <name>=<value>` trailers for each `entry.vars` override, plus — when
 * `entry.state` declares a string `reviewBase:` — a `Gtd-Review-Base:`
 * trailer pinning the new process's diff base (rendered from that template
 * against the merged `it.vars`, resolved to a commit, and checked sane).
 * Commits via `commitAllWithPrefix` — capturing whatever the working tree
 * carries at the moment of entry, exactly like an ordinary step capture,
 * rather than demanding a clean tree first.
 *
 * All validation is a REFUSAL, not an Effect failure — checked in order:
 *
 * 1. `rest` must currently be at the workflow's INITIAL state — a process
 *    already underway refuses.
 * 2. `entry.state` must be one of `enterableStates(rest.def)`.
 * 3. Every `entry.vars` name must already be declared by the workflow's own
 *    `vars:` or the top-level `.gtdrc` `vars:`.
 * 4. When `entry.state` declares a string `reviewBase:`, that template must
 *    render to a NON-BLANK commitish that resolves to a commit, is an
 *    ancestor of HEAD, and differs from HEAD.
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
    const perform: Effect.Effect<StepOutcome, Error, RestRequirements> = Effect.gen(function* () {
      const git = yield* GitService
      yield* git.commitAllWithPrefix(message)
      return { kind: "entry", state: entryState, subject }
    })

    return { kind: "entry", state: entryState, subject, perform }
  })
