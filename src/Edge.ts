import { Effect } from "effect"
import { GitService, type GitOperations } from "./Git.js"
import { ConfigService } from "./Config.js"
import {
  contentKindOf,
  initialStateOf,
  parseStateSubject,
  resolveState,
  type ChangeStatus,
  type ContentKind,
  type PendingChange,
  type StateDef,
  type StateName,
  type StepDecision,
  type WorkflowDefinition,
} from "./PatternMachine.js"
import { renderStateTemplate, type TemplateContext } from "./PatternTemplates.js"

/**
 * The v3 Effect edge (see `docs/design/pattern-machine-plan.md`, "Phase 3:
 * default workflow re-authoring + CLI"). Everything git/filesystem-shaped
 * lives here — `program.ts` calls this module and never touches `GitService`
 * or `PatternMachine`'s pure functions directly.
 *
 * Compared to v2's `Events.ts`/`Machine.ts` split, v3's edge is a single
 * gather → decide → perform hop with NO fixpoint loop: the pattern machine's
 * `on` edges are direct one-hop transitions (no routing/bookkeeping chain to
 * drive to a fixpoint), so one `gtd step <actor>` invocation performs AT MOST
 * one commit (or one squash). A caller that wants several transitions issues
 * several invocations.
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
export const withCostTrailer = (
  subject: string,
  cost: number | undefined,
  model: string | undefined,
): string =>
  cost === undefined
    ? subject
    : `${subject}\n\n${COST_TRAILER_PREFIX}${cost}${model !== undefined ? ` ${model}` : ""}`

/** Every `Gtd-Cost:` entry found across the given commit messages (each entry's model defaults to `UNATTRIBUTED_MODEL`). */
export const parseCostTrailers = (messages: readonly string[]): CostEntry[] => {
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

/** The total token cost across the given entries (`0` when none). */
export const totalCostOf = (entries: readonly CostEntry[]): number =>
  entries.reduce((sum, entry) => sum + entry.cost, 0)

/** Per-model token totals, highest-cost first (ties broken by model name for a stable order). */
export const costByModel = (entries: readonly CostEntry[]): ModelCost[] => {
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

/** The currently-rested state, its definition, and its declared actor (never a commit state — see `resolveState`'s docs). */
export interface ResolvedRest {
  readonly def: WorkflowDefinition
  readonly state: StateName
  readonly stateDef: StateDef
  readonly actor: string
}

/** Resolve HEAD's subject against the active workflow definition (the bundled default, or a compiled `.gtdrc` `workflow:` key). */
export const resolveRest = (): Effect.Effect<ResolvedRest, Error, GitService | ConfigService> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* ConfigService
    const def = config.workflow
    const hasCommits = yield* git.hasCommits()
    const headSubject = hasCommits ? yield* git.lastCommitSubject() : ""
    const state = resolveState(def, headSubject)
    const stateDef = def.states[state]!
    // `resolveState` never rests at a commit state (it excludes them
    // explicitly) — this is a defensive check against a programmer error,
    // not a real runtime path.
    if (stateDef.actor === undefined) {
      return yield* Effect.fail(
        new Error(`gtd: resolved at commit state "${state}" — a process never rests there`),
      )
    }
    return { def, state, stateDef, actor: stateDef.actor }
  })

// ── Pending changes ──────────────────────────────────────────────────────────

/** The working tree's pending changes vs HEAD, as the pattern grammar's `{status, path}[]`. */
export const pendingChanges = (
  git: GitOperations,
): Effect.Effect<readonly PendingChange[], Error> =>
  git
    .changedPaths()
    .pipe(
      Effect.map((entries) =>
        entries.map((e) => ({ status: normalizeStatus(e.status), path: e.path })),
      ),
    )

// ── The current process run ──────────────────────────────────────────────────

/** The contiguous run of `gtd(actor): state` commits ending at HEAD. */
export interface ProcessRun {
  /** The run's first commit's hash, or HEAD's own hash when the run is empty (no turn has landed yet this process). */
  readonly startHash: string
  /** The parent of the run's first commit — `EMPTY_TREE` when the run covers the whole history. The squash reset target. */
  readonly startParentHash: string
  /** State names entered so far this process, oldest→newest (empty when no turn has landed yet). */
  readonly trace: readonly StateName[]
  /** Every `Gtd-Cost:` entry recorded on the process's turn commits — summed into `it.processCost` and grouped into `it.processCostByModel` (empty when none were recorded). */
  readonly costEntries: readonly CostEntry[]
}

