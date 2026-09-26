import { Effect } from "effect"
import { Narrator } from "./Commentary.js"
import {
  GitService,
  Host,
  Workspace,
  type GitOperations,
  type WorkspaceOps,
} from "./platform/index.js"
import { ConfigDiscovery, ConfigService } from "./workflow/index.js"
import {
  formatSubject,
  memoryScopeOf,
  parseCommitMessage,
  replay,
  treeFromRecord,
  type EpisodeCommit,
  type JudgeVerdict,
  type ReachedStep,
  type ReplayOutcome,
  type TreeView,
} from "./replay/index.js"
import {
  createRenderLedger,
  renderSkillsPreamble,
  type TemplateContext,
  type TemplateEdge,
} from "./PatternTemplates.js"
import { clearTicks, steeringFormatFor } from "./steering/index.js"
import { UNATTRIBUTED_MODEL, type ModelCost } from "./wire/index.js"
import {
  STATE_DIR,
  type ChangeStatus,
  type PendingChange,
  type StateName,
  type StepDef,
  type WorkflowDefinition,
} from "./Workflow.js"
import type { Landing, RepoSnapshot, RevertProbe } from "./step/index.js"

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
  /** The entry the episode runs. */
  readonly entry: string
  /** The commit replay starts reading from, or -1 for the empty tree before history. */
  readonly baseIndex: number
  /** The process's first commit — a manual entry's opening commit, else the one after the base. */
  readonly processStart: number
}

/**
 * Where the episode HEAD belongs to begins, read off subjects alone. Walking
 * back from HEAD: a commit that is not a gtd step commit, or one entering the
 * default entry's first step (a finished episode), bounds the episode from
 * below; a trailer-less `gtd(human): <entry>` commit opens a manual entry's
 * episode and is its first commit.
 */
const locateEpisode = (def: WorkflowDefinition, history: History): EpisodeLocation => {
  for (let i = history.length - 1; i >= 0; i--) {
    const message = parseCommitMessage(history[i]!.message)
    const subject = message.parsed
    if (subject === undefined || !ACTORS.has(subject.actor) || subject.to === def.initial) {
      return { entry: "default", baseIndex: i, processStart: i + 1 }
    }
    const opening =
      message.step === undefined &&
      subject.from === undefined &&
      subject.actor === "human" &&
      def.manual.includes(subject.to)
    if (opening) return { entry: subject.to, baseIndex: i, processStart: i }
  }
  return { entry: "default", baseIndex: -1, processStart: 0 }
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
  readonly entry: string
  /** The process's first commit, or HEAD when none has landed yet. */
  readonly startHash: string
  /** The parent of the process's first commit — the empty tree when that is the root commit. */
  readonly startParentHash: string
  /** The diff base prompts name: `startParentHash`, unless the opening commit fixed a `Gtd-Review-Base`. */
  readonly diffBase: string
  readonly trace: readonly TraceEntry[]
  readonly costEntries: readonly CostEntry[]
  readonly judgeVerdicts: readonly JudgeVerdictEntry[]
  /** The opening commit's `Gtd-Var` trailers. */
  readonly entryVars: Record<string, string>
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

const runOf = (
  def: WorkflowDefinition,
  history: History,
  location: EpisodeLocation,
  closingHash: string | undefined = undefined,
): ProcessRun => {
  const processCommits = history.slice(location.processStart)
  const parsed = processCommits.map((c) => parseCommitMessage(c.message))
  const first = parsed[0]
  const startParentHash =
    location.processStart > 0 ? history[location.processStart - 1]!.hash : EMPTY_TREE
  const head = history[history.length - 1]
  const headParsed = head === undefined ? undefined : parseCommitMessage(head.message)
  const headSubject = headParsed?.parsed
  return {
    entry: location.entry,
    startHash: processCommits[0]?.hash ?? head?.hash ?? EMPTY_TREE,
    startParentHash,
    diffBase: first?.reviewBase ?? startParentHash,
    trace: processCommits.map((c, i) => ({
      state: parsed[i]!.parsed?.to ?? "",
      hash: c.hash,
      actor: parsed[i]!.parsed?.actor ?? "",
    })),
    costEntries: parsed.flatMap((m) =>
      m.cost.map((c) => ({ cost: c.cost, model: c.model ?? UNATTRIBUTED_MODEL })),
    ),
    judgeVerdicts: parsed.flatMap((m) => m.judge),
    entryVars: location.entry === "default" ? {} : { ...(first?.vars ?? {}) },
    headTurn:
      headSubject !== undefined && ACTORS.has(headSubject.actor)
        ? {
            state: headSubject.to,
            actor: headSubject.actor,
            empty: head!.touched.length === 0,
            step: headParsed!.step !== undefined,
          }
        : undefined,
    closingHash,
    episode: {
      base: location.baseIndex >= 0 ? history[location.baseIndex]!.hash : undefined,
      commits: history.slice(location.baseIndex + 1),
    },
  }
}

const historyUpTo = (git: GitOperations, head: string | undefined): Effect.Effect<History, Error> =>
  git.commitHistory(undefined, head)

const computeProcessRun = (
  git: GitOperations,
  def: WorkflowDefinition,
  head?: string,
): Effect.Effect<ProcessRun, Error> =>
  Effect.map(historyUpTo(git, head), (history) => runOf(def, history, locateEpisode(def, history)))

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
    const history = yield* historyUpTo(git, undefined)
    const head = history[history.length - 1]
    const closes = head !== undefined && parseCommitMessage(head.message).parsed?.to === def.initial
    if (!closes) return runOf(def, history, locateEpisode(def, history))
    const before = history.slice(0, -1)
    const location = locateEpisode(def, before)
    return runOf(def, history, { ...location }, head.hash)
  },
)

