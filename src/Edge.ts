import { Effect } from "effect"
import { Narrator } from "./Commentary.js"
import {
  GitService,
  Host,
  Workspace,
  type GitOperations,
  type WorkspaceOps,
} from "./platform/index.js"
import {
  ConfigDiscovery,
  ConfigService,
  multilineSetting,
  resolveVars,
  type ConfigOperations,
  type ResolvedWorkflow,
} from "./workflow/index.js"
import {
  formatSubject,
  parseCommitMessage,
  replay,
  treeFromRecord,
  type EpisodeCommit,
  type JudgeVerdict,
  type ReachedStep,
  type ReplayOutcome,
  type TreeView,
} from "./replay/index.js"
import { steeringFormatFor } from "./steering/index.js"
import { UNATTRIBUTED_MODEL, type ModelCost } from "./wire/index.js"
import {
  knownModes,
  type ChangeStatus,
  type PendingChange,
  type StateName,
  type StepDef,
  type WorkflowDefinition,
} from "./Workflow.js"
import type { Landing, RepoSnapshot } from "./step/index.js"

export { UNATTRIBUTED_MODEL }

// git's empty-tree object — the base when a process starts at the repository's
// first commit.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

const ACTORS: ReadonlySet<string> = new Set(["agent", "human", "check", "judge"])

type History = ReadonlyArray<{
  readonly hash: string
  readonly message: string
  readonly touched: ReadonlyArray<string>
}>

// ── Episodes ────────────────────────────────────────────────────────────────

interface EpisodeLocation {
  /** The workflow pinned on the opening commit; `undefined` for the default (and for a legacy `--entry` opening). */
  readonly workflow: string | undefined
  /** The commit replay starts reading from, or -1 for the empty tree before history. */
  readonly baseIndex: number
  /** The process's first commit — a `--workflow` process's opening commit, else the one after the base. */
  readonly processStart: number
}

/**
 * Where the episode HEAD belongs to begins, read off subjects alone. Walking
 * back from HEAD: a bare `gtd(human): <step>` commit with no `Gtd-Step` is what
 * `gtd --workflow` writes — no landing ever produces one — and opens an
 * episode as its first commit (its `Gtd-Workflow` trailer names the workflow;
 * a legacy `--entry` opening has none); a commit that is not a gtd step commit, or one
 * entering the flow's first step (a finished episode), bounds the episode
 * from below.
 */
const locateEpisode = (def: WorkflowDefinition, history: History): EpisodeLocation => {
  for (let i = history.length - 1; i >= 0; i--) {
    const message = parseCommitMessage(history[i]!.message)
    const subject = message.parsed
    const opening =
      subject !== undefined &&
      message.step === undefined &&
      subject.from === undefined &&
      subject.actor === "human"
    if (opening) return { workflow: message.workflow, baseIndex: i, processStart: i }
    if (subject === undefined || !ACTORS.has(subject.actor) || subject.to === def.initial) {
      return { workflow: undefined, baseIndex: i, processStart: i + 1 }
    }
  }
  return { workflow: undefined, baseIndex: -1, processStart: 0 }
}

// ── The current process run ─────────────────────────────────────────────────

export interface CostEntry {
  readonly cost: number
  readonly model: string
}

export interface JudgeVerdictEntry {
  readonly id: string
  readonly answer: string | number | boolean
  readonly p: number
}

/** One process commit: the step it entered (its subject's `<to>`), its hash, and who authored it. */
export interface TraceEntry {
  readonly state: StateName
  readonly hash: string
  readonly actor: string
}

export interface ProcessRun {
  /** The workflow the process's opening commit pinned; `undefined` replays on the default. */
  readonly workflow: string | undefined
  /** The process's first commit, or HEAD when none has landed yet. */
  readonly startHash: string
  /** The parent of the process's first commit — the empty tree when that is the root commit. */
  readonly startParentHash: string
  /** The diff base prompts name: `startParentHash`, unless the opening commit fixed a `Gtd-Review-Base`. */
  readonly diffBase: string
  readonly trace: readonly TraceEntry[]
  readonly costEntries: readonly CostEntry[]
  readonly judgeVerdicts: readonly JudgeVerdictEntry[]
  /** The process settings recorded in the process's first commit (empty for a process started before pinning existed). */
  readonly pinnedVars: Record<string, string>
  /** HEAD's own gtd commit, when it is one — `empty` is whether it changed nothing. */
  readonly headTurn:
    | {
        readonly state: StateName
        readonly actor: string
        readonly empty: boolean
        readonly step: boolean
      }
    | undefined
  /** Set by `summaryRun` when HEAD is itself the commit that closed the process. */
  readonly closingHash: string | undefined
  /** The episode's step commits, oldest → newest, and the commit replay starts from. */
  readonly episode: {
    readonly base: string | undefined
    readonly commits: readonly { readonly hash: string; readonly message: string }[]
  }
}

const headTurnOf = (head: History[number] | undefined): ProcessRun["headTurn"] => {
  if (head === undefined) return undefined
  const message = parseCommitMessage(head.message)
  const subject = message.parsed
  if (subject === undefined || !ACTORS.has(subject.actor)) return undefined
  return {
    state: subject.to,
    actor: subject.actor,
    empty: head.touched.length === 0,
    step: message.step !== undefined,
  }
}