/**
 * Walk first-parent history backward from HEAD while each commit's subject
 * parses as `gtd(actor): state` (a v3 workflow commit) AND that state isn't
 * the workflow's initial state; the walk stops — EXCLUDING that boundary
 * commit itself, which belongs to the finished cycle — at whichever comes
 * first:
 *
 * - a non-matching commit (a foreign boundary: legacy/pre-v3 history, the
 *   repo's own root commit), or
 * - a workflow commit that ENTERS the initial state (e.g. the bundled
 *   default's `gtd(human): idle`) — with no `commit:`/squash state in the
 *   default workflow anymore, this is the process boundary between one
 *   approved cycle and the next: without it, consecutive cycles' commits
 *   would fuse into one process and `retry` counts would pool across cycles.
 *
 * HEAD itself being such an initial-entering commit yields an EMPTY run
 * (`trace: []`, `startHash`/`startParentHash` both HEAD's own hash) — the
 * same shape a fresh rest at a squashed boundary has always had.
 */
export const computeProcessRun = (
  git: GitOperations,
  def: WorkflowDefinition,
): Effect.Effect<ProcessRun, Error> =>
  Effect.gen(function* () {
    const hasCommits = yield* git.hasCommits()
    if (!hasCommits)
      return { startHash: "", startParentHash: EMPTY_TREE, trace: [], costEntries: [] }

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
    const trace = processCommits.map((h) => parseStateSubject(subjectOf(h.message))!.state)
    const costEntries = parseCostTrailers(processCommits.map((h) => h.message))
    const startParentHash = i >= 0 ? history[i]!.hash : EMPTY_TREE
    const startHash =
      startIdx < history.length ? history[startIdx]!.hash : history[history.length - 1]!.hash
    return { startHash, startParentHash, trace, costEntries }
  })

// ── Variables (`it.vars`) ────────────────────────────────────────────────────

/** The `GTD_VAR_`-prefix stripped, exact-case, from every matching entry — the highest-precedence `it.vars` layer. A `value === undefined` entry (a name declared-but-unset in the environment) is skipped, never coerced to the string `"undefined"`. */
const envVarsFrom = (env: Readonly<Record<string, string | undefined>>): Record<string, string> => {
  const PREFIX = "GTD_VAR_"
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || !key.startsWith(PREFIX)) continue
    out[key.slice(PREFIX.length)] = value
  }
  return out
}

/**
 * Assemble the merged `it.vars` map every template sees, from three layers
 * (later wins): the active workflow's own declared `vars:` defaults
 * (`ConfigOperations.workflowVars`), the top-level `.gtdrc` `vars:` key
 * (`ConfigOperations.rcVars`), and every `GTD_VAR_`-prefixed environment
 * variable (exact-case name match after the prefix) — the only layer that
 * may introduce a name neither config layer declared. Pure: `env` is
 * whatever the caller's `EnvVars` service handed it, never `process.env`
 * read directly here.
 */