// ── Trees ───────────────────────────────────────────────────────────────────

const commitTree = (workspace: WorkspaceOps, hash: string): TreeView => {
  let entries: ReadonlyMap<string, string> | undefined
  const list = () => (entries ??= workspace.treeSync(hash))
  const contents = new Map<string, string | undefined>()
  return {
    paths: () => [...list().keys()].sort(),
    read: (path) => {
      if (!list().has(path)) return undefined
      if (!contents.has(path)) contents.set(path, workspace.readCommittedSync(path, hash))
      return contents.get(path)
    },
    id: (path) => list().get(path),
  }
}

/** The tree a landing would commit: the working tree, with any content rewrite the landing script applies first. */
const pendingTree = (
  workspace: WorkspaceOps,
  rewrite: ((path: string, content: string) => string) | undefined,
): TreeView => {
  const paths = workspace.worktreePathsSync()
  return {
    paths: () => paths,
    read: (path) => {
      if (!paths.includes(path)) return undefined
      const content = workspace.readSync(path)
      return content === undefined || rewrite === undefined ? content : rewrite(path, content)
    },
  }
}

// ── Variables ───────────────────────────────────────────────────────────────

const PREFIX = "GTD_"

/**
 * The merged vars, later wins: the workflow's own defaults, `.gtdrc` `vars:`,
 * the opening commit's `Gtd-Var` trailers, then `GTD_<NAME>` for any name an
 * earlier layer declared (an env var never introduces a name).
 */
export const resolveVars = (
  workflowVars: Readonly<Record<string, string>>,
  rcVars: Readonly<Record<string, string>>,
  entryVars: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const merged = { ...workflowVars, ...rcVars, ...entryVars }
  for (const name of Object.keys(merged)) {
    const value = env[PREFIX + name.toUpperCase()]
    if (value !== undefined) merged[name] = value
  }
  return merged
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
  readonly budget: number
  readonly workspace: WorkspaceOps
}

const episodeCommits = (setup: ReplaySetup): readonly EpisodeCommit[] =>
  setup.run.episode.commits.map((c) => ({
    hash: c.hash,
    message: c.message,
    tree: commitTree(setup.workspace, c.hash),
  }))

const replayFor = (
  setup: ReplaySetup,
  pending?: { readonly tree: TreeView; readonly verdicts?: readonly JudgeVerdict[] },
): Promise<ReplayOutcome> => {
  const base = setup.run.episode.base
  return replay({
    workflow: setup.def.flows,
    episode: {
      entry: setup.run.entry,
      base:
        base === undefined
          ? { hash: EMPTY_TREE, tree: treeFromRecord({}) }
          : { hash: base, tree: commitTree(setup.workspace, base) },
      commits: episodeCommits(setup),
    },
    vars: setup.vars,
    refs: { start: setup.run.diffBase, processBase: setup.run.startParentHash },
    budgetBytes: setup.budget,
    ...(pending !== undefined ? { pending } : {}),
  })
}