const traceEntryOf = (
  hash: string,
  message: ReturnType<typeof parseCommitMessage>,
): TraceEntry => ({
  state: message.parsed?.to ?? "",
  hash,
  actor: message.parsed?.actor ?? "",
})

const costEntriesOf = (message: ReturnType<typeof parseCommitMessage>): CostEntry[] =>
  message.cost.map((c) => ({ cost: c.cost, model: c.model ?? UNATTRIBUTED_MODEL }))

const hashAt = (history: History, index: number): string | undefined => history[index]?.hash

const runOf = (
  history: History,
  location: EpisodeLocation,
  closingHash: string | undefined = undefined,
): ProcessRun => {
  const processCommits = history.slice(location.processStart)
  const parsed = processCommits.map((c) => parseCommitMessage(c.message))
  const first = parsed[0]
  const startParentHash = hashAt(history, location.processStart - 1) ?? EMPTY_TREE
  const head = history[history.length - 1]
  return {
    workflow: location.workflow,
    startHash: hashAt(history, location.processStart) ?? head?.hash ?? EMPTY_TREE,
    startParentHash,
    diffBase: first?.reviewBase ?? startParentHash,
    trace: processCommits.map((c, i) => traceEntryOf(c.hash, parsed[i]!)),
    costEntries: parsed.flatMap(costEntriesOf),
    judgeVerdicts: parsed.flatMap((m) => m.judge),
    pinnedVars: { ...first?.vars },
    headTurn: headTurnOf(head),
    closingHash,
    episode: {
      base: hashAt(history, location.baseIndex),
      commits: history.slice(location.baseIndex + 1),
    },
  }
}

// The page sizes `findBoundaryBase` doubles through before giving up and
// reading the whole repository — chosen so an ordinary episode (a handful of
// commits) resolves at the very first tier.
const PAGE_TIERS: ReadonlyArray<number> = [32, 128, 512, Infinity]

/**
 * `locateEpisode`'s own boundary test, subject-only: a commit that isn't a
 * gtd step commit, or one landing the flow's initial state, bounds an
 * episode from below — EXCEPT a bare `gtd(human): <x>` subject (no `→`),
 * which is NEVER a boundary here, whatever `<x>` is. That bare shape is
 * `locateEpisode`'s own `opening` branch (a started episode's first commit),
 * which takes priority there over the initial-state check no matter what the
 * workflow's first step is named — including one named after `def.initial`
 * itself, where the two branches would otherwise disagree. A bare human commit can
 * also be a self-loop step landing rather than a real opening (this
 * subject-only pass can't read the `Gtd-Step` trailer that would tell them
 * apart), so ruling it out here can only make `findBoundaryBase` walk a FEW
 * commits further back than strictly needed — never stop short of the
 * boundary `locateEpisode` would find once it has full commit bodies in
 * hand. That asymmetry is the only direction this approximation may err in;
 * it must never call a real boundary "not yet found".
 */
const subjectIsBoundary = (def: WorkflowDefinition, subject: string): boolean => {
  const parsed = parseCommitMessage(subject).parsed
  if (parsed === undefined || !ACTORS.has(parsed.actor)) return true
  if (parsed.actor === "human" && parsed.from === undefined) return false
  return parsed.to === def.initial
}

/** The last page index (walking newest→oldest, same direction as `locateEpisode`) whose subject is a boundary, or `undefined` if none in `page`. */
const boundaryIndexIn = (
  def: WorkflowDefinition,
  page: ReadonlyArray<{ readonly subject: string }>,
): number | undefined => {
  for (let i = page.length - 1; i >= 0; i--) {
    if (subjectIsBoundary(def, page[i]!.subject)) return i
  }
  return undefined
}

/**
 * `findBoundaryBase`'s result: `base` is the hash to pass `commitHistory` so
 * a `git.commitHistory(base, head)` call reads exactly the episode ending at
 * `head`, plus whatever a subject-only read couldn't rule out — never the
 * whole repository. `base` is deliberately the boundary commit's PARENT, not
 * the boundary commit itself: `commitHistory`'s range excludes `base`, and
 * `runOf` needs the boundary commit present in the read history
 * (`episode.base`, `startParentHash`). `base: undefined` means "read from the
 * repository root" — an empty repository, an unresolvable `head`, or an
 * episode that reaches the root commit, none of which cost anything extra
 * since that IS the whole history in those cases.
 *
 * `head` is the CONCRETE hash the literal `head` argument resolved to on this
 * call's first read — `undefined` only when it never resolved (an empty
 * repository, or an unresolvable ref). The caller must hand this hash, not
 * the original `head` argument, to its own `commitHistory` call: resolving a
 * symbolic ref (literal `HEAD`, most callers' default) a second time risks
 * reading a DIFFERENT commit than this function paged through, if something
 * moves HEAD in between — pinning both reads to one resolved hash is what
 * keeps the two-read split from disagreeing with itself.
 */
