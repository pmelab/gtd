import {
  installContext,
  protocolMismatch,
  type FlowContext,
  type Change,
  type JudgeAnswer,
  type JudgeQuestion,
  type ScopeAccess,
  type AccessDef,
  type ScopeOptions,
  type ContextLimitOptions,
  type StepRequest,
  type Flow,
  type Mark,
} from "../flows/index.js"
import {
  headingSectionBodies,
  headingSections,
  steeringFormatFor,
  parseCodeThreads,
  parseThreadsWithFindings,
  unansweredQuestions,
} from "../steering/index.js"
import { accessShapeFault, foldAccess, sameAccess } from "./Access.js"
import { contextLimitFault, globMatches } from "../wire/index.js"
import { refNameFault } from "./RefName.js"
import { IMPLICIT_SLICE, SLICE_NAME, type SliceSpan } from "./Slices.js"
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
  /** Present when the commit carries Gtd-Kept and that object still exists. */
  readonly kept?: { readonly hash: string; readonly tree: TreeView }
}

/**
 * The commits one episode consists of. `base` is where the first step starts
 * reading from: the commit before the episode, or an entered process's opening
 * commit — which completes no step and so is never in `commits`.
 */
export interface Episode {
  readonly base: { readonly hash: string; readonly tree: TreeView }
  readonly commits: readonly EpisodeCommit[]
}

/** The turn a landing is about to commit, completing the step the episode rests at. */
export interface PendingTurn {
  readonly tree: TreeView
  readonly verdicts?: readonly JudgeVerdict[]
}

export interface ReplayInput {
  readonly flow: Flow
  readonly episode: Episode
  /** Process settings: flow code may branch on these. */
  readonly vars: Readonly<Record<string, string>>
  /** Environment settings: read live, so flow code must not let them change the next step. */
  readonly env: Readonly<Record<string, string>>
  /** The process's diff base — what `start()` returns. */
  readonly start: string
  /** `start`'s tree, for a diff base outside the episode (an entered process's review base predates its opening commit). */
  readonly startTree?: TreeView
  readonly budgetBytes: number
  readonly pending?: PendingTurn
  /** Bundled skill lists keyed by scope full name — `WorkflowDefinition.skills` applied to the process's vars. The fallback beneath a `scope()` option and `configuredSkills`. */
  readonly skills?: Readonly<Record<string, readonly string[]>>
  /** `config.skills` entries by scope full name; kept apart from `skills` so they outrank a `scope()` option while the bundled export does not. */
  readonly configuredSkills?: Readonly<Record<string, readonly string[]>>
  /** Bundled access keyed by scope full name — the fallback beneath a `scope()` option and `configuredAccess`. */
  readonly access?: Readonly<Record<string, ScopeAccess>>
  /** `config.access` entries by scope full name; they outrank a `scope()` option. */
  readonly configuredAccess?: Readonly<Record<string, ScopeAccess>>
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
  /** The scope's resolved skill list, for an agent step; absent when none. */
  readonly skills?: readonly string[] | undefined
  /** The scope's resolved access with the step's steering file and waiting code threads folded in, for an agent step. */
  readonly access?: AccessDef | undefined
  /** The commit replay stood on when it reached this step. */
  readonly enteredAt: string
  /** Whether the judge budget cut this step's evidence. */
  readonly truncated: boolean
  /** The named `scope()` calls enclosing the step, outermost first: each call's prefix and its own id. */
  readonly scopeCalls: readonly { readonly prefix: string; readonly call: number }[]
}