const replayError = (outcome: ReplayOutcome): Error | undefined => {
  if (outcome.kind === "divergence" || outcome.kind === "failed") return new Error(outcome.message)
  if (outcome.kind === "refused") return new Error(`gtd: ${outcome.message}`)
  if (outcome.kind === "ended") {
    return new Error(
      "gtd: history ends the episode, but HEAD does not enter the default entry's first step — the workflow changed under this process; run `gtd abandon` to start over",
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

const CALLBACK_SCRIPT = `#!/usr/bin/env sh
# This step's body is a callback: gtd runs it, the driver lands what it leaves.
exec gtd exec
`

const withSkillsPreamble = (
  content: string,
  skills: string | undefined,
  vars: Record<string, string>,
  context: TemplateContext,
): string => {
  const template = vars.skillsPreamble
  if (
    skills === undefined ||
    skills.trim() === "" ||
    template === undefined ||
    template.trim() === ""
  ) {
    return content
  }
  return `${renderSkillsPreamble(template, { ...context, skills })}\n\n${content}`
}

const optional = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }

const stepDefOf = (
  step: ReachedStep,
  vars: Record<string, string>,
  context: TemplateContext,
): StepDef => {
  const request = step.request
  const options = request.options
  const common = {
    actor: step.actor,
    ...optional("label", options.label),
    ...optional("file", options.file),
    ...optional("mode", options.mode),
    ...optional("requireProgress", options.requireProgress),
    ...optional("answerGate", options.answerGate),
    ...optional("requireRevert", options.requireRevert),
  }
  if (request.kind === "agent") {
    return {
      ...common,
      kind: "prompt",
      content: withSkillsPreamble(request.prompt, request.options.skills, vars, context),
      ...optional("model", request.options.model),
      ...optional("system", request.options.system),
      ...optional("skills", request.options.skills),
      ...optional("allowEmpty", request.options.allowEmpty),
    }
  }
  if (request.kind === "run") {
    const callback = typeof request.body === "function"
    return {
      ...common,
      kind: "script",
      content: callback ? CALLBACK_SCRIPT : (request.body as string),
      ...(callback ? { callback: true } : {}),
    }
  }
  if (request.kind === "judge") {
    const message = request.options.message ?? DEFAULT_JUDGE_MESSAGE
    return {
      ...common,
      kind: "message",
      content: step.truncated ? `${message}\n\n${TRUNCATION_NOTICE}` : message,
      ...optional("judge", judgeDocument(step)),
    }
  }
  return {
    ...common,
    kind: "message",
    content: request.options.message ?? request.options.label ?? step.name,
    ...optional("acceptClean", request.options.acceptClean),
  }
}

/** Is `name` inside `scope`'s subtree? The root scope `""` holds everything. */
const inScope = (name: string, scope: string): boolean =>
  scope === "" || name === scope || name.startsWith(`${scope}.`)

/**
 * Where the current unbroken run of rests inside `scope`'s subtree began —
 * a dip into a descendant scope does not break it, a sibling or ancestor does.
 */
const scopeRunStart = (trace: readonly ReachedStep[], scope: string): number => {
  let start = -1
  for (let k = 0; k < trace.length; k++) {
    if (!inScope(trace[k]!.memoryScope, scope)) continue
    if (k === 0 || !inScope(trace[k - 1]!.memoryScope, scope)) start = k
  }
  return start
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
  const resumed = trace.slice(Math.max(start, 0), trace.length - 1).some((s) => s.kind === "agent")
  return { key: `${rest.memoryScope || ROOT_MEMORY_SCOPE_NAME}#${token.slice(0, 7)}`, resumed }
}

/** A rest's hints, as the wire carries them. Optional keys are omitted, never `undefined`. */
export interface RestHints {
  readonly model?: string
  readonly label?: string
  readonly file?: string
  readonly judge?: string
  readonly system?: string
  readonly skills?: string
  readonly mode?: string
}

const hintsOf = (def: StepDef): RestHints => ({
  ...optional("model", def.model),
  ...optional("label", def.label),
  ...optional("file", def.file),
  ...optional("judge", def.judge),
  ...optional("system", def.system),
  ...optional("skills", def.skills),
  ...optional("mode", def.mode),
})

const normalizeStatus = (raw: string): ChangeStatus => (raw === "A" ? "A" : raw === "D" ? "D" : "M")

/** The currently rested step and its description — enough for the viewer and the LSP. */
export interface ResolvedRest {
  readonly def: WorkflowDefinition
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
  readonly changes: readonly PendingChange[]
  readonly memory: string | undefined
  readonly memoryResumed: boolean
  readonly hints: RestHints
  readonly context: TemplateContext
  /** The rest's out-edges in the step graph, labelled with their path conditions. */
  readonly edges: readonly TemplateEdge[]
  readonly setup: ReplaySetup
}

const edgesOf = (def: WorkflowDefinition, name: StateName): readonly TemplateEdge[] =>
  def.graph.edges
    .filter((edge) => edge.from === name)
    .map((edge) => ({ pattern: edge.label, target: edge.to === "$end" ? def.initial : edge.to }))

const templateContext = (
  run: ProcessRun,
  step: ReachedStep,
  head: string,
  vars: Record<string, string>,
): TemplateContext => {
  const none = (): never => {
    throw new Error("only it.file and it.vars are available to a mode command")
  }
  return {
    startCommit: run.diffBase,
    currentCommit: head,
    previousCommit: step.enteredAt,
    state: step.name,
    actor: step.actor,
    reviewBase: step.reviewBase,
    processBase: run.startParentHash,
    processCost: run.costEntries.reduce((sum, entry) => sum + entry.cost, 0),
    processCostByModel: costByModel(run.costEntries),
    read: none,
    diff: none,
    sections: none,
    tail: none,
    diffTail: none,
    vars,
    edges: [],
  }
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
    const def = config.workflow
    const run = yield* computeProcessRun(git, def, ref)
    const vars = resolveVars(config.workflowVars, config.rcVars, run.entryVars, host.env)
    const budget = yield* Effect.try({
      try: () => judgeBudgetBytes(vars),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    })
    const setup: ReplaySetup = { def, run, vars, budget, workspace }
    const outcome = yield* Effect.promise(() => replayFor(setup))
    const error = replayError(outcome)
    if (error !== undefined || outcome.kind !== "rest") {
      return yield* Effect.fail(error ?? new Error("gtd: replay found no rest"))
    }
    const step = outcome.rest
    yield* (yield* Narrator).narrate(`rest resolved: ${step.name} (awaits ${step.actor})`)
    const head = ref ?? (yield* git.resolveRef("HEAD"))
    const context = templateContext(run, step, head, vars)
    const stepDef = yield* Effect.try({
      try: () => stepDefOf(step, vars, context),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    })
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
      state: step.name,
      stepDef,
      actor: step.actor,
      step,
      trace: outcome.trace,
      run,
      vars,
      changes,
      memory: memory.key,
      memoryResumed: memory.resumed,
      hints: hintsOf(stepDef),
      context,
      edges: edgesOf(def, step.name),
      setup,
    }
  })

