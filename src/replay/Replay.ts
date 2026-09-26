import {
  installContext,
  type Actor,
  type FlowContext,
  type JudgeAnswer,
  type JudgeQuestion,
  type PersonaOptions,
  type StepRequest,
  type Workflow,
} from "../flows/index.js"
import { createRenderLedger, type RenderLedger } from "../PatternTemplates.js"
import { globMatches } from "./Glob.js"
import { diffTrees, isEmptyDiff, type TreeView } from "./Tree.js"
import {
  formatStepId,
  parseCommitMessage,
  type CommitMessage,
  type JudgeVerdict,
  type StepId,
} from "./Trailers.js"

export interface EpisodeCommit {
  readonly hash: string
  readonly message: string
  readonly tree: TreeView
}

/**
 * The commits one episode consists of. `base` is where the first step starts
 * reading from: the commit before the episode, or a manual entry's opening
 * commit — which completes no step and so is never in `commits`.
 */
export interface Episode {
  readonly entry: string
  readonly base: { readonly hash: string; readonly tree: TreeView }
  readonly commits: readonly EpisodeCommit[]
}

/** The turn a landing is about to commit, completing the step the episode rests at. */
export interface PendingTurn {
  readonly tree: TreeView
  readonly verdicts?: readonly JudgeVerdict[]
}

export interface ReplayInput {
  readonly workflow: Workflow
  readonly episode: Episode
  readonly vars: Readonly<Record<string, string>>
  readonly refs: { readonly start: string; readonly processBase: string }
  readonly budgetBytes: number
  readonly pending?: PendingTurn
}

export type StepKind = Exclude<StepRequest["kind"], "restart">

const actorOfKind = (kind: StepKind): Actor =>
  kind === "run" ? "check" : kind === "agent" ? "agent" : kind === "human" ? "human" : "judge"

/** One step replay reached, completed or not. */
export interface ReachedStep {
  readonly id: StepId
  /** The scoped name — the step's node id and subject name. */
  readonly name: string
  readonly kind: StepKind
  readonly actor: Actor
  readonly request: Exclude<StepRequest, { kind: "restart" }>
  /** Everything before the name's last `.` — `""` at the root. */
  readonly memoryScope: string
  /** The commit replay stood on when it reached this step. */
  readonly enteredAt: string
  readonly reviewBase: string
  /** Whether a `tail` read since the previous step dropped bytes. */
  readonly truncated: boolean
}

export type ReplayOutcome =
  | {
      readonly kind: "rest"
      readonly rest: ReachedStep
      readonly trace: readonly ReachedStep[]
      /** The step the pending turn completed, when one was supplied. */
      readonly landed: ReachedStep | undefined
    }
  | {
      readonly kind: "ended"
      readonly via: "return" | "restart"
      readonly trace: readonly ReachedStep[]
      readonly landed: ReachedStep | undefined
    }
  | { readonly kind: "divergence"; readonly message: string }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string }

const memoryScopeOf = (name: string): string => {
  const dot = name.lastIndexOf(".")
  return dot === -1 ? "" : name.slice(0, dot)
}

class Stop extends Error {}

const short = (hash: string): string => hash.slice(0, 7)

const normalizeAnswer = (answer: string | number | boolean): string =>
  typeof answer === "boolean" ? (answer ? "yes" : "no") : String(answer)

const answersFrom = (
  verdicts: readonly JudgeVerdict[],
  questions: readonly JudgeQuestion[],
  minP: number | undefined,
): Readonly<Record<string, JudgeAnswer>> => {
  const ids = new Set(questions.map((q) => q.id))
  const answers: Record<string, JudgeAnswer> = {}
  for (const verdict of verdicts) {
    if (!ids.has(verdict.id)) continue
    if (minP !== undefined && verdict.p < minP) continue
    answers[verdict.id] = { answer: normalizeAnswer(verdict.answer), p: verdict.p }
  }
  return answers
}

interface Identity {
  readonly model: string | undefined
  readonly system: string | undefined
}

const samePersona = (a: Identity, b: Identity): boolean =>
  a.model === b.model && a.system === b.system

interface Position {
  readonly hash: string
  readonly tree: TreeView
}

interface ParsedCommit extends EpisodeCommit {
  readonly parsed: CommitMessage
}

/**
 * Replay one episode: run its entry flow, answering each step from the
 * episode's commits in order, until a step has no commit left — the rest.
 * Pure over its input: the same episode always yields the same outcome, and
 * the only reads are through `TreeView`s.
 */