const findBoundaryBase = (
  git: GitOperations,
  def: WorkflowDefinition,
  head: string | undefined,
): Effect.Effect<{ readonly base: string | undefined; readonly head: string | undefined }, Error> =>
  Effect.gen(function* () {
    let pinnedHead = head
    for (const pageSize of PAGE_TIERS) {
      const page = yield* git.subjectHistory(pageSize, 0, pinnedHead)
      // The newest entry of the very first page IS whatever `head` resolved
      // to — pin it now so every further page in this call, and the caller's
      // own `commitHistory`, all read through this same concrete hash rather
      // than re-resolving a moving literal `HEAD`.
      if (pinnedHead === undefined) pinnedHead = page[page.length - 1]?.hash
      const wholeHistory = !Number.isFinite(pageSize) || page.length < pageSize
      const boundaryIdx = boundaryIndexIn(def, page)
      // No room in this page for the boundary commit's own parent — either
      // no boundary was found at all, or it sits at the page's own oldest
      // slot. Either way, grow the page and look again, unless the page
      // already IS the whole history (nothing earlier to find).
      if (boundaryIdx === undefined || boundaryIdx === 0) {
        if (wholeHistory) return { base: undefined, head: pinnedHead }
        continue
      }
      return { base: page[boundaryIdx - 1]!.hash, head: pinnedHead }
    }
    return { base: undefined, head: pinnedHead }
  })

const historyUpTo = (
  git: GitOperations,
  def: WorkflowDefinition,
  head: string | undefined,
): Effect.Effect<History, Error> =>
  Effect.flatMap(findBoundaryBase(git, def, head), ({ base, head: resolvedHead }) =>
    git.commitHistory(base, resolvedHead),
  )

const computeProcessRun = (
  git: GitOperations,
  def: WorkflowDefinition,
  head?: string,
): Effect.Effect<ProcessRun, Error> =>
  Effect.map(historyUpTo(git, def, head), (history) => runOf(history, locateEpisode(def, history)))

type ConfigRequirements = GitService | ConfigService | ConfigDiscovery | Narrator | Workspace | Host

/** The run alone, never replaying — `gtd abandon` must work even when replay would refuse. */
export const currentRun: Effect.Effect<ProcessRun, Error, ConfigRequirements> = Effect.gen(
  function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    return yield* computeProcessRun(git, config.workflow)
  },
)

/** The process HEAD closes or sits inside — `gtd summary`'s run. */
export const summaryRun: Effect.Effect<ProcessRun, Error, ConfigRequirements> = Effect.gen(
  function* () {
    const git = yield* GitService
    const def = (yield* (yield* ConfigService).load).workflow
    // Cheap: just HEAD's own subject, to decide which of the two reads below
    // this run needs — never the commits before it. Its hash is also this
    // run's ONE resolution of literal HEAD: every further read below is
    // pinned to it, rather than re-resolving a `head` that could move.
    const headEntry = (yield* git.subjectHistory(1, 0))[0]
    if (headEntry === undefined) {
      // No commits at all — `historyUpTo` folds an empty repository to an
      // empty run on its own; there is no hash yet to pin anything to.
      const history = yield* historyUpTo(git, def, undefined)
      return runOf(history, locateEpisode(def, history))
    }
    const closes = parseCommitMessage(headEntry.subject).parsed?.to === def.initial
    if (!closes) {
      const history = yield* historyUpTo(git, def, headEntry.hash)
      return runOf(history, locateEpisode(def, history))
    }
    // HEAD itself closes the process: its own subject would otherwise read as
    // a boundary to `findBoundaryBase` (landing the initial state), stopping
    // the page one commit too soon. Search for the PRIOR episode's boundary
    // from HEAD's parent instead, then read the closing commit separately —
    // `commitHistory` falls back to the whole history when that parent ref
    // doesn't resolve (HEAD is the repository's root commit).
    const parentRef = `${headEntry.hash}~1`
    const before = yield* historyUpTo(git, def, parentRef)
    const location = locateEpisode(def, before)
    let closing = yield* git.commitHistory(parentRef, headEntry.hash)
    if (closing.length === 0) closing = yield* git.commitHistory(undefined, headEntry.hash)
    return runOf([...before, ...closing], { ...location }, headEntry.hash)
  },
)

// ── Trees ───────────────────────────────────────────────────────────────────

const commitTree = (workspace: WorkspaceOps, hash: string): TreeView => {
  let entries: ReadonlyMap<string, string> | undefined
  const list = () => (entries ??= workspace.treeSync(hash))
  // Sorted once per commit, not per call: `Workspace.episodeTrees` has
  // already materialized `list()` before this is ever read, so the sort
  // itself is the only remaining per-call cost `paths()` used to pay.
  let sortedPaths: readonly string[] | undefined
  const contents = new Map<string, string | undefined>()
  return {
    paths: () => (sortedPaths ??= [...list().keys()].sort()),
    read: (path) => {
      if (!list().has(path)) return undefined
      if (!contents.has(path)) contents.set(path, workspace.readCommittedSync(path, hash))
      return contents.get(path)
    },
    id: (path) => list().get(path),
  }
}

/** A content rewrite the landing script applies to one path before it commits. */
interface Rewrite {
  readonly path: string
  readonly apply: (content: string) => string
}

/**
 * The tree a landing would commit: the working tree, with any rewrite the
 * landing script applies first. `entries` is `setup.pendingWorktree()` —
 * already memoized — never a fresh `workspace.worktreeSync()` call; see that
 * field's own comment for why the memo lives there and not on `Workspace`.
 */