export const currentRest: Effect.Effect<Rest, Error, RestRequirements> = restAt(undefined)

/** The review window's diff base at the rest. */
export const reviewBaseFor = (rest: Rest): string => rest.step.reviewBase

// ── Rendering ───────────────────────────────────────────────────────────────

export interface RenderedRest extends RestHints {
  readonly state: StateName
  readonly actor: string
  readonly kind: StepDef["kind"]
  readonly content: string
  readonly memory?: string
  readonly memoryResumed: boolean
  readonly edges: readonly TemplateEdge[]
  /** Whether a bounded read dropped bytes for this rest's judge evidence. */
  readonly truncated: boolean
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
    edges: rest.edges,
    truncated: rest.step.truncated,
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

/** `idle` means exactly one thing: the default entry's first step, first visit, clean tree. */
/** No process is underway: the default entry's first step, first visit — a dirty tree there is a turn not yet landed, not a process. */
export const noProcessUnderway = (rest: Rest): boolean =>
  rest.run.entry === "default" && rest.state === rest.def.initial && rest.step.id.occurrence === 1

export const restIsIdle = (rest: Rest): boolean =>
  noProcessUnderway(rest) && rest.changes.length === 0

// ── Landing ─────────────────────────────────────────────────────────────────

const isHumanReviewGate = (def: StepDef): boolean => def.actor === "human" && def.mode === "review"

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
    const def = rest.stepDef
    const clean = rest.changes.length === 0
    if (clean && def.kind === "prompt" && def.allowEmpty !== true) {
      return { kind: "attempt", subject: formatSubject(rest.actor, rest.state) }
    }
    if (clean && rest.actor === "human" && def.acceptClean !== true) {
      return { kind: "noop", settled: false }
    }
    const reviewFormat = steeringFormatFor("review")
    const rewrite =
      isHumanReviewGate(def) && def.file !== undefined && reviewFormat !== undefined
        ? (path: string, content: string) =>
            path === def.file ? clearTicks(reviewFormat, content) : content
        : undefined
    const outcome = yield* Effect.promise(() =>
      replayFor(rest.setup, {
        tree: pendingTree(rest.setup.workspace, rewrite),
        ...(verdicts !== undefined ? { verdicts } : {}),
      }),
    )
    if (outcome.kind === "refused") return { kind: "refusal", message: outcome.message }
    if (outcome.kind === "divergence" || outcome.kind === "failed") {
      return yield* Effect.fail(new Error(outcome.message))
    }
    const to = outcome.kind === "rest" ? outcome.rest.name : rest.def.initial
    if (clean && def.kind === "script" && to === rest.state) return { kind: "noop", settled: true }
    return {
      kind: "commit",
      to,
      spec: { actor: rest.actor, from: rest.state, to, step: rest.step.id },
    }
  })