export const resolveVars = (
  workflowVars: Record<string, string>,
  rcVars: Record<string, string>,
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> => ({ ...workflowVars, ...rcVars, ...envVarsFrom(env) })

// ── Template context ─────────────────────────────────────────────────────────

/**
 * Build the `PatternTemplates.TemplateContext` for rendering `state`'s content
 * at the resolved rest. `vars` is the already-merged three-layer map (see
 * `resolveVars`). `currentCost`/`currentModel` are the in-flight step's own
 * `--cost`/`--model` (folded into the process's committed cost entries so a
 * `commit:` squash template sees the whole-process total AND per-model
 * breakdown including the squashing step) — `0`/absent for the pure emitters
 * (`gtd next`/`gtd status`), where no step is being performed.
 */
export const buildTemplateContext = (
  git: GitOperations,
  read: (path: string) => string,
  state: StateName,
  actor: string,
  run: ProcessRun,
  vars: Record<string, string>,
  currentCost = 0,
  currentModel?: string,
): Effect.Effect<TemplateContext, Error> =>
  Effect.gen(function* () {
    const hasCommits = yield* git.hasCommits()
    const currentCommit = hasCommits ? yield* git.resolveRef("HEAD") : ""
    const previousCommit = hasCommits
      ? yield* git
          .resolveRef("HEAD~1")
          .pipe(Effect.catchAll(() => Effect.succeed(run.startParentHash)))
      : ""
    const committedDiff = yield* git
      .diffRef(run.startParentHash)
      .pipe(Effect.catchAll(() => Effect.succeed("")))
    const pendingDiff = yield* git.diffHead().pipe(Effect.catchAll(() => Effect.succeed("")))
    const processDiff = [committedDiff, pendingDiff].filter((d) => d.trim().length > 0).join("\n\n")
    const lastDiff =
      run.trace.length > 0
        ? yield* git.commitDiff(currentCommit).pipe(Effect.catchAll(() => Effect.succeed("")))
        : ""
    // Fold the in-flight step's own cost into the committed entries so a squash
    // template (rendered against the pending tree) counts the squashing step too.
    const stepEntry =
      currentCost > 0 || currentModel !== undefined
        ? [{ cost: currentCost, model: currentModel ?? UNATTRIBUTED_MODEL }]
        : []
    const allCostEntries = [...run.costEntries, ...stepEntry]
    return {
      startCommit: run.startHash,
      currentCommit,
      previousCommit,
      state,
      actor,
      processDiff,
      lastDiff,
      processCost: totalCostOf(allCostEntries),
      processCostByModel: costByModel(allCostEntries),
      read,
      vars,
    }
  })

// ── Rendering the resolved rest's content ────────────────────────────────────

export interface RenderedRest {
  readonly state: StateName
  readonly actor: string
  readonly kind: ContentKind
  readonly content: string
  /** The resolved rest's `model` hint, verbatim — omitted (not `undefined`-valued) when the state declares none, so `--json` callers can `key in obj`/`??`-check its absence. */
  readonly model?: string
  /** The resolved rest's `file:` steering file, RENDERED — omitted (not `undefined`-valued) when the state declares none, same discipline as `model`. */
  readonly file?: string
  /** The resolved rest's `mode:` hint, verbatim (a closed literal — never Eta-rendered) — omitted when the state declares none. */
  readonly mode?: StateDef["mode"]
}

/**
 * Render a state's declared `model:` hint (if any) through the SAME template
 * context as its content — a plain string with no Eta tags (e.g. `"smart"`)
 * passes through unchanged, but `model: "<%= it.vars.reviewModel %>"` now
 * resolves against the merged `it.vars`. A render failure behaves exactly
 * like a content render failure at the same call site (`gtd next`/`gtd
 * status` error out, nothing committed) — see `renderRest`, and
 * `program.ts`'s status command, which calls this directly (it never renders
 * a state's content, only its `model`).
 */
export const renderModel = (
  stateDef: StateDef,
  context: TemplateContext,
): Effect.Effect<string | undefined, Error> =>
  Effect.try({
    try: () =>
      stateDef.model !== undefined ? renderStateTemplate(stateDef.model, context) : undefined,
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

/**
 * Render a state's declared `file:` steering-file template (if any) through
 * the SAME template context as its content/`model` — see `renderModel`'s doc
 * comment; the render-failure semantics are identical (propagates as a
 * thrown/rejected error, same call site as `gtd next`/`gtd status`).
 */
export const renderFile = (
  stateDef: StateDef,
  context: TemplateContext,
): Effect.Effect<string | undefined, Error> =>
  Effect.try({
    try: () =>
      stateDef.file !== undefined ? renderStateTemplate(stateDef.file, context) : undefined,
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

/** Render the resolved rest's declared content (script/prompt/message — never `commit`, since `resolveRest` never rests at a commit state) plus its `model:`/`file:` hints, if declared (see `renderModel`/`renderFile`). `mode:` is a closed literal, never Eta-rendered — passed through verbatim. */
export const renderRest = (
  rest: ResolvedRest,
  context: TemplateContext,
): Effect.Effect<RenderedRest, Error> =>
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
      try: () => renderStateTemplate(template, context),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    })
    const model = yield* renderModel(rest.stateDef, context)
    const file = yield* renderFile(rest.stateDef, context)
    return {
      state: rest.state,
      actor: rest.actor,
      kind,
      content,
      ...(model !== undefined ? { model } : {}),
      ...(file !== undefined ? { file } : {}),
      ...(rest.stateDef.mode !== undefined ? { mode: rest.stateDef.mode } : {}),
    }
  })

// ── Executing a step decision ────────────────────────────────────────────────

/** A step's outcome, for the CLI to report. */
export type StepOutcome =
  | { readonly kind: "commit"; readonly subject: string }
  | { readonly kind: "squash"; readonly subject: string }
  | { readonly kind: "noop"; readonly state: StateName }

/** The two `StepDecision` kinds that actually perform IO — the caller (program.ts) handles `"refusal"` itself (different exit codes/messages per reason) before ever reaching this function, and a `"noop"` short-circuits here with no IO. */
export type ExecutableDecision = Extract<StepDecision, { kind: "commit" | "squash" | "noop" }>

/**
 * Execute a `PatternMachine.step` decision: a `"commit"` decision stages and
 * commits everything pending under the decided subject, with an optional
 * `Gtd-Cost: <cost>[ <model>]` trailer (the invocation's `--cost`/`--model`,
 * persisted in the git log); a `"squash"` decision renders the commit-state
 * template against the PENDING tree — a render failure REFUSES the step,
 * touching nothing — then soft-resets to the process's start parent, writes
 * ONE commit with the rendered message (via `commitAsIs`, so the
 * still-uncommitted template file is excluded), and discards everything left
 * pending (the template file included). A squash records no trailer of its own
 * — the whole-process total and per-model breakdown reach the message through
 * `it.processCost`/`it.processCostByModel` in the rendered template. A
 * `"noop"` performs no IO.
 */
export const executeDecision = (
  git: GitOperations,
  run: ProcessRun,
  decision: ExecutableDecision,
  context: TemplateContext,
  cost?: number,
  model?: string,
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
        yield* git.softResetTo(run.startParentHash)
        yield* git.commitAsIs(message)
        yield* git.discardPending()
        return { kind: "squash", subject: subjectOf(message) }
      }
      case "noop":
        return { kind: "noop", state: decision.state }
    }
  })