const pendingTree = (
  workspace: WorkspaceOps,
  entries: ReadonlyMap<string, string | undefined>,
  rewrite: Rewrite | undefined,
): TreeView => {
  const paths = [...entries.keys()]
  const readWorktree = (path: string): string | undefined => {
    try {
      return workspace.readSync(path)
    } catch {
      // A submodule or another non-file entry has no content to read.
      return undefined
    }
  }
  return {
    paths: () => paths,
    read: (path) => {
      if (!entries.has(path)) return undefined
      const content = readWorktree(path)
      return content === undefined || rewrite?.path !== path ? content : rewrite.apply(content)
    },
    // The rewritten path's blob id is not the working tree's: compare its contents.
    id: (path) => (rewrite?.path === path ? undefined : entries.get(path)),
  }
}

// ── Variables ───────────────────────────────────────────────────────────────

/**
 * The one resolver of both setting kinds. Process settings: the recorded
 * (pinned) value wins per name, anything unrecorded resolves live — the
 * fallback for a process started before pinning existed. Environment settings
 * are always live. `startOverrides` are `--var` values, passed only while a
 * process is being started.
 */
const settingsFor = (
  config: Pick<ConfigOperations, "rcVars" | "rcEnv">,
  workflow: Pick<ResolvedWorkflow, "vars" | "env">,
  pinnedVars: Readonly<Record<string, string>>,
  hostEnv: Readonly<Record<string, string | undefined>>,
  startOverrides: Readonly<Record<string, string>> = {},
): { readonly vars: Record<string, string>; readonly env: Record<string, string> } => ({
  vars: {
    ...resolveVars(workflow.vars, config.rcVars, startOverrides, hostEnv),
    ...pinnedVars,
  },
  env: resolveVars(workflow.env, config.rcEnv, {}, hostEnv),
})

/** The workflow a run replays on: its pinned one, else the default. */
const workflowOf = (
  config: ConfigOperations,
  run: ProcessRun,
): Effect.Effect<ResolvedWorkflow, Error> => {
  if (run.workflow === undefined) return Effect.succeed(config.defaultWorkflow)
  const named = config.workflowNamed(run.workflow)
  if (named !== undefined) return Effect.succeed(named)
  return Effect.fail(
    new Error(
      `gtd: this process runs workflow "${run.workflow}", which gtd.config.ts no longer defines — run \`gtd abandon\` to start over`,
    ),
  )
}

/**
 * `judgeBudgetBytes` is the one var that refuses rather than disabling its
 * mechanism when blanked: without a bound the judge payload is rejected
 * anyway. Absent falls back to a conservative default.
 */
const DEFAULT_JUDGE_BUDGET_BYTES = 32768
const judgeBudgetBytes = (vars: Record<string, string>): number => {
  const raw = vars.judgeBudgetBytes
  if (raw === undefined) return DEFAULT_JUDGE_BUDGET_BYTES
  const n = Number(raw)
  if (raw.trim() === "" || !Number.isInteger(n) || n <= 0) {
    throw new Error(
      `"judgeBudgetBytes" must be a positive integer — got ${JSON.stringify(raw)} (blanking this var disables the payload bound rather than the mechanism it guards, so it is refused rather than defaulted)`,
    )
  }
  return n
}

// ── Replay ──────────────────────────────────────────────────────────────────

interface ReplaySetup {
  readonly def: WorkflowDefinition
  readonly run: ProcessRun
  readonly vars: Record<string, string>
  readonly env: Record<string, string>
  readonly budget: number
  readonly workspace: WorkspaceOps
  /**
   * The episode's base tree and every commit's, built ONCE — after
   * `Workspace.episodeTrees` has already materialized every one of them —
   * and reused by both replays one `gtd` command runs (`restAt`'s own, then
   * `decideLanding`'s). Rebuilding these per `replayFor` call bought nothing
   * once the underlying `treeSync`/`readCommittedSync` reads are themselves
   * cached, but still allocated a fresh `TreeView` (and its own `contents`
   * memo) per replay for no reason.
   */
  readonly base: { readonly hash: string; readonly tree: TreeView }
  readonly episode: readonly EpisodeCommit[]
  /**
   * The working tree `git add -A` would commit, read at most once — memoized
   * HERE, per `ReplaySetup` (built fresh every `restAt` call), rather than on
   * `Workspace` itself: the LSP memoizes one runtime (and its `Workspace`)
   * per root across requests (`runtimeCache`), so a workspace-scoped memo
   * would keep serving the FIRST request's working tree forever. A new
   * `ReplaySetup` per `restAt` call is what makes each request see the
   * working tree as it stands right then, while still reading it only once
   * across that one request's `decideLanding`/`startRefusal` replay.
   */
  readonly pendingWorktree: () => ReadonlyMap<string, string | undefined>
}

const replayFor = (
  setup: ReplaySetup,
  pending?: { readonly tree: TreeView; readonly verdicts?: readonly JudgeVerdict[] },
): Promise<ReplayOutcome> =>
  replay({
    flow: setup.def.flow,
    episode: { base: setup.base, commits: setup.episode },
    vars: setup.vars,
    env: setup.env,
    start: setup.run.diffBase,
    startTree:
      setup.run.diffBase === EMPTY_TREE
        ? treeFromRecord({})
        : commitTree(setup.workspace, setup.run.diffBase),
    budgetBytes: setup.budget,
    skills: setup.def.skills,
    configuredSkills: setup.def.configuredSkills,
    ...(pending !== undefined ? { pending } : {}),
  })