export const replay = async (input: ReplayInput): Promise<ReplayOutcome> => {
  const entry = input.workflow.entries[input.episode.entry]
  if (entry === undefined) {
    return {
      kind: "failed",
      message: `gtd: the workflow declares no entry "${input.episode.entry}"`,
    }
  }
  const commits: readonly ParsedCommit[] = input.episode.commits.map((c) => ({
    ...c,
    parsed: parseCommitMessage(c.message),
  }))

  let cursor = 0
  let pendingUsed = false
  let position: Position = input.episode.base
  let previousPosition: Position = input.episode.base
  let reviewBase = input.refs.start
  let expectedNext: { readonly name: string; readonly hash: string } | undefined
  let ledger: RenderLedger = createRenderLedger(input.budgetBytes)
  const occurrences = new Map<string, number>()
  const completions = new Map<string, TreeView[]>()
  const personas = new Map<string, Identity>()
  const scopes: string[] = []
  const personaStack: PersonaOptions[] = []
  const trace: ReachedStep[] = []
  let landed: ReachedStep | undefined
  let outcome: ReplayOutcome | undefined
  let signal: (() => void) | undefined
  const settled = new Promise<void>((resolve) => {
    signal = resolve
  })

  const finish = (result: ReplayOutcome): Promise<never> => {
    outcome ??= result
    signal?.()
    throw new Stop()
  }

  const scoped = (name: string): string => [...scopes, name].join(".")

  const isAttemptAt = (commit: ParsedCommit, name: string): boolean =>
    commit.parsed.step === undefined &&
    commit.parsed.parsed !== undefined &&
    commit.parsed.parsed.from === undefined &&
    commit.parsed.parsed.to === name &&
    isEmptyDiff(diffTrees(position.tree, commit.tree))

  const advance = (next: Position, name: string): void => {
    previousPosition = position
    position = next
    const trees = completions.get(name) ?? []
    trees.push(next.tree)
    completions.set(name, trees)
    ledger = createRenderLedger(input.budgetBytes)
  }

  const replyFor = (
    request: Exclude<StepRequest, { kind: "restart" }>,
    verdicts: readonly JudgeVerdict[],
  ): unknown =>
    request.kind === "judge"
      ? answersFrom(verdicts, request.questions, request.options.minP)
      : undefined

  const reach = (request: Exclude<StepRequest, { kind: "restart" }>): ReachedStep => {
    const name = scoped(request.name)
    const occurrence = (occurrences.get(name) ?? 0) + 1
    occurrences.set(name, occurrence)
    const persona = Object.assign({}, ...personaStack) as PersonaOptions
    const resolved =
      request.kind === "agent"
        ? { ...request, options: { ...persona, ...request.options } }
        : request
    if (resolved.options.reviewBase === true) reviewBase = position.hash
    const reached: ReachedStep = {
      id: { name, occurrence },
      name,
      kind: resolved.kind,
      actor: actorOfKind(resolved.kind),
      request: resolved,
      memoryScope: memoryScopeOf(name),
      enteredAt: position.hash,
      reviewBase,
      truncated: ledger.truncated(),
    }
    trace.push(reached)
    return reached
  }

  const checkIdentity = (step: ReachedStep): string | undefined => {
    if (step.request.kind !== "agent") return undefined
    const identity: Identity = {
      model: step.request.options.model,
      system: step.request.options.system,
    }
    const seen = personas.get(step.memoryScope)
    if (seen === undefined) {
      personas.set(step.memoryScope, identity)
      return undefined
    }
    return samePersona(seen, identity)
      ? undefined
      : `gtd: "${step.name}" runs with a different model or system prompt than an earlier agent step in memory scope "${step.memoryScope || "root"}" — one scope is one conversation, and a conversation has one identity`
  }

  const DIVERGED = "the workflow changed under this process; run `gtd abandon` to start over"

  // Checks a reached step against what the previous commit's subject promised
  // and against the persona of its scope — the reasons replay cannot go on.
  const blockerAt = (step: ReachedStep): ReplayOutcome | undefined => {
    const expected = expectedNext
    expectedNext = undefined
    if (expected !== undefined && expected.name !== step.name) {
      return {
        kind: "divergence",
        message: `gtd: commit ${short(expected.hash)} names "${expected.name}" as the next step, but replay reached "${step.name}" — ${DIVERGED}`,
      }
    }
    const identityError = checkIdentity(step)
    return identityError === undefined ? undefined : { kind: "failed", message: identityError }
  }

  const consumeCommit = (step: ReachedStep, commit: ParsedCommit): unknown => {
    const recorded = commit.parsed.step
    const expected = formatStepId(step.id)
    if (recorded === undefined || formatStepId(recorded) !== expected) {
      const what =
        recorded === undefined ? "records no step" : `records step "${formatStepId(recorded)}"`
      return finish({
        kind: "divergence",
        message: `gtd: commit ${short(commit.hash)} ${what}, but replay expected "${expected}" — ${DIVERGED}`,
      })
    }
    cursor++
    advance(commit, step.name)
    const to = commit.parsed.parsed?.to
    if (to !== undefined) expectedNext = { name: to, hash: commit.hash }
    return replyFor(step.request, commit.parsed.judge)
  }

  const answer = (step: ReachedStep): unknown => {
    while (cursor < commits.length && isAttemptAt(commits[cursor]!, step.name)) cursor++
    const commit = commits[cursor]
    if (commit !== undefined) return consumeCommit(step, commit)
    if (input.pending === undefined || pendingUsed) {
      return finish({ kind: "rest", rest: step, trace, landed })
    }
    pendingUsed = true
    landed = step
    advance({ hash: "", tree: input.pending.tree }, step.name)
    return replyFor(step.request, input.pending.verdicts ?? [])
  }

  const handleStep = async (request: StepRequest): Promise<unknown> => {
    if (outcome !== undefined) throw new Stop()
    if (typeof request.name !== "string" || request.name === "") {
      return finish({ kind: "failed", message: "gtd: a step was called without a name" })
    }
    if (request.kind === "restart") return finish(endOfFlow("restart"))
    const step = reach(request)
    const blocker = blockerAt(step)
    return blocker === undefined ? answer(step) : finish(blocker)
  }

  const endOfFlow = (via: "return" | "restart"): ReplayOutcome =>
    cursor < commits.length
      ? {
          kind: "divergence",
          message: `gtd: the flow ended, but commit ${short(commits[cursor]!.hash)} continues the episode — ${DIVERGED}`,
        }
      : { kind: "ended", via, trace, landed }

  const context: FlowContext = {
    step: handleStep,
    refuse: (message) => {
      outcome ??= { kind: "refused", message }
      signal?.()
      throw new Stop()
    },
    pushScope: (prefix) => scopes.push(prefix),
    popScope: () => void scopes.pop(),
    pushPersona: (persona) => personaStack.push(persona),
    popPersona: () => void personaStack.pop(),
    exists: (path) => position.tree.read(path) !== undefined,
    read: (path) => position.tree.read(path),
    glob: (pattern) => position.tree.paths().filter((path) => globMatches(path, pattern)),
    changes: () => diffTrees(previousPosition.tree, position.tree),
    matches: globMatches,
    tail: (pathOrContent, share) =>
      ledger.tail(position.tree.read(pathOrContent) ?? pathOrContent, share),
    previous: (path, since) => {
      const trees = completions.get(scoped(since)) ?? []
      return trees.length < 2 ? undefined : trees[trees.length - 2]!.read(path)
    },
    vars: input.vars,
    refs: {
      get start() {
        return input.refs.start
      },
      get head() {
        return position.hash
      },
      get reviewBase() {
        return reviewBase
      },
      get processBase() {
        return input.refs.processBase
      },
    },
  }

  installContext(context)
  try {
    const flowDone = entry.flow().then(
      () => {
        if (outcome === undefined && trace.length === 0) {
          outcome = { kind: "failed", message: "gtd: the flow returned without reaching any step" }
        }
        outcome ??= endOfFlow("return")
      },
      (error: unknown) => {
        if (error instanceof Stop) return
        outcome ??= {
          kind: "failed",
          message: `gtd: the workflow threw: ${error instanceof Error ? error.message : String(error)}`,
        }
      },
    )
    // Replay runs on microtasks alone: a flow still unsettled once a macrotask
    // fires awaited something other than a step.
    const stuck = new Promise<void>((resolve) => setImmediate(resolve))
    await Promise.race([flowDone, settled, stuck])
  } finally {
    installContext(undefined)
  }
  return (
    outcome ?? {
      kind: "failed",
      message:
        "gtd: the flow awaited something that is not a step — flow code may suspend only at steps",
    }
  )
}