export type ReplayOutcome =
  | {
      readonly kind: "rest"
      readonly rest: ReachedStep
      readonly trace: readonly ReachedStep[]
      /** The step the pending turn completed, when one was supplied. */
      readonly landed: ReachedStep | undefined
      /** Marks the flow made after the pending turn's step resolved; [] without a pending turn. */
      readonly marks: readonly Mark[]
      readonly slices: readonly SliceSpan[]
    }
  | {
      readonly kind: "ended"
      readonly via: "return" | "restart"
      readonly trace: readonly ReachedStep[]
      readonly landed: ReachedStep | undefined
      readonly marks: readonly Mark[]
      /** Spans of the episode that just ended; a restart() inside a slice leaves its leftAt undefined. */
      readonly slices: readonly SliceSpan[]
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

/** The last `allowedBytes` bytes of `content`, from the first whole line on. */
const tailOf = (content: string, allowedBytes: number): string => {
  const buf = Buffer.from(content, "utf8")
  if (buf.length <= allowedBytes) return content
  const tail = buf.subarray(buf.length - allowedBytes).toString("utf8")
  const newline = tail.indexOf("\n")
  return newline === -1 ? "" : tail.slice(newline + 1)
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
  const share = Math.floor(budgetBytes / Math.max(keys.length, 1))
  const bounded: Record<string, string> = {}
  const truncated: string[] = []
  for (const key of keys) {
    const value = evidence[key]!
    bounded[key] = tailOf(value, share)
    if (bounded[key] !== value) truncated.push(key)
  }
  return { evidence: bounded, truncated }
}

// The innermost of `chain`, named by its full path.
const scopeLabel = (chain: readonly ScopeOptions[]): string => {
  const path = chain.flatMap((o) => (o.name === undefined ? [] : [o.name])).join(".")
  if (chain.at(-1)?.name !== undefined) return `scope "${path}"`
  return path === "" ? "an unnamed scope" : `an unnamed scope inside "${path}"`
}

// Key by key, innermost last: a scope or step that sets only `hard` keeps the outer `soft`.
const inheritedContext = (
  layers: readonly (ContextLimitOptions | undefined)[],
): ContextLimitOptions | undefined =>
  layers.reduce<ContextLimitOptions | undefined>(
    (merged, layer) =>
      layer === undefined
        ? merged
        : {
            ...merged,
            ...Object.fromEntries(Object.entries(layer).filter(([, value]) => value !== undefined)),
          },
    undefined,
  )

interface Identity {
  readonly model: string | undefined
  readonly system: string | undefined
  readonly skills: readonly string[] | undefined
  /** Scope-level and unfolded: two steps differing only in steering file share a conversation. */
  readonly access: ScopeAccess | undefined
}

const sameSkills = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean =>
  (a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every((skill, i) => skill === b?.[i])

const samePersona = (a: Identity, b: Identity): boolean =>
  a.model === b.model &&
  a.system === b.system &&
  sameSkills(a.skills, b.skills) &&
  sameAccess(a.access, b.access)

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
// type check, so a misspelt key would otherwise be silently ignored.
const KNOWN_OPTIONS: Readonly<Record<StepKind, ReadonlySet<string>>> = {
  agent: new Set([...STEERING_OPTIONS, "model", "system", "context", "allowEmpty", "keep"]),
  human: new Set([...STEERING_OPTIONS, "message", "acceptClean", "approve"]),
  run: new Set(STEERING_OPTIONS),
  judge: new Set([...STEERING_OPTIONS, "message"]),
}

const unknownOptions = (step: ReachedStep): string | undefined => {
  const unknown = Object.keys(step.request.options).filter(
    (key) => !KNOWN_OPTIONS[step.kind].has(key),
  )
  if (unknown.length === 0) return undefined
  return `gtd: step "${step.name}": unknown key(s) ${unknown.join(", ")} in ${step.kind}() options`
}

const approveConflict = (step: ReachedStep): string | undefined => {
  const request = step.request
  if (request.kind !== "human" || request.options.approve !== true) return undefined
  const keys = (["mode", "file"] as const).filter((key) => request.options[key] !== undefined)
  if (keys.length === 0) return undefined
  return `gtd: step "${step.name}": approve cannot be combined with ${keys.join(", ")} in human() options — an approval records exactly the judged tree, and a steering file is rewritten on landing`
}

export const replay = async (input: ReplayInput): Promise<ReplayOutcome> => {
  const commits: readonly ParsedCommit[] = input.episode.commits.map((c) => ({
    ...c,
    parsed: parseCommitMessage(c.message),
  }))

  // Every replay re-derives base, commits and head() from whatever history
  // exists right now, so a hash a flow reads this same run (head()/start())
  // always names a commit `treeAt` can find here. Only a hash a flow gets from
  // somewhere else — stored state, another branch, a fabricated value — can
  // miss.
  const treeAt = (hash: string): TreeView | undefined =>
    hash === input.episode.base.hash
      ? input.episode.base.tree
      : (commits.find((c) => c.hash === hash)?.tree ??
        (hash === input.start ? input.startTree : undefined))

  let cursor = 0
  let pendingUsed = false
  let position: Position = input.episode.base
  let previousPosition: Position = input.episode.base
  let expectedNext: { readonly name: string; readonly hash: string } | undefined
  const occurrences = new Map<string, number>()
  const personas = new Map<string, Identity>()
  const scopes: ScopeOptions[] = []
  // Numbers each scope() call in replay order, so two calls in a row are two conversations.
  const scopeCallIds: number[] = []
  let scopeCallCount = 0
  const trace: ReachedStep[] = []
  // Newest consumed keep per scoped step name; `before` is the tree the kept turn diverged from.
  const keptTips = new Map<
    string,
    { readonly hash: string; readonly before: TreeView; readonly after: TreeView }
  >()
  let landed: ReachedStep | undefined
  const marks: Mark[] = []
  const slices: { name: string; enteredAt: string; leftAt: string | undefined }[] = []
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

  const namedScopeCalls = (): { prefix: string; call: number }[] => {
    const calls: { prefix: string; call: number }[] = []
    const names: string[] = []
    scopes.forEach((s, i) => {
      if (s.name === undefined) return
      names.push(s.name)
      calls.push({ prefix: names.join("."), call: scopeCallIds[i]! })
    })
    return calls
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

  const judgeCuts = new WeakMap<object, readonly string[]>()

  // Resolved per memory scope `memory`: for each prefix of it, innermost
  // first, a `config` entry, then the innermost `scope()` call at that prefix
  // (an unnamed scope counts at its parent's prefix), then the bundled export.
  const resolveScoped = <T>(
    memory: string,
    pick: (s: (typeof scopes)[number]) => T | undefined,
    configured: Readonly<Record<string, T>> | undefined,
    bundled: Readonly<Record<string, T>> | undefined,
  ): T | undefined => {
    const own = new Map<string, T>()
    const names: string[] = []
    for (const s of scopes) {
      if (s.name !== undefined) names.push(s.name)
      const v = pick(s)
      if (v !== undefined) own.set(names.join("."), v)
    }
    const parts = memory === "" ? [] : memory.split(".")
    const prefixes = parts.map((_, i) => parts.slice(0, parts.length - i).join(".")).concat("")
    return prefixes
      .map((p) => configured?.[p] ?? own.get(p) ?? bundled?.[p])
      .find((r) => r !== undefined)
  }

  // An empty result collapses to `undefined` so it is absent on the wire.
  const resolveSkills = (memory: string): readonly string[] | undefined => {
    const hit = resolveScoped(memory, (s) => s.skills, input.configuredSkills, input.skills)
    return hit === undefined || hit.length === 0 ? undefined : hit
  }

  // `{}` is a hit meaning unrestricted.
  const resolveAccess = (memory: string): ScopeAccess | undefined =>
    resolveScoped(memory, (s) => s.access, input.configuredAccess, input.access)

  const foldedAccessFor = (
    scopeAccess: ScopeAccess | undefined,
    file: string | undefined,
  ): AccessDef => {
    // Reading code threads parses every changed file: only a restricted side needs them.
    const restricted = scopeAccess?.read !== undefined || scopeAccess?.write !== undefined
    const threadPaths = restricted
      ? context
          .codeThreads()
          .filter((t) => t.waitingOn === "agent")
          .map((t) => t.path)
      : []
    return foldAccess(scopeAccess, file, threadPaths)
  }

  const scopeAccessFault = (): string | undefined => {
    for (const [i, s] of scopes.entries()) {
      if (s.access === undefined) continue
      const fault = accessShapeFault(s.access)
      if (fault === undefined) continue
      const name = scopes
        .slice(0, i + 1)
        .flatMap((o) => (o.name === undefined ? [] : [o.name]))
        .join(".")
      return `gtd: scope "${name || "root"}": ${fault}`
    }
    return undefined
  }

  const unfoldedAccess = new WeakMap<ReachedStep, ScopeAccess | undefined>()

  const resolve = (
    request: Exclude<StepRequest, { kind: "restart" }>,
  ): Exclude<StepRequest, { kind: "restart" }> => {
    if (request.kind === "agent") {
      const persona: { model?: string; system?: string } = {}
      for (const s of scopes) {
        if (s.model !== undefined) persona.model = s.model
        if (s.system !== undefined) persona.system = s.system
      }
      const context = inheritedContext([...scopes.map((s) => s.context), request.options.context])
      return {
        ...request,
        options: {
          ...persona,
          ...request.options,
          ...(context === undefined ? {} : { context }),
        },
      }
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
    const memory = memoryScopeOf(name)
    const scopeAccess = resolved.kind === "agent" ? resolveAccess(memory) : undefined
    const reached: ReachedStep = {
      id: { name, occurrence },
      name,
      kind: resolved.kind,
      actor: actorOfKind(resolved.kind),
      request: resolved,
      memoryScope: memoryScopeOf(name),
      ...(resolved.kind === "agent"
        ? {
            skills: resolveSkills(memory),
            access: foldedAccessFor(scopeAccess, resolved.options.file),
          }
        : {}),
      enteredAt: position.hash,
      truncated: (judgeCuts.get(resolved) ?? []).length > 0,
      scopeCalls: namedScopeCalls(),
    }
    if (resolved.kind === "agent") unfoldedAccess.set(reached, scopeAccess)
    trace.push(reached)
    return reached
  }

  const checkIdentity = (step: ReachedStep): string | undefined => {
    if (step.request.kind !== "agent") return undefined
    const identity: Identity = {
      model: step.request.options.model,
      system: step.request.options.system,
      skills: step.skills,
      access: unfoldedAccess.get(step),
    }
    const seen = personas.get(step.memoryScope)
    if (seen === undefined) {
      personas.set(step.memoryScope, identity)
      return undefined
    }
    return samePersona(seen, identity)
      ? undefined
      : `gtd: "${step.name}" runs with a different model, system prompt, skills or file access than an earlier agent step in memory scope "${step.memoryScope || "root"}" — one scope is one conversation, and a conversation has one identity`
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
    const error = unknownOptions(step) ?? approveConflict(step) ?? checkIdentity(step)
    return error === undefined ? undefined : { kind: "failed", message: error }
  }

  const missingApproval = (step: ReachedStep, commit: ParsedCommit, expected: string) => {
    if (step.request.kind !== "human" || step.request.options.approve !== true) return undefined
    const approved = commit.parsed.approved
    if (approved !== undefined && formatStepId(approved.step) === expected) return undefined
    return {
      kind: "divergence" as const,
      message: `gtd: commit ${short(commit.hash)} completes approval gate "${expected}" but records no Gtd-Approved for it — ${DIVERGED}`,
    }
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
    const unapproved = missingApproval(step, commit, expected)
    if (unapproved !== undefined) return finish(unapproved)
    cursor++
    advance(commit)
    if (commit.parsed.kept !== undefined) {
      if (commit.kept === undefined) keptTips.delete(step.name)
      else
        keptTips.set(step.name, {
          hash: commit.kept.hash,
          before: commit.tree,
          after: commit.kept.tree,
        })
    }
    const to = commit.parsed.parsed?.to
    if (to !== undefined) expectedNext = { name: to, hash: commit.hash }
    return replyFor(step.request, commit.parsed.judge)
  }

  const landPending = (step: ReachedStep, pending: NonNullable<typeof input.pending>): unknown => {
    pendingUsed = true
    landed = step
    // A kept turn is set aside: replay stays on the pre-turn tree, as it will once the marker lands.
    const keeping = step.request.kind === "agent" && step.request.options.keep === true
    if (keeping) {
      keptTips.set(step.name, { hash: "", before: position.tree, after: pending.tree })
    }
    advance({ hash: "", tree: keeping ? position.tree : pending.tree })
    return replyFor(step.request, pending.verdicts ?? [])
  }

  const answer = (step: ReachedStep): unknown => {
    while (cursor < commits.length && isAttemptAt(commits[cursor]!, step.name)) cursor++
    const commit = commits[cursor]
    if (commit !== undefined) return consumeCommit(step, commit)
    if (input.pending === undefined || pendingUsed) {
      return finish({
        kind: "rest",
        rest: step,
        trace,
        landed,
        marks,
        slices: slices.map((s) => ({ ...s })),
      })
    }
    return landPending(step, input.pending)
  }

  // Each layer on its own first, so a bad scope or workflow option is named as
  // such rather than blamed on the step it reached; then the merged limit.
  const scopeContextFault = (): string | undefined => {
    for (const [i, s] of scopes.entries()) {
      const fault = s.context === undefined ? undefined : contextLimitFault(s.context)
      if (fault !== undefined)
        return `the context of ${scopeLabel(scopes.slice(0, i + 1))}: ${fault}`
    }
    return undefined
  }

  const resolvedContextFault = (
    request: Extract<StepRequest, { kind: "agent" }>,
  ): string | undefined => {
    const own = request.options.context
    const layered = scopeContextFault() ?? (own === undefined ? undefined : contextLimitFault(own))
    if (layered !== undefined) return layered
    const resolved = resolve(request)
    const context = resolved.kind === "agent" ? resolved.options.context : undefined
    return context === undefined ? undefined : contextLimitFault(context)
  }

  // gtd.config.ts is loaded without a type check.
  const requestFault = (request: Exclude<StepRequest, { kind: "restart" }>): string | undefined => {
    if (request.kind === "run" && typeof request.body !== "string") {
      return `gtd: step "${scoped(request.name)}": a run() body is a shell script string — decide in flow code, then render the script (see checkScript and friends)`
    }
    if (request.kind !== "agent") return undefined
    const name = scoped(request.name)
    const contextFault = resolvedContextFault(request)
    if (contextFault !== undefined) return `gtd: step "${name}": ${contextFault}`
    if (request.options.keep === true) {
      // A clean allowEmpty keep would land an ordinary commit with no Gtd-Kept: a silent skip.
      if (request.options.allowEmpty === true) {
        return `gtd: step "${name}": keep: true cannot be combined with allowEmpty — a turn that changes nothing has nothing to keep`
      }
      // "/" would let one step's ref directory collide with another step's ref (git refuses `a` and `a/b` together).
      const refFault = name.includes("/") ? 'it contains "/"' : refNameFault(name)
      if (refFault !== undefined) {
        return `gtd: step "${name}": keep: true files the turn under a git ref named after the step, but ${refFault}`
      }
    }
    return scopeAccessFault()
  }

  const handleStep = async (request: StepRequest): Promise<unknown> => {
    if (outcome !== undefined) throw new Stop()
    if (request.kind === "restart") return finish(endOfFlow("restart"))
    if (typeof request.name !== "string" || request.name === "") {
      return finish({ kind: "failed", message: "gtd: a step was called without a name" })
    }
    const fault = requestFault(request)
    if (fault !== undefined) return finish({ kind: "failed", message: fault })
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
      : { kind: "ended", via, trace, landed, marks, slices: slices.map((s) => ({ ...s })) }

  const changesSince = (hash: string): readonly Change[] => {
    const tree = treeAt(hash)
    if (tree === undefined) {
      throw new Error(
        `gtd: changesSince(${hash}): ${hash} is not the episode base or one of its commits — pass a hash this run read from head() or start(), not one captured earlier, read from state, or from another branch`,
      )
    }
    return changesBetween(tree, position.tree)
  }

  const context: FlowContext = {
    step: handleStep,
    refuse: (message) => {
      outcome ??= { kind: "refused", message }
      signal?.()
      throw new Stop()
    },
    pushScope: (scope) => {
      scopes.push(scope)
      scopeCallIds.push(scopeCallCount++)
    },
    popScope: () => {
      scopes.pop()
      scopeCallIds.pop()
    },
    enterSlice: (name) => {
      if (outcome !== undefined) return
      const fail = (message: string): never => {
        void finish({ kind: "failed", message })
        throw new Stop()
      }
      if (typeof name !== "string" || !SLICE_NAME.test(name)) {
        fail(`gtd: slice "${name}": name must match ${SLICE_NAME}`)
      }
      if (name === IMPLICIT_SLICE) {
        fail(`gtd: slice "${IMPLICIT_SLICE}" is reserved for the implicit slice`)
      }
      const open = slices.find((s) => s.leftAt === undefined)
      if (open !== undefined) {
        fail(`gtd: slice "${name}" is entered inside slice "${open.name}" — slices do not nest`)
      }
      if (slices.some((s) => s.name === name)) {
        fail(
          `gtd: slice "${name}" is entered twice in this episode — a loop must sit inside its slice`,
        )
      }
      slices.push({ name, enteredAt: position.hash, leftAt: undefined })
    },
    leaveSlice: () => {
      if (outcome !== undefined) return
      const open = slices.find((s) => s.leftAt === undefined)
      if (open !== undefined) open.leftAt = position.hash
    },
    read: (path) => position.tree.read(path),
    glob: (pattern) => position.tree.paths().filter((path) => globMatches(path, pattern)),
    changes: () => changesBetween(previousPosition.tree, position.tree),
    changesSince,
    matches: globMatches,
    sections: (text) => headingSections(text),
    sectionBodies: (text) => headingSectionBodies(text),
    openQuestions: (text) => {
      const qa = steeringFormatFor("qa")
      return qa === undefined
        ? []
        : unansweredQuestions(qa, text).map((q) => ({
            question: q.question,
            line: q.headingLine + 1,
          }))
    },
    threads: (text) => {
      const { threads, findings } = parseThreadsWithFindings(text)
      return threads.map((t) => ({
        name: t.name,
        line: t.line + 1,
        waitingOn: t.waitingOn,
        faults: findings
          .filter((f) => f.message.startsWith(`Footnote thread "[^${t.name}]": `))
          .map((f) => f.message),
      }))
    },
    codeThreads: () =>
      changesBetween(
        treeAt(input.start) ?? input.startTree ?? input.episode.base.tree,
        position.tree,
      )
        .filter((c) => c.status !== "deleted")
        .flatMap((c) => {
          const { threads, findings } = parseCodeThreads(c.path, position.tree.read(c.path) ?? "")
          return threads.map((t) => ({
            path: t.path,
            line: t.line + 1,
            waitingOn: t.waitingOn,
            first: t.entries[0]?.text ?? "",
            faults: findings
              .filter((f) => f.message.startsWith(`Code thread at ${c.path}:${t.line + 1}: `))
              .map((f) => f.message),
          }))
        }),
    mark: (name, value) => {
      if (pendingUsed) marks.push({ name, value })
    },
    kept: (name) => {
      const tip = keptTips.get(scoped(name))
      return tip === undefined
        ? undefined
        : { hash: tip.hash, changes: changesBetween(tip.before, tip.after) }
    },
    vars: input.vars,
    env: input.env,
    start: () => input.start,
    skillsFor: (localName) => resolveSkills(memoryScopeOf(scoped(localName))) ?? [],
    accessFor: (localName, file) =>
      foldedAccessFor(resolveAccess(memoryScopeOf(scoped(localName))), file),
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
    // A pre-upgrade flow destructuring `{ entry }` reads `undefined` (an
    // ordinary start) instead of crashing.
    const flowDone = (input.flow as (a: object) => Promise<void>)({}).then(
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
          // By name, not instanceof: a workflow loading its own copy of the
          // flows facade throws that copy's class.
          message:
            error instanceof Error && error.name === "FlowsProtocolError"
              ? error.message
              : `gtd: the workflow threw: ${error instanceof Error ? error.message : String(error)}`,
        }
      },
    )
    // Replay runs on microtasks alone: a flow still unsettled once a macrotask
    // fires awaited something other than a step.
    const stuck = new Promise<void>((resolve) => setImmediate(resolve))
    await Promise.race([flowDone, settled, stuck])
    const mismatch = protocolMismatch()
    if (mismatch !== undefined) return { kind: "failed", message: mismatch.message }
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