const replayError = (outcome: ReplayOutcome): Error | undefined => {
  if (outcome.kind === "divergence" || outcome.kind === "failed") return new Error(outcome.message)
  if (outcome.kind === "refused") return new Error(`gtd: ${outcome.message}`)
  if (outcome.kind === "ended") {
    return new Error(
      "gtd: history ends the episode, but HEAD does not enter the default workflow's first step — the workflow changed under this process; run `gtd abandon` to start over",
    )
  }
  return undefined
}

// ── The rest ────────────────────────────────────────────────────────────────

const judgeDocument = (step: ReachedStep): string | undefined =>
  step.request.kind === "judge"
    ? JSON.stringify({ state: step.request.evidence, questions: step.request.questions })
    : undefined

/**
 * The fixed sentence appended to a judge gate's message when a bounded read
 * dropped bytes to fit `judgeBudgetBytes` — a constant, so no workflow can
 * reword or drop it.
 */
export const TRUNCATION_NOTICE =
  "Note: some evidence above was truncated to fit the judge's payload budget."

const DEFAULT_JUDGE_MESSAGE =
  "A judgment is pending. Run `gtd judge answer` and pipe a verdict, or land to take the conservative default with no verdict recorded."

const optional = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }

type StepCommon = Pick<StepDef, "actor" | "label" | "file" | "mode">

const commonOf = (step: ReachedStep): StepCommon => {
  const options = step.request.options
  return {
    actor: step.actor,
    ...optional("label", options.label),
    ...optional("file", options.file),
    ...optional("mode", options.mode),
  }
}

type RequestOf<K extends ReachedStep["request"]["kind"]> = Extract<
  ReachedStep["request"],
  { kind: K }
>

const promptDef = (common: StepCommon, request: RequestOf<"agent">): StepDef => ({
  ...common,
  kind: "prompt",
  content: request.prompt,
  ...optional("model", request.options.model),
  ...optional("system", request.options.system),
  ...optional("allowEmpty", request.options.allowEmpty),
  ...optional("skills", request.options.skills),
})

const scriptDef = (common: StepCommon, request: RequestOf<"run">): StepDef => ({
  ...common,
  kind: "script",
  content: request.body,
})

const judgeDef = (common: StepCommon, request: RequestOf<"judge">, step: ReachedStep): StepDef => {
  const message = request.options.message ?? DEFAULT_JUDGE_MESSAGE
  return {
    ...common,
    kind: "message",
    content: step.truncated ? `${message}\n\n${TRUNCATION_NOTICE}` : message,
    ...optional("judge", judgeDocument(step)),
  }
}

const messageDef = (
  common: StepCommon,
  request: RequestOf<"human">,
  step: ReachedStep,
): StepDef => ({
  ...common,
  kind: "message",
  content: request.options.message ?? request.options.label ?? step.name,
  ...optional("acceptClean", request.options.acceptClean),
})

const stepDefOf = (step: ReachedStep): StepDef => {
  const request = step.request
  const common = commonOf(step)
  switch (request.kind) {
    case "agent":
      return promptDef(common, request)
    case "run":
      return scriptDef(common, request)
    case "judge":
      return judgeDef(common, request, step)
    case "human":
      return messageDef(common, request, step)
  }
}

/** Is `name` inside `scope`'s subtree? The root scope `""` holds everything. */
const inScope = (name: string, scope: string): boolean =>
  scope === "" || name === scope || name.startsWith(`${scope}.`)

/**
 * Where the current unbroken run of rests inside `scope`'s subtree began —
 * a dip into a descendant scope does not break it, a sibling or ancestor
 * does, and so does a fresh `scope()` call of the same scope.
 */
const scopeRunStart = (trace: readonly ReachedStep[], scope: string): number => {
  let start = -1
  for (let k = 0; k < trace.length; k++) {
    if (!inScope(trace[k]!.memoryScope, scope)) continue
    const previous = trace[k - 1]
    const unbroken =
      previous !== undefined &&
      inScope(previous.memoryScope, scope) &&
      scopeCallOf(previous, scope) === scopeCallOf(trace[k]!, scope)
    if (!unbroken) start = k
  }
  return start
}

/** The innermost `scope()` call enclosing `scope` at `step` — a new call is a new conversation. */
const scopeCallOf = (step: ReachedStep, scope: string): number | undefined => {
  let call: number | undefined
  for (const entry of step.scopeCalls) if (inScope(scope, entry.prefix)) call = entry.call
  return call
}

// Shown for the root scope, which has no name of its own.
const ROOT_MEMORY_SCOPE_NAME = "root"

/**
 * An agent rest's memory key, `<scope>#<hash7>`: the hash is the commit the
 * current unbroken run into the scope started FROM, so the same run always
 * re-derives the same key. `resumed` is whether an agent turn in that run
 * already landed.
 */
