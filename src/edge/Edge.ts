import { Effect, Option } from "effect"
import {
  Narrator,
  GitService,
  Host,
  Workspace,
  type AuthorIdent,
  type GitOperations,
  type HostOps,
  type WorkspaceOps,
} from "../platform/index.js"
import {
  ConfigDiscovery,
  ConfigService,
  changedConfigFiles,
  contentHash,
  multilineSetting,
  resolveVars,
  resolveStartVars,
  StartFlags,
  resolveScopeAccess,
  resolveScopeSkills,
  type ConfigFingerprint,
  type ConfigOperations,
  type ResolvedWorkflow,
  knownModes,
  type ChangeStatus,
  type PendingChange,
  type StateName,
  type StepDef,
  type WorkflowDefinition,
} from "../workflow/index.js"
import {
  formatFault,
  formatStepId,
  formatSubject,
  isRecordableApproval,
  parseCommitMessage,
  replay,
  scopeRunStart,
  treeFromRecord,
  type EpisodeCommit,
  type JudgeVerdict,
  type ReachedStep,
  type ReplayOutcome,
  type TreeView,
} from "../replay/index.js"
import type { Mark, ScopeAccess, SummaryContext } from "../flows/index.js"
import { steeringFormatFor } from "../steering/index.js"
import {
  judgeJson,
  UNATTRIBUTED_MODEL,
  type ApprovalEntry,
  type ModelCost,
  type StepAccess,
} from "../wire/index.js"

import { GTD_VERSION } from "../install/index.js"
import { keptRef, processHistoryRef } from "../platform/index.js"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { accessRefusal, type Landing, type RepoSnapshot } from "../step/index.js"

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
  /** The workflow pinned on the opening commit; `undefined` for the default. */
  readonly workflow: string | undefined
  /** An opening commit with no `Gtd-Workflow` trailer: written by the removed `gtd --entry`. */
  readonly legacyOpening: boolean
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
    if (opening) {
      return {
        workflow: message.workflow,
        legacyOpening: message.workflow === undefined,
        baseIndex: i,
        processStart: i,
      }
    }
    if (subject === undefined || !ACTORS.has(subject.actor) || subject.to === def.initial) {
      return { workflow: undefined, legacyOpening: false, baseIndex: i, processStart: i + 1 }
    }
  }
  return { workflow: undefined, legacyOpening: false, baseIndex: -1, processStart: 0 }
}

// ── The current process run ─────────────────────────────────────────────────

