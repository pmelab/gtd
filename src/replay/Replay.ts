import {
  installContext,
  type FlowContext,
  type Change,
  type JudgeAnswer,
  type JudgeQuestion,
  type FlowArgs,
  type ScopeOptions,
  type RunTools,
  type StepRequest,
  type Workflow,
} from "../flows/index.js"
import { createRenderLedger } from "../PatternTemplates.js"
import { headingSections, steeringFormatFor, unansweredQuestions } from "../steering/index.js"
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
 * reading from: the commit before the episode, or an entered process's opening
 * commit — which completes no step and so is never in `commits`. `entry` is the
 * name `gtd --entry` opened it with, `undefined` for an ordinary start.
 */
export interface Episode {
  readonly entry: string | undefined
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
  /** The process's diff base — what `start()` returns. */
  readonly start: string
  readonly budgetBytes: number
  readonly pending?: PendingTurn
}

export type StepKind = Exclude<StepRequest["kind"], "restart">

type Actor = "agent" | "human" | "check" | "judge"

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
  /** Whether the judge budget cut this step's evidence. */
  readonly truncated: boolean
}

export type ReplayOutcome =
  | {
      readonly kind: "rest"
      readonly rest: ReachedStep
      readonly trace: readonly ReachedStep[]
      /** The step the pending turn completed, when one was supplied. */
      readonly landed: ReachedStep | undefined
      /** Whether the flow looked at its `entry` argument on the way here. */
      readonly entryRead: boolean
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

/** One step's changes; content is read only when a flow asks for it. */
const changesBetween = (before: TreeView, after: TreeView): readonly Change[] => {
  const diff = diffTrees(before, after)
  const change = (path: string, status: Change["status"]): Change => ({
    path,
    status,
    get before() {
      return status === "added" ? undefined : before.read(path)
    },
    get after() {
      return status === "deleted" ? undefined : after.read(path)
    },
  })
  return [
    ...diff.added.map((path) => change(path, "added")),
    ...diff.modified.map((path) => change(path, "modified")),
    ...diff.deleted.map((path) => change(path, "deleted")),
  ].sort((a, b) => a.path.localeCompare(b.path))
}

const normalizeAnswer = (answer: string | number | boolean): string =>
  typeof answer === "boolean" ? (answer ? "yes" : "no") : String(answer)

const answersFrom = (
  verdicts: readonly JudgeVerdict[],
  questions: readonly JudgeQuestion[],
): Readonly<Record<string, JudgeAnswer | undefined>> => {
  const answers: Record<string, JudgeAnswer | undefined> = {}
  for (const question of questions) answers[question.id] = undefined
  for (const verdict of verdicts) {
    if (!(verdict.id in answers)) continue
    answers[verdict.id] = { answer: normalizeAnswer(verdict.answer), p: verdict.p }
  }
  return answers
}

/** Cut each evidence value to an even share of the judge budget; which keys were cut. */
const budgeted = (
  evidence: Readonly<Record<string, string>>,
  budgetBytes: number,
): {
  readonly evidence: Readonly<Record<string, string>>
  readonly truncated: readonly string[]
} => {
  const keys = Object.keys(evidence)
  const ledger = createRenderLedger(budgetBytes)
  const bounded: Record<string, string> = {}
  const truncated: string[] = []
  for (const key of keys) {
    const value = evidence[key]!
    bounded[key] = ledger.tail(value, 1 / keys.length)
    if (bounded[key] !== value) truncated.push(key)
  }
  return { evidence: bounded, truncated }
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
const STEERING_OPTIONS = ["file", "mode", "label", "base"]
// The option keys each step accepts. A gtd.config.ts is evaluated without a
// type check, so a misspelt or retired key would otherwise be silently ignored.
const KNOWN_OPTIONS: Readonly<Record<StepKind, ReadonlySet<string>>> = {
  agent: new Set([...STEERING_OPTIONS, "model", "system", "skills", "allowEmpty"]),
  human: new Set([...STEERING_OPTIONS, "message", "acceptClean"]),
  run: new Set(STEERING_OPTIONS),
  judge: new Set([...STEERING_OPTIONS, "message"]),
}
const RETIRED_OPTIONS: Readonly<Record<string, string>> = {
  memory:
    "a step's memory scope is computed from its scope() prefix, so the memory option no longer exists",
  requireProgress: "check the step's changes() in the flow and refuse() instead",
  answerGate: "check openQuestions() in the flow and refuse() instead",
  requireRevert: "compare the files against the changes() you kept and refuse() instead",
  reviewBase: "record head() in the flow and pass it as the reviewing step's base",
  minP: "compare the answer's p in the flow instead",
}

const unknownOptions = (step: ReachedStep): string | undefined => {
  const unknown = Object.keys(step.request.options).filter(
    (key) => !KNOWN_OPTIONS[step.kind].has(key),
  )
  if (unknown.length === 0) return undefined
  const why = unknown.flatMap((key) => (RETIRED_OPTIONS[key] ? [RETIRED_OPTIONS[key]] : []))
  return `gtd: step "${step.name}": unknown key(s) ${unknown.join(", ")} in ${step.kind}() options${why.length > 0 ? ` — ${why.join("; ")}` : ""}`
}

export const replay = async (input: ReplayInput): Promise<ReplayOutcome> => {
  let entryRead = false
  const args: FlowArgs = {
    get entry() {
      entryRead = true
      return input.episode.entry
    },
  }
  const commits: readonly ParsedCommit[] = input.episode.commits.map((c) => ({
    ...c,
    parsed: parseCommitMessage(c.message),
  }))

  let cursor = 0
  let pendingUsed = false
  let position: Position = input.episode.base
  let previousPosition: Position = input.episode.base
  let expectedNext: { readonly name: string; readonly hash: string } | undefined
  const occurrences = new Map<string, number>()
  const personas = new Map<string, Identity>()
  const scopes: ScopeOptions[] = []
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

  const scoped = (name: string): string =>
    [...scopes.flatMap((s) => (s.name === undefined ? [] : [s.name])), name].join(".")

  const isAttemptAt = (commit: ParsedCommit, name: string): boolean =>
    commit.parsed.step === undefined &&
    commit.parsed.parsed !== undefined &&
    commit.parsed.parsed.from === undefined &&
    commit.parsed.parsed.to === name &&
    isEmptyDiff(diffTrees(position.tree, commit.tree))

  const advance = (next: Position): void => {
    previousPosition = position
    position = next
  }

  const replyFor = (
    request: Exclude<StepRequest, { kind: "restart" }>,
    verdicts: readonly JudgeVerdict[],
  ): unknown =>
    request.kind === "judge"
      ? {
          answers: answersFrom(verdicts, request.questions),
          truncated: judgeCuts.get(request) ?? [],
        }
      : undefined

  // A callback runs after replay returns (under `gtd exec`), yet reads vars
  // and head()/start() like the flow around it: it gets the replay's context back.
  const withContext =
    (body: (tools: RunTools) => Promise<void> | void) =>
    async (tools: RunTools): Promise<void> => {
      installContext(context)
      try {
        await body(tools)
      } finally {
        installContext(undefined)
      }
    }

  const judgeCuts = new WeakMap<object, readonly string[]>()

  const resolve = (
    request: Exclude<StepRequest, { kind: "restart" }>,
  ): Exclude<StepRequest, { kind: "restart" }> => {
    if (request.kind === "agent") {
      const persona: { model?: string; system?: string } = {}
      for (const s of scopes) {
        if (s.model !== undefined) persona.model = s.model
        if (s.system !== undefined) persona.system = s.system
      }
      return { ...request, options: { ...persona, ...request.options } }
    }
    if (request.kind === "run" && typeof request.body === "function") {
      return { ...request, body: withContext(request.body) }
    }
    if (request.kind === "judge") {
      const { evidence, truncated } = budgeted(request.evidence, input.budgetBytes)
      const bounded = { ...request, evidence }
      judgeCuts.set(bounded, truncated)
      return bounded
    }
    return request
  }

  const reach = (request: Exclude<StepRequest, { kind: "restart" }>): ReachedStep => {
    const name = scoped(request.name)
    const occurrence = (occurrences.get(name) ?? 0) + 1
    occurrences.set(name, occurrence)
    const resolved = resolve(request)
    const reached: ReachedStep = {
      id: { name, occurrence },
      name,
      kind: resolved.kind,
      actor: actorOfKind(resolved.kind),
      request: resolved,
      memoryScope: memoryScopeOf(name),
      enteredAt: position.hash,
      truncated: (judgeCuts.get(resolved) ?? []).length > 0,
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
    const error = unknownOptions(step) ?? checkIdentity(step)
    return error === undefined ? undefined : { kind: "failed", message: error }
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
    advance(commit)
    const to = commit.parsed.parsed?.to
    if (to !== undefined) expectedNext = { name: to, hash: commit.hash }
    return replyFor(step.request, commit.parsed.judge)
  }

  const answer = (step: ReachedStep): unknown => {
    while (cursor < commits.length && isAttemptAt(commits[cursor]!, step.name)) cursor++
    const commit = commits[cursor]
    if (commit !== undefined) return consumeCommit(step, commit)
    if (input.pending === undefined || pendingUsed) {
      return finish({ kind: "rest", rest: step, trace, landed, entryRead })
    }
    pendingUsed = true
    landed = step
    advance({ hash: "", tree: input.pending.tree })
    return replyFor(step.request, input.pending.verdicts ?? [])
  }

  const handleStep = async (request: StepRequest): Promise<unknown> => {
    if (outcome !== undefined) throw new Stop()
    if (request.kind === "restart") return finish(endOfFlow("restart"))
    if (typeof request.name !== "string" || request.name === "") {
      return finish({ kind: "failed", message: "gtd: a step was called without a name" })
    }
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
    pushScope: (scope) => scopes.push(scope),
    popScope: () => void scopes.pop(),
    read: (path) => position.tree.read(path),
    glob: (pattern) => position.tree.paths().filter((path) => globMatches(path, pattern)),
    changes: () => changesBetween(previousPosition.tree, position.tree),
    matches: globMatches,
    sections: (text) => headingSections(text),
    openQuestions: (text) => {
      const qa = steeringFormatFor("qa")
      return qa === undefined
        ? []
        : unansweredQuestions(qa, text).map((q) => ({
            question: q.question,
            line: q.headingLine + 1,
          }))
    },
    vars: input.vars,
    start: () => input.start,
    // At the rest, trailing attempts sit above the last step commit: the head a
    // prompt names is the commit the process actually stands on.
    head: () => {
      const rest = commits.slice(cursor)
      return rest.length > 0 && rest.every((c) => c.parsed.step === undefined)
        ? rest[rest.length - 1]!.hash
        : position.hash
    },
  }

  installContext(context)
  try {
    const flowDone = input.workflow.flow(args).then(
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