/** Where landing the pending turn would leave the process, or `undefined` when it would land nothing. */
export const previewLanding = (rest: Rest): Effect.Effect<StateName | undefined> =>
  decideLanding(rest, undefined).pipe(
    Effect.map((landing) => (landing.kind === "commit" ? landing.to : undefined)),
    Effect.catchAll(() => Effect.succeed(undefined)),
  )

const isCodePathForRevert = (path: string): boolean =>
  path !== STATE_DIR && !path.startsWith(`${STATE_DIR}/`)

/**
 * The require-revert guard's git facts: which code paths the human's review
 * round touched, and whether any still differs from before that round.
 */
const buildRevertProbe = (
  git: GitOperations,
  reviewBase: string,
  startCommit: string,
): Effect.Effect<RevertProbe, Error> =>
  Effect.gen(function* () {
    if (reviewBase === "" || reviewBase === startCommit) {
      return { checked: false, base: "", residue: [] }
    }
    const base = `${reviewBase}~1`
    const touched = (yield* git.commitHistory(base, reviewBase))[0]?.touched ?? []
    const scoped = touched.filter(isCodePathForRevert)
    if (scoped.length === 0) return { checked: true, base, residue: [] }
    const residue = (yield* git.changedPaths(base))
      .filter((c) => scoped.includes(c.path))
      .map((c) => c.path)
    return { checked: true, base, residue }
  })

/** Every fact the pure landing planner needs, read once: the rest, its steering file, and the landing decision. */
export const snapshotFromRest = (
  rest: Rest,
  verdicts?: readonly JudgeVerdict[],
): Effect.Effect<RepoSnapshot, Error, Workspace | GitService> =>
  Effect.gen(function* () {
    const file = rest.hints.file
    let headFile: string | undefined
    let worktreeFile: string | undefined
    if (file !== undefined) {
      const workspace = yield* Workspace
      headFile = yield* workspace.committed(file)
      worktreeFile = yield* workspace.read(file)
    }
    const landing = yield* decideLanding(rest, verdicts)
    let probe: RevertProbe = { checked: false, base: "", residue: [] }
    if (rest.stepDef.requireRevert === true && landing.kind === "commit") {
      probe = yield* buildRevertProbe(yield* GitService, rest.step.reviewBase, rest.run.diffBase)
    }
    return {
      stepDef: rest.stepDef,
      state: rest.state,
      actor: rest.actor,
      changes: rest.changes,
      file,
      reviewBase: rest.step.reviewBase,
      startCommit: rest.run.diffBase,
      headFile,
      worktreeFile,
      revert: probe,
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
    const summary = config.workflow.flows.summary
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
      vars: resolveVars(config.workflowVars, config.rcVars, run.entryVars, host.env),
    })
  })

/** The rest's body, when it is a `run` callback `gtd exec` executes. */
export const callbackAt = (rest: Rest): ((tools: never) => Promise<void> | void) | undefined =>
  rest.step.request.kind === "run" && typeof rest.step.request.body === "function"
    ? (rest.step.request.body as (tools: never) => Promise<void> | void)
    : undefined