const memoryOf = (
  trace: readonly ReachedStep[],
  run: ProcessRun,
): { readonly key: string | undefined; readonly resumed: boolean } => {
  const rest = trace[trace.length - 1]
  if (rest === undefined || rest.kind !== "agent") return { key: undefined, resumed: false }
  const start = scopeRunStart(trace, rest.memoryScope)
  const token = start <= 0 ? run.startParentHash : trace[start - 1]!.enteredAt
  // A child scope's turns keep the run unbroken but are their own conversation.
  const resumed = trace
    .slice(Math.max(start, 0), trace.length - 1)
    .some((s) => s.kind === "agent" && s.memoryScope === rest.memoryScope)
  return { key: `${rest.memoryScope || ROOT_MEMORY_SCOPE_NAME}#${token.slice(0, 7)}`, resumed }
}

/**
 * A rest's hints, as the wire carries them. Optional keys are omitted, never
 * `undefined`. Not strings-only: `skills` carries an array, already split —
 * the wire does no parsing of its own.
 */
export interface RestHints {
  readonly model?: string
  readonly label?: string
  readonly file?: string
  readonly judge?: string
  readonly system?: string
  readonly mode?: string
  readonly skills?: readonly string[]
}

const hintsOf = (def: StepDef): RestHints => ({
  ...optional("model", def.model),
  ...optional("label", def.label),
  ...optional("file", def.file),
  ...optional("judge", def.judge),
  ...optional("system", def.system),
  ...optional("mode", def.mode),
  ...optional("skills", def.skills),
})

const normalizeStatus = (raw: string): ChangeStatus => (raw === "A" ? "A" : raw === "D" ? "D" : "M")

/** The currently rested step and its description — enough for the viewer and the LSP. */
interface ResolvedRest {
  readonly def: WorkflowDefinition
  /** The workflow the process runs: its pinned name, or the default's display name. */
  readonly workflowName: string
  readonly state: StateName
  readonly stepDef: StepDef
  readonly actor: string
}

/**
 * Where the process rests right now, fully resolved. ONE SNAPSHOT, taken
 * before any mutation.
 */
interface Rest extends ResolvedRest {
  readonly step: ReachedStep
  readonly trace: readonly ReachedStep[]
  readonly run: ProcessRun
  readonly vars: Record<string, string>
  readonly env: Record<string, string>
  readonly changes: readonly PendingChange[]
  readonly memory: string | undefined
  readonly memoryResumed: boolean
  readonly hints: RestHints
  /** Total recorded cost of the process, and its per-model breakdown. */
  readonly cost: { readonly total: number; readonly byModel: readonly ModelCost[] }
  readonly setup: ReplaySetup
}

/** Per-model token totals, highest-cost first (ties broken by model name). */
const costByModel = (entries: readonly CostEntry[]): ModelCost[] => {
  const byModel = new Map<string, number>()
  for (const entry of entries)
    byModel.set(entry.model, (byModel.get(entry.model) ?? 0) + entry.cost)
  return [...byModel.entries()]
    .map(([model, cost]) => ({ model, cost }))
    .sort((a, b) => b.cost - a.cost || a.model.localeCompare(b.model))
}

export type RestRequirements = ConfigRequirements

/** Resolve the rest at `ref`, or at HEAD when `ref` is `undefined`. */
export const restAt = (ref: string | undefined): Effect.Effect<Rest, Error, RestRequirements> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    const workspace = yield* Workspace
    const host = yield* Host
    const run = yield* computeProcessRun(git, config.workflow, ref)
    const resolved = yield* workflowOf(config, run)
    const def = resolved.def
    const { vars, env } = settingsFor(config, resolved, run.pinnedVars, host.env)
    const budget = yield* Effect.try({
      try: () => judgeBudgetBytes(vars),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    })
    // One bulk fetch materializes the base's and every commit's tree — via
    // `Workspace`'s own cache, at most two subprocesses regardless of the
    // episode's length — BEFORE `commitTree` below ever calls `treeSync`/
    // `readCommittedSync` per commit, so those calls always hit the cache
    // this just warmed.
    yield* workspace.episodeTrees(
      run.episode.base,
      run.episode.commits.map((c) => c.hash),
    )
    const base =
      run.episode.base === undefined
        ? { hash: EMPTY_TREE, tree: treeFromRecord({}) }
        : { hash: run.episode.base, tree: commitTree(workspace, run.episode.base) }
    const episode: readonly EpisodeCommit[] = run.episode.commits.map((c) => ({
      hash: c.hash,
      message: c.message,
      tree: commitTree(workspace, c.hash),
    }))
    let pendingMemo: ReadonlyMap<string, string | undefined> | undefined
    const setup: ReplaySetup = {
      def,
      run,
      vars,
      env,
      budget,
      workspace,
      base,
      episode,
      pendingWorktree: () => (pendingMemo ??= workspace.worktreeSync()),
    }
    // No `pending` tree: `restAt` resolves the LANDED process only, never a
    // pending working-tree edit (that's `decideLanding`'s own `replayFor`
    // call, below, deciding what landing right now WOULD do). The LSP's
    // steering-map memo (`src/Lsp.ts`) depends on this staying true — it's
    // what makes HEAD's hash a complete cache key for everything `rest`
    // exposes (`trace`, `state`, `hints.file`); passing a pending tree here
    // would make the memo serve a stale map on every cache hit.
    const outcome = yield* Effect.promise(() => replayFor(setup))
    const error = replayError(outcome)
    if (error !== undefined || outcome.kind !== "rest") {
      return yield* Effect.fail(error ?? new Error("gtd: replay found no rest"))
    }
    const step = outcome.rest
    yield* (yield* Narrator).narrate(`rest resolved: ${step.name} (awaits ${step.actor})`)
    const stepDef = stepDefOf(step)
    if (stepDef.mode !== undefined && def.modes[stepDef.mode] === undefined) {
      return yield* Effect.fail(
        new Error(
          `gtd config: step "${step.name}": mode "${stepDef.mode}" is not a mode this workflow knows (${knownModes(def).join(", ")})`,
        ),
      )
    }
    const changes =
      ref === undefined
        ? (yield* git.changedPaths()).map((e) => ({
            status: normalizeStatus(e.status),
            path: e.path,
          }))
        : []
    const memory = memoryOf(outcome.trace, run)
    return {
      def,
      workflowName: resolved.name,
      state: step.name,
      stepDef,
      actor: step.actor,
      step,
      trace: outcome.trace,
      run,
      vars,
      env,
      changes,
      memory: memory.key,
      memoryResumed: memory.resumed,
      hints: hintsOf(stepDef),
      cost: {
        total: run.costEntries.reduce((sum, entry) => sum + entry.cost, 0),
        byModel: costByModel(run.costEntries),
      },
      setup,
    }
  })