export interface CostEntry {
  readonly cost: number
  readonly model: string
  /** The process commit whose `Gtd-Cost` trailer recorded it. */
  readonly hash: string
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
  /** Opened by the removed `gtd --entry`: no workflow to replay, only `gtd abandon` applies. */
  readonly legacyOpening: boolean
  /** The process's first commit, or HEAD when none has landed yet. */
  readonly startHash: string
  /** The parent of the process's first commit — the empty tree when that is the root commit. */
  readonly startParentHash: string
  /** The diff base prompts name: `startParentHash`, unless the opening commit fixed a `Gtd-Review-Base`. */
  readonly diffBase: string
  readonly trace: readonly TraceEntry[]
  readonly costEntries: readonly CostEntry[]
  readonly judgeVerdicts: readonly JudgeVerdictEntry[]
  /** Every process commit's `Gtd-Mark`s, oldest first. */
  readonly marks: readonly Mark[]
  /** Oldest first. */
  readonly approvals: readonly ApprovalEntry[]
  /** The process settings recorded in the process's first commit (empty for a process started before pinning existed). */
  readonly pinnedVars: Record<string, string>
  /** Absent for a process started before recording existed. */
  readonly pinnedConfig: { readonly commit: string; readonly files: ConfigFingerprint } | undefined
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

const costEntriesOf = (hash: string, message: ReturnType<typeof parseCommitMessage>): CostEntry[] =>
  message.cost.map((c) => ({ cost: c.cost, model: c.model ?? UNATTRIBUTED_MODEL, hash }))

const hashAt = (history: History, index: number): string | undefined => history[index]?.hash

// The base is checked too: a foreign subject codec can hide a commit from the
// episode, leaving it as the base. Only a `gtd`-prefixed base counts, so a
// commit gtd never wrote cannot block it by quoting the trailer.
const historyFormatFault = (history: History, location: EpisodeLocation): string | undefined =>
  formatFault(
    history
      .slice(location.baseIndex + 1)
      .concat(
        history[location.baseIndex]?.message.startsWith("gtd")
          ? [history[location.baseIndex]!]
          : [],
      )
      .map((c) => ({ hash: c.hash, format: parseCommitMessage(c.message).format })),
  )

/** Fails on a history in a format this gtd does not read, before anything acts on it. */
const runOf = (
  history: History,
  location: EpisodeLocation,
  closingHash: string | undefined = undefined,
): Effect.Effect<ProcessRun, Error> => {
  const fault = historyFormatFault(history, location)
  return fault === undefined
    ? Effect.succeed(buildRun(history, location, closingHash))
    : Effect.fail(new Error(fault))
}

// The newest recording, not the first process commit's: the episode is
// located by the CURRENT config's first step, so a config that renamed it can
// move the boundary onto the start commit itself, or behind it.
const pinnedConfigOf = (history: History): ProcessRun["pinnedConfig"] => {
  for (let i = history.length - 1; i >= 0; i--) {
    const files = parseCommitMessage(history[i]!.message).config
    if (Object.keys(files).length > 0) return { commit: history[i]!.hash, files }
  }
  return undefined
}

const approvalEntryOf = (
  hash: string,
  message: ReturnType<typeof parseCommitMessage>,
): readonly ApprovalEntry[] =>
  message.approved === undefined
    ? []
    : [
        {
          step: formatStepId(message.approved.step),
          name: message.approved.name,
          email: message.approved.email,
          commit: hash,
        },
      ]

const buildRun = (
  history: History,
  location: EpisodeLocation,
  closingHash: string | undefined,
): ProcessRun => {
  const processCommits = history.slice(location.processStart)
  const parsed = processCommits.map((c) => parseCommitMessage(c.message))
  const first = parsed[0]
  const startParentHash = hashAt(history, location.processStart - 1) ?? EMPTY_TREE
  const head = history[history.length - 1]
  return {
    workflow: location.workflow,
    legacyOpening: location.legacyOpening,
    startHash: hashAt(history, location.processStart) ?? head?.hash ?? EMPTY_TREE,
    startParentHash,
    diffBase: first?.reviewBase ?? startParentHash,
    trace: processCommits.map((c, i) => traceEntryOf(c.hash, parsed[i]!)),
    costEntries: parsed.flatMap((m, i) => costEntriesOf(processCommits[i]!.hash, m)),
    judgeVerdicts: parsed.flatMap((m) => m.judge),
    marks: parsed.flatMap((m) => m.marks),
    approvals: processCommits.flatMap((c, i) => approvalEntryOf(c.hash, parsed[i]!)),
    pinnedVars: { ...first?.vars },
    pinnedConfig: pinnedConfigOf(history.slice(Math.max(location.baseIndex, 0))),
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
  Effect.flatMap(historyUpTo(git, def, head), (history) =>
    runOf(history, locateEpisode(def, history)),
  )

// A file matching its copy in the recording commit is unchanged: the hashes
// are taken before the commit's own hooks run, and a hook may reformat it.
const changedSinceStart = (
  pinned: ProcessRun["pinnedConfig"],
  current: ConfigFingerprint,
  workspace: WorkspaceOps,
): readonly string[] => {
  if (pinned === undefined) return []
  return changedConfigFiles(pinned.files, current).filter((path) => {
    const committed = workspace.readCommittedSync(path, pinned.commit)
    return (
      current[path] === undefined ||
      committed === undefined ||
      contentHash(committed) !== current[path]
    )
  })
}

const warnConfigChanges = (
  run: ProcessRun,
  current: ConfigFingerprint,
  workspace: WorkspaceOps,
): Effect.Effect<void, never, Narrator> =>
  Effect.gen(function* () {
    const changed = changedSinceStart(run.pinnedConfig, current, workspace)
    if (changed.length === 0) return
    yield* (yield* Narrator).warn(
      `gtd: warning: the config changed since this process started (${changed.join(", ")}) — the rest of the process replays under the changed config`,
    )
  })

type ConfigRequirements = GitService | ConfigService | ConfigDiscovery | Narrator | Workspace | Host

/** The run alone, never replaying — `gtd abandon` must work even when replay would refuse, short of a history it cannot read. */
export const currentRun: Effect.Effect<ProcessRun, Error, ConfigRequirements> = Effect.gen(
  function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    return yield* computeProcessRun(git, config.workflow)
  },
)

// `tip` is resolved to a hash once: every read below is pinned to it, so a
// moving HEAD cannot split one run across two commits.
const runAtTip = (
  git: GitOperations,
  def: WorkflowDefinition,
  tip: { readonly hash: string; readonly subject: string } | undefined,
): Effect.Effect<ProcessRun, Error> =>
  Effect.gen(function* () {
    if (tip === undefined) {
      // No commits at all — `historyUpTo` folds an empty repository to an
      // empty run on its own; there is no hash yet to pin anything to.
      const history = yield* historyUpTo(git, def, undefined)
      return yield* runOf(history, locateEpisode(def, history))
    }
    const closes = parseCommitMessage(tip.subject).parsed?.to === def.initial
    if (!closes) {
      const history = yield* historyUpTo(git, def, tip.hash)
      return yield* runOf(history, locateEpisode(def, history))
    }
    // The tip itself closes the process: its own subject would otherwise read
    // as a boundary to `findBoundaryBase` (landing the initial state), stopping
    // the page one commit too soon. Search for the PRIOR episode's boundary
    // from its parent instead, then read the closing commit separately —
    // `commitHistory` falls back to the whole history when that parent ref
    // doesn't resolve (the tip is the repository's root commit).
    const parentRef = `${tip.hash}~1`
    const before = yield* historyUpTo(git, def, parentRef)
    const location = locateEpisode(def, before)
    let closing = yield* git.commitHistory(parentRef, tip.hash)
    if (closing.length === 0) closing = yield* git.commitHistory(undefined, tip.hash)
    return yield* runOf([...before, ...closing], { ...location }, tip.hash)
  })

const runAtHead = (git: GitOperations, def: WorkflowDefinition) =>
  Effect.gen(function* () {
    // Cheap: just HEAD's own subject, never the commits before it.
    return yield* runAtTip(git, def, (yield* git.subjectHistory(1, 0))[0])
  })

/** The process HEAD closes or sits inside — `gtd summary`'s run. */
export const summaryRun: Effect.Effect<ProcessRun, Error, ConfigRequirements> = Effect.gen(
  function* () {
    const git = yield* GitService
    const def = (yield* (yield* ConfigService).load).workflow
    return yield* runAtHead(git, def)
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
  workflow: Pick<ResolvedWorkflow, "vars" | "env">,
  pinnedVars: Readonly<Record<string, string>>,
  hostEnv: Readonly<Record<string, string | undefined>>,
  startOverrides: Readonly<Record<string, string>> = {},
  /** The live flags a STARTING process pins; a running one passes `{}` and replays its pins. */
  startFlags: Readonly<Record<string, string>>,
): { readonly vars: Record<string, string>; readonly env: Record<string, string> } => ({
  vars: {
    ...resolveStartVars(workflow.vars, startFlags, startOverrides, hostEnv),
    ...pinnedVars,
  },
  env: resolveVars(workflow.env, {}, hostEnv),
})

/** The workflow a run replays on: its pinned one, else the default. */
const workflowOf = (
  config: ConfigOperations,
  run: ProcessRun,
): Effect.Effect<ResolvedWorkflow, Error> => {
  if (run.legacyOpening) {
    return Effect.fail(
      new Error(
        "gtd: this process was opened by `gtd --entry`, which no longer exists — run `gtd abandon` to start over",
      ),
    )
  }
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
  readonly skills: Record<string, readonly string[]>
  readonly access: Record<string, ScopeAccess>
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
   * `Workspace` itself: a long-lived runtime reusing one `Workspace` across
   * requests would otherwise keep serving the FIRST request's working tree
   * forever. A new
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
    skills: setup.skills,
    configuredSkills: setup.def.configuredSkills,
    access: setup.access,
    configuredAccess: setup.def.configuredAccess,
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
    ? judgeJson(step.request.evidence, step.request.questions)
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

const promptDef = (
  common: StepCommon,
  request: RequestOf<"agent">,
  skills: readonly string[] | undefined,
  access: StepAccess | undefined,
): StepDef => ({
  ...common,
  kind: "prompt",
  content: request.prompt,
  ...optional("model", request.options.model),
  ...optional("system", request.options.system),
  ...optional("allowEmpty", request.options.allowEmpty),
  ...optional("keep", request.options.keep),
  ...optional("skills", skills),
  ...optional("access", access),
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
  ...optional("acceptClean", request.options.approve === true || request.options.acceptClean),
  ...optional("approve", request.options.approve),
})

const stepDefOf = (step: ReachedStep): StepDef => {
  const request = step.request
  const common = commonOf(step)
  switch (request.kind) {
    case "agent":
      return promptDef(common, request, step.skills, step.access)
    case "run":
      return scriptDef(common, request)
    case "judge":
      return judgeDef(common, request, step)
    case "human":
      return messageDef(common, request, step)
  }
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
  readonly access?: StepAccess
}

const hintsOf = (def: StepDef): RestHints => ({
  ...optional("model", def.model),
  ...optional("label", def.label),
  ...optional("file", def.file),
  ...optional("judge", def.judge),
  ...optional("system", def.system),
  ...optional("mode", def.mode),
  ...optional("skills", def.skills),
  ...optional("access", def.access),
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
  /** What a landing that starts the process records. */
  readonly config: ConfigFingerprint
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

const costTotals = (entries: readonly CostEntry[]): Rest["cost"] => ({
  total: entries.reduce((sum, entry) => sum + entry.cost, 0),
  byModel: costByModel(entries),
})

export type RestRequirements = ConfigRequirements

const setupFor = (
  config: ConfigOperations,
  run: ProcessRun,
  workspace: WorkspaceOps,
  host: HostOps,
  startOverrides: Readonly<Record<string, string>> = {},
) =>
  Effect.gen(function* () {
    const resolved = yield* workflowOf(config, run)
    const def = resolved.def
    const startFlags = run.trace.length === 0 ? yield* StartFlags : {}
    const { vars, env } = settingsFor(
      resolved,
      run.pinnedVars,
      host.env,
      startOverrides,
      startFlags,
    )
    const skills = yield* resolveScopeSkills(def, vars)
    const access = yield* resolveScopeAccess(def, skills, vars)
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
    const git = yield* GitService
    const episode: EpisodeCommit[] = []
    for (const c of run.episode.commits) {
      const tip = parseCommitMessage(c.message).kept
      // A plain `rev-parse --verify` of a missing 40-hex object succeeds; `^{commit}` does not.
      const exists = tip !== undefined && Option.isSome(yield* git.readRefOption(`${tip}^{commit}`))
      episode.push({
        hash: c.hash,
        message: c.message,
        tree: commitTree(workspace, c.hash),
        ...(exists ? { kept: { hash: tip, tree: commitTree(workspace, tip) } } : {}),
      })
    }
    let pendingMemo: ReadonlyMap<string, string | undefined> | undefined
    const setup: ReplaySetup = {
      def,
      run,
      vars,
      env,
      budget,
      skills,
      access,
      workspace,
      base,
      episode,
      pendingWorktree: () => (pendingMemo ??= workspace.worktreeSync()),
    }
    return { resolved, def, vars, env, setup }
  })

// Only an approval gate counts an index-only edit (one staged, then reverted
// in the worktree): its approval must cover exactly the judged diff. Every
// other rest keeps the worktree's view, so a net-zero turn stays an attempt.
const pendingChanges = (git: GitOperations, withIndex: boolean) =>
  Effect.gen(function* () {
    const worktree = yield* git.changedPaths()
    if (!withIndex) return worktree
    const seen = new Set(worktree.map((e) => e.path))
    return [...worktree, ...(yield* git.stagedPaths()).filter((e) => !seen.has(e.path))]
  })

/** Resolve the rest at `ref`, or at HEAD when `ref` is `undefined`. */
export const restAt = (
  ref: string | undefined,
  startOverrides: Readonly<Record<string, string>> = {},
): Effect.Effect<Rest, Error, RestRequirements> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    const workspace = yield* Workspace
    const host = yield* Host
    const run = yield* computeProcessRun(git, config.workflow, ref)
    const { resolved, def, vars, env, setup } = yield* setupFor(
      config,
      run,
      workspace,
      host,
      startOverrides,
    )
    // No `pending` tree: `restAt` resolves the LANDED process only, never a
    // pending working-tree edit (that's `decideLanding`'s own `replayFor`
    // call, below, deciding what landing right now WOULD do). `gtd lsp` caches
    // `gtd next --json`'s `state`/`file`/`mode` per HEAD and depends on this
    // staying true; passing a pending tree here would make it serve a stale
    // steering file on every cache hit.
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
        ? (yield* pendingChanges(git, stepDef.approve === true)).map((e) => ({
            status: normalizeStatus(e.status),
            path: e.path,
          }))
        : []
    const memory = memoryOf(outcome.trace, run)
    const configNow = config.fingerprint
    // Only the current rest warns, so a command must read it once — a second
    // read warns twice. An earlier ref (restore's tip) would warn about a
    // process the command is not acting on.
    if (ref === undefined) yield* warnConfigChanges(run, configNow, workspace)
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
      config: configNow,
      changes,
      memory: memory.key,
      memoryResumed: memory.resumed,
      hints: hintsOf(stepDef),
      cost: costTotals(run.costEntries),
      setup,
    }
  })

export const currentRest: Effect.Effect<Rest, Error, RestRequirements> = restAt(undefined)

type EndedOutcome = Extract<ReplayOutcome, { kind: "ended" }>
type UnendedOutcome = Exclude<ReplayOutcome, { kind: "ended" }>

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
    const host = yield* Host
    const { vars, env } = settingsFor(resolved, {}, host.env, startVars, yield* StartFlags)
    const skills = yield* resolveScopeSkills(resolved.def, vars)
    const access = yield* resolveScopeAccess(resolved.def, skills, vars)
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
        skills,
        configuredSkills: resolved.def.configuredSkills,
        access,
        configuredAccess: resolved.def.configuredAccess,
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

// An approval covers exactly the judged diff, so any edit refuses it; the
// approver is read only at such a rest, and must be a name a trailer can carry.
const approvalRefusal = (rest: Rest, approver: Option.Option<AuthorIdent>): Landing | undefined => {
  if (rest.stepDef.approve !== true) return undefined
  const id = rest.step.id
  if (rest.changes.length > 0) {
    return {
      kind: "refusal",
      message: `gtd land: approval-gate: ${formatStepId(id)} approves exactly the judged diff — revert your edits and run \`gtd land\` on a clean tree to approve, or run \`gtd abandon\``,
    }
  }
  if (Option.isNone(approver)) {
    return {
      kind: "refusal",
      message: `gtd land: approval-gate: ${formatStepId(id)} records who approved it, but git has no author identity — set user.name and user.email`,
    }
  }
  if (!isRecordableApproval({ step: id, ...approver.value })) {
    return {
      kind: "refusal",
      message: `gtd land: approval-gate: ${formatStepId(id)} cannot record ${approver.value.name} <${approver.value.email}> as approver — it would not read back unchanged from its Gtd-Approved trailer (a control character, for example)`,
    }
  }
  return undefined
}

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
  outcome: ReplayOutcome,
  rest: Rest,
): Effect.Effect<StateName | Landing, Error> => {
  if (outcome.kind === "refused")
    return Effect.succeed({ kind: "refusal", message: outcome.message })
  if (outcome.kind === "divergence" || outcome.kind === "failed") {
    return Effect.fail(new Error(outcome.message))
  }
  if (outcome.kind !== "rest") return Effect.succeed(rest.def.initial)
  const reserved = initialStepRefusal(rest.run.workflow, outcome.rest.name, rest.def.initial)
  return Effect.succeed(reserved === undefined ? outcome.rest.name : reserved)
}

/**
 * A step commit entering the default's first step is what ends an episode, so
 * a named workflow landing there would read back as finished. Its opening
 * commit may name that step: a bare opening is never read as a boundary.
 */
const initialStepRefusal = (
  workflow: string | undefined,
  step: StateName,
  initial: StateName,
): Landing | undefined =>
  workflow !== undefined && step === initial
    ? {
        kind: "refusal",
        message: `gtd: workflow "${workflow}" reaches step "${step}", the default workflow's first step — that is where a finished process waits, so a started process must never land there; rename the step`,
      }
    : undefined

const closingTrailers = (branch: Option.Option<string>) => ({
  version: GTD_VERSION,
  ...(Option.isSome(branch) ? { branch: branch.value } : {}),
})

const isSettledNoop = (rest: Rest, to: StateName): boolean =>
  rest.changes.length === 0 && rest.stepDef.kind === "script" && to === rest.state

// A clean tree has nothing to set aside (an allowEmpty keep step lands as an ordinary empty commit).
const keptTurn = (rest: Rest) =>
  rest.stepDef.keep === true && rest.changes.length > 0
    ? { keepTurn: keptRef(rest.run.startHash, rest.state) }
    : {}

const approvedTrailer = (rest: Rest, approver: Option.Option<AuthorIdent>) =>
  Option.isSome(approver) ? { approved: { step: rest.step.id, ...approver.value } } : {}

const landingTo = (
  rest: Rest,
  to: StateName,
  branch: Option.Option<string>,
  approver: Option.Option<AuthorIdent>,
  marks: readonly Mark[],
): Landing => {
  if (isSettledNoop(rest, to)) return { kind: "noop", settled: true }
  // The landing that leaves the flow's first step starts the process: it
  // pins the process settings every later invocation reads back.
  const underway = !noProcessUnderway(rest)
  const starts = !underway && to !== rest.def.initial
  const refused = starts ? multilineRefusal(rest.vars) : undefined
  if (refused !== undefined) return refused
  // Landing on the first step while a process is underway ends it (flow
  // return and `restart()` alike); the script then points the history ref at
  // that very commit.
  const finishes = underway && to === rest.def.initial
  return {
    kind: "commit",
    to,
    spec: {
      actor: rest.actor,
      from: rest.state,
      to,
      step: rest.step.id,
      ...(marks.length > 0 && { marks }),
      ...approvedTrailer(rest, approver),
      ...startTrailers(rest, starts),
      ...(finishes ? closingTrailers(branch) : {}),
    },
    ...(finishes ? { keepHistory: processHistoryRef(rest.run.startHash) } : {}),
    ...keptTurn(rest),
  }
}

const startTrailers = (rest: Rest, starts: boolean) =>
  starts ? { vars: rest.vars, config: rest.config } : {}

const outcomeMarks = (outcome: ReplayOutcome): readonly Mark[] =>
  outcome.kind === "rest" || outcome.kind === "ended" ? outcome.marks : []

/**
 * What landing the pending turn at `rest` does — a pure decision from a
 * replay with the working tree as the pending turn. The target step is
 * computed by replaying, never matched.
 */
const decideLanding = (
  rest: Rest,
  verdicts: readonly JudgeVerdict[] | undefined,
  branch: Option.Option<string>,
  approver: Option.Option<AuthorIdent>,
): Effect.Effect<Landing, Error> =>
  Effect.gen(function* () {
    const unapproved = approvalRefusal(rest, approver)
    if (unapproved !== undefined) return unapproved
    const early = cleanLanding(rest)
    if (early !== undefined) return early
    if (rest.stepDef.kind === "prompt" && rest.stepDef.access?.write != null) {
      const message = accessRefusal(rest.changes, rest.stepDef.access.write)
      if (message !== undefined) return { kind: "refusal", message }
    }
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
    return landingTo(rest, to, branch, approver, outcomeMarks(outcome))
  })

/** Where landing the pending turn would leave the process, or `undefined` when it would land nothing. */
export const previewLanding = (rest: Rest): Effect.Effect<StateName | undefined> =>
  decideLanding(rest, undefined, Option.none(), Option.none()).pipe(
    Effect.map((landing) => (landing.kind === "commit" ? landing.to : undefined)),
    Effect.catchAll(() => Effect.succeed(undefined)),
  )

/** Every fact the pure landing planner needs, read once: the rest, its steering file, and the landing decision. */
export const snapshotFromRest = (
  rest: Rest,
  verdicts?: readonly JudgeVerdict[],
): Effect.Effect<RepoSnapshot, Error, Workspace | GitService> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const branch = yield* git.currentBranch()
    const approver = rest.stepDef.approve === true ? yield* git.authorIdent() : Option.none()
    const landing = yield* decideLanding(rest, verdicts, branch, approver)
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

interface SummaryResult {
  readonly prompt: string | undefined
}

const humanCommitsOf = (
  trace: ProcessRun["trace"],
  entryCommit: string,
): { hash: string; state: StateName }[] =>
  trace
    .filter((entry) => entry.actor === "human" && entry.hash !== entryCommit)
    .map((entry) => ({ hash: entry.hash, state: entry.state }))

const summaryInput = (
  run: ProcessRun,
  settings: Pick<SummaryContext, "vars" | "env">,
): SummaryContext => {
  const entryCommit = run.trace[0]!.hash
  const { total, byModel } = costTotals(run.costEntries)
  return {
    entryCommit,
    processBase: run.startParentHash,
    processTip: run.trace[run.trace.length - 1]!.hash,
    humanCommits: humanCommitsOf(run.trace, entryCommit),
    processCost: total,
    processCostByModel: byModel,
    marks: run.marks,
    ...settings,
  }
}

export const summaryFor = (
  run: ProcessRun,
): Effect.Effect<SummaryResult, Error, RestRequirements> =>
  Effect.gen(function* () {
    const config = yield* (yield* ConfigService).load
    const host = yield* Host
    const resolved = yield* workflowOf(config, run)
    const summary = resolved.def.summary
    if (summary === undefined || run.trace.length === 0) return { prompt: undefined }
    return {
      prompt: summary(summaryInput(run, settingsFor(resolved, run.pinnedVars, host.env, {}, {}))),
    }
  })

export interface HistoryStep {
  readonly hash: string
  readonly subject: string
  readonly actor: string
  readonly from: StateName | undefined
  readonly to: StateName
  readonly verdicts: readonly JudgeVerdict[]
  readonly approval?: ApprovalEntry
}

export interface HistoryTrail {
  readonly tip: string
  readonly steps: readonly HistoryStep[]
  readonly ended: "return" | "restart"
  readonly version: {
    readonly recorded: string | undefined
    readonly running: string
  }
  /** Set when recorded !== running (a missing recorded version counts as different). */
  readonly versionWarning?: string
}

/** Repository-relative paths of the config files today's config and the process's own record name; one outside the repository cannot be read at a ref, so it is left out. */
const inRepoConfigPaths = (
  root: string,
  files: readonly string[],
  recorded: ConfigFingerprint,
): readonly string[] => {
  const paths = new Set<string>(Object.keys(recorded))
  for (const file of files) paths.add(relative(root, resolve(root, file)).split(sep).join("/"))
  return [...paths].filter((p) => p !== "" && !p.startsWith("..") && !isAbsolute(p)).sort()
}

const configRefusal = (
  command: string,
  tip: string,
  paths: readonly string[],
  reason = "A history ref replays under today's config, so it is unreadable after the config changes",
): Error =>
  new Error(
    `${command}: refused — config differs at ${tip.slice(0, 7)}: ${paths.join(", ")}. ${reason}`,
  )

const differingConfigPaths = (
  git: GitService["Type"],
  workspace: Workspace["Type"],
  root: string,
  config: { readonly fingerprint: ConfigFingerprint },
  run: ProcessRun,
  hash: string,
) =>
  Effect.gen(function* () {
    const differing: string[] = []
    for (const path of inRepoConfigPaths(
      root,
      Object.keys(config.fingerprint),
      run.pinnedConfig?.files ?? {},
    )) {
      const atTip = yield* Effect.orElseSucceed(git.readFileAtRef(hash, path), () => undefined)
      if (atTip !== workspace.readSync(path)) differing.push(path)
    }
    return differing
  })

const notClosedError = (hash: string, outcome: UnendedOutcome): Error =>
  outcome.kind === "rest"
    ? new Error(`gtd history: ${hash.slice(0, 7)} does not close a process under today's config`)
    : (replayError(outcome) ?? new Error("gtd history: replay failed"))

const historySteps = (run: ProcessRun): readonly HistoryStep[] => {
  const messages = new Map(run.episode.commits.map((c) => [c.hash, c.message]))
  return run.trace.map((entry): HistoryStep => {
    const message = parseCommitMessage(messages.get(entry.hash) ?? "")
    return {
      hash: entry.hash,
      subject: (messages.get(entry.hash) ?? "").split("\n")[0] ?? "",
      actor: entry.actor,
      from: message.parsed?.from,
      to: entry.state,
      verdicts: message.judge,
      ...optional("approval", approvalEntryOf(entry.hash, message)[0]),
    }
  })
}

const versionWarningFor = (recorded: string | undefined): string | undefined =>
  recorded === GTD_VERSION
    ? undefined
    : `gtd: warning: this history was recorded by ${recorded === undefined ? "an unknown gtd version" : `gtd ${recorded}`} and is replayed by gtd ${GTD_VERSION} — the engine the workflow runs on may have changed since`

/**
 * Replays the closed run at `tip` under today's config. The workflow is not
 * fingerprinted for a version change: the engine under it moves with every
 * upgrade, and the version warning is the only signal.
 */
export const historyTrail = (tip: string): Effect.Effect<HistoryTrail, Error, RestRequirements> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    const hash = yield* git.resolveRef(tip)
    const subject = yield* git.lastCommitSubject(hash)
    const run = yield* runAtTip(git, config.workflow, { hash, subject })
    const { outcome, recorded, versionWarning } = yield* replayFinishedProcess(config, run, hash, {
      command: "gtd history",
      notEnded: (o) => notClosedError(hash, o),
    })
    return {
      tip: hash,
      steps: historySteps(run),
      ended: outcome.via,
      version: { recorded, running: GTD_VERSION },
      ...(versionWarning !== undefined ? { versionWarning } : {}),
    }
  })

interface FinishedReplay {
  readonly outcome: EndedOutcome
  readonly recorded: string | undefined
  readonly versionWarning?: string
}

/** Refuses on config drift before replaying, so a stale config never runs the flow. */
const replayFinishedProcess = (
  config: ConfigOperations,
  run: ProcessRun,
  hash: string,
  how: {
    readonly command: string
    readonly configReason?: string
    readonly notEnded: (outcome: UnendedOutcome) => Error
  },
): Effect.Effect<FinishedReplay, Error, RestRequirements> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const workspace = yield* Workspace
    const host = yield* Host
    const recorded = parseCommitMessage(
      run.episode.commits.find((c) => c.hash === hash)?.message ?? "",
    ).version
    const versionWarning = versionWarningFor(recorded)
    // A refusal is often caused by the version change, so it carries the warning.
    const withWarning = (err: Error): Error =>
      versionWarning === undefined ? err : new Error(`${err.message}\n${versionWarning}`)
    const differing = yield* differingConfigPaths(git, workspace, host.root, config, run, hash)
    if (differing.length > 0)
      return yield* Effect.fail(
        withWarning(configRefusal(how.command, hash, differing, how.configReason)),
      )
    const { setup } = yield* setupFor(config, run, workspace, host)
    const outcome = yield* Effect.promise(() => replayFor(setup))
    if (outcome.kind !== "ended") return yield* Effect.fail(withWarning(how.notEnded(outcome)))
    return { outcome, recorded, ...(versionWarning !== undefined ? { versionWarning } : {}) }
  })