export const currentRest: Effect.Effect<Rest, Error, RestRequirements> = restAt(undefined)

/**
 * Whether `gtd --workflow <name>` can start a process here: the workflow must
 * reach a step from the tree the opening commit would capture. That step is
 * what the opening commit's subject names.
 */
export const startRefusal = (
  rest: Rest,
  resolved: ResolvedWorkflow,
  startVars: Record<string, string>,
): Effect.Effect<
  { readonly firstStep: string } | { readonly refusal: string },
  Error,
  ConfigRequirements
> =>
  Effect.gen(function* () {
    const config = yield* (yield* ConfigService).load
    const host = yield* Host
    const { vars, env } = settingsFor(config, resolved, {}, host.env, startVars)
    const workspace = rest.setup.workspace
    const outcome = yield* Effect.promise(() =>
      replay({
        flow: resolved.def.flow,
        episode: {
          base: { hash: "", tree: pendingTree(workspace, rest.setup.pendingWorktree(), undefined) },
          commits: [],
        },
        vars,
        env,
        start: "",
        budgetBytes: rest.setup.budget,
        skills: resolved.def.skills,
        configuredSkills: resolved.def.configuredSkills,
      }),
    )
    if (outcome.kind === "rest") return { firstStep: outcome.rest.name }
    if (outcome.kind === "refused") return { refusal: outcome.message }
    const why = outcome.kind === "ended" ? "the flow reaches no step" : outcome.message
    return { refusal: `workflow "${resolved.name}" cannot start — ${why}` }
  })

/** The review window's diff base at the rest. */
export const reviewBaseFor = (rest: Rest): string =>
  rest.step.request.options.base ?? rest.run.diffBase

// ── Rendering ───────────────────────────────────────────────────────────────

export interface RenderedRest extends RestHints {
  readonly state: StateName
  readonly actor: string
  readonly kind: StepDef["kind"]
  readonly content: string
  readonly memory?: string
  readonly memoryResumed: boolean
}

export const renderRest = (rest: Rest): Effect.Effect<RenderedRest, Error> =>
  Effect.succeed({
    state: rest.state,
    actor: rest.actor,
    kind: rest.stepDef.kind,
    content: rest.stepDef.content,
    ...rest.hints,
    ...(rest.memory !== undefined ? { memory: rest.memory } : {}),
    memoryResumed: rest.memoryResumed,
  })

/**
 * Derived, restart-proof stall detection: the tree is clean, HEAD is an empty
 * attempt at this very agent rest, and another dispatch would repeat it.
 */
export const stalledAt = (rest: Rest): boolean =>
  rest.changes.length === 0 &&
  rest.stepDef.kind === "prompt" &&
  rest.stepDef.allowEmpty !== true &&
  rest.run.headTurn?.state === rest.state &&
  rest.run.headTurn.actor === rest.actor &&
  !rest.run.headTurn.step &&
  rest.run.headTurn.empty

/** No process is underway: the default workflow's first step, first visit — a dirty tree there is a turn not yet landed, not a process. */
export const noProcessUnderway = (rest: Rest): boolean =>
  rest.run.workflow === undefined &&
  rest.state === rest.def.initial &&
  rest.step.id.occurrence === 1

/** `idle` means exactly one thing: no process underway, clean tree. */
export const restIsIdle = (rest: Rest): boolean =>
  noProcessUnderway(rest) && rest.changes.length === 0

// ── Landing ─────────────────────────────────────────────────────────────────

const isHumanReviewGate = (def: StepDef): boolean => def.actor === "human" && def.mode === "review"

/** The landing a clean tree decides before any replay, if it decides one. */
const cleanLanding = (rest: Rest): Landing | undefined => {
  if (rest.changes.length > 0) return undefined
  const def = rest.stepDef
  if (def.kind === "prompt" && def.allowEmpty !== true) {
    return { kind: "attempt", subject: formatSubject(rest.actor, rest.state) }
  }
  if (rest.actor === "human" && def.acceptClean !== true) return { kind: "noop", settled: false }
  return undefined
}

/** At the human review gate the pending tree lands with every tick cleared, as the landing script will. */
const reviewGateRewrite = (def: StepDef): Rewrite | undefined => {
  const reviewFormat = steeringFormatFor("review")
  if (!isHumanReviewGate(def) || def.file === undefined || reviewFormat === undefined) {
    return undefined
  }
  return { path: def.file, apply: (content) => reviewFormat.clearTicks(content) }
}

const multilineRefusal = (vars: Record<string, string>): Landing | undefined => {
  const multiline = multilineSetting(vars)
  return multiline === undefined
    ? undefined
    : {
        kind: "refusal",
        message: `gtd: process setting "${multiline}" spans several lines — a process setting is pinned in a commit trailer and must be a single line`,
      }
}

const landingTarget = (
  outcome: Awaited<ReturnType<typeof replayFor>>,
  rest: Rest,
): Effect.Effect<StateName | Landing, Error> => {
  if (outcome.kind === "refused")
    return Effect.succeed({ kind: "refusal", message: outcome.message })
  if (outcome.kind === "divergence" || outcome.kind === "failed") {
    return Effect.fail(new Error(outcome.message))
  }
  return Effect.succeed(outcome.kind === "rest" ? outcome.rest.name : rest.def.initial)
}

const landingTo = (rest: Rest, to: StateName): Landing => {
  if (rest.changes.length === 0 && rest.stepDef.kind === "script" && to === rest.state) {
    return { kind: "noop", settled: true }
  }
  // The landing that leaves the flow's first step starts the process: it
  // pins the process settings every later invocation reads back.
  const starts = noProcessUnderway(rest) && to !== rest.def.initial
  const refused = starts ? multilineRefusal(rest.vars) : undefined
  if (refused !== undefined) return refused
  return {
    kind: "commit",
    to,
    spec: {
      actor: rest.actor,
      from: rest.state,
      to,
      step: rest.step.id,
      ...(starts ? { vars: rest.vars } : {}),
    },
  }
}

/**
 * What landing the pending turn at `rest` does — a pure decision from a
 * replay with the working tree as the pending turn. The target step is
 * computed by replaying, never matched.
 */
const decideLanding = (
  rest: Rest,
  verdicts: readonly JudgeVerdict[] | undefined,
): Effect.Effect<Landing, Error> =>
  Effect.gen(function* () {
    const early = cleanLanding(rest)
    if (early !== undefined) return early
    const outcome = yield* Effect.promise(() =>
      replayFor(rest.setup, {
        tree: pendingTree(
          rest.setup.workspace,
          rest.setup.pendingWorktree(),
          reviewGateRewrite(rest.stepDef),
        ),
        ...(verdicts !== undefined ? { verdicts } : {}),
      }),
    )
    const to = yield* landingTarget(outcome, rest)
    if (typeof to !== "string") return to
    return landingTo(rest, to)
  })

/** Where landing the pending turn would leave the process, or `undefined` when it would land nothing. */
export const previewLanding = (rest: Rest): Effect.Effect<StateName | undefined> =>
  decideLanding(rest, undefined).pipe(
    Effect.map((landing) => (landing.kind === "commit" ? landing.to : undefined)),
    Effect.catchAll(() => Effect.succeed(undefined)),
  )

/** Every fact the pure landing planner needs, read once: the rest, its steering file, and the landing decision. */
export const snapshotFromRest = (
  rest: Rest,
  verdicts?: readonly JudgeVerdict[],
): Effect.Effect<RepoSnapshot, Error, Workspace | GitService> =>
  Effect.gen(function* () {
    const landing = yield* decideLanding(rest, verdicts)
    return {
      stepDef: rest.stepDef,
      state: rest.state,
      actor: rest.actor,
      changes: rest.changes,
      file: rest.hints.file,
      landing,
    }
  })

// ── Summary ─────────────────────────────────────────────────────────────────

/** `gtd summary`'s prompt for `run`, or `undefined` when the workflow has none or there is nothing to summarize. */
export const summaryFor = (
  run: ProcessRun,
): Effect.Effect<string | undefined, Error, RestRequirements> =>
  Effect.gen(function* () {
    const config = yield* (yield* ConfigService).load
    const host = yield* Host
    const resolved = yield* workflowOf(config, run)
    const summary = resolved.def.summary
    if (summary === undefined || run.trace.length === 0) return undefined
    const entryCommit = run.trace[0]!.hash
    return summary({
      entryCommit,
      processBase: run.startParentHash,
      processTip: run.trace[run.trace.length - 1]!.hash,
      humanCommits: run.trace
        .filter((entry) => entry.actor === "human" && entry.hash !== entryCommit)
        .map((entry) => ({ hash: entry.hash, state: entry.state })),
      processCost: run.costEntries.reduce((sum, entry) => sum + entry.cost, 0),
      processCostByModel: costByModel(run.costEntries),
      ...settingsFor(config, resolved, run.pinnedVars, host.env),
    })
  })
