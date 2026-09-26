// The authoring surface of a gtd workflow. Every function here is a thin
// facade over the replay context the engine installs on `globalThis` — keyed by
// a registered symbol, not a module-local variable, so a copy of this file
// loaded through a user's `gtd.config.ts` (jiti) and the copy bundled into the
// gtd binary drive the same replay.

export type Actor = "agent" | "human" | "check" | "judge"

/** A steering-file declaration shared by the steps that rest on one. */
export interface SteeringOptions {
  /** The steering file, relative to `.gtd/`. */
  readonly file?: string
  /** The steering file's mode — a built-in name or a `modes:` entry. Requires `file`. */
  readonly mode?: string
  /** Refuse a turn whose only change deletes `file`. */
  readonly requireProgress?: boolean
  /** Refuse a turn that leaves a qa-mode `file` question unanswered. */
  readonly answerGate?: boolean
  /** Refuse a turn that did not revert the human's review-round edit. */
  readonly requireRevert?: boolean
  /** The commit that enters this step anchors the review window's diff base. */
  readonly reviewBase?: boolean
  /** Display name for drivers and viewers. */
  readonly label?: string
}

export interface PersonaOptions {
  readonly model?: string
  readonly system?: string
}

export interface AgentOptions extends SteeringOptions, PersonaOptions {
  /** Skills prose prepended through the `skillsPreamble` var. */
  readonly skills?: string
  /**
   * A turn that changes nothing completes the step. Without this an empty turn
   * is an attempt: recorded, but the process stays at the step (a stall).
   */
  readonly allowEmpty?: boolean
}

export interface HumanOptions extends SteeringOptions {
  readonly message?: string
}

export interface RunTools {
  readonly sh: (
    command: string,
  ) => Promise<{ readonly ok: boolean; readonly code: number; readonly output: string }>
  readonly fs: {
    readonly read: (path: string) => string | undefined
    readonly write: (path: string, content: string) => void
    readonly rm: (...paths: string[]) => void
    readonly exists: (path: string) => boolean
  }
}

/**
 * A `run` body: a POSIX sh script the driver executes verbatim, or a callback
 * `gtd exec` executes. Either way the outcome is whatever it leaves in the
 * tree — flow code reads it back through the helpers, never a return value.
 */
export type RunBody = string | ((tools: RunTools) => Promise<void> | void)

export interface RunOptions extends SteeringOptions {}

export type JudgePrimitive = "noul" | "choice" | "score"

export interface JudgeQuestion {
  readonly id: string
  readonly primitive: JudgePrimitive
  readonly instructions: string
  readonly criteria: string
}

export interface JudgeOptions extends SteeringOptions {
  /** The human-facing message a driver unaware of judge gates shows. */
  readonly message?: string
  /** The probability an answer must reach to count. Below it, the answer reads as `undefined`. */
  readonly minP?: number
}

/** One recorded answer. A `noul`'s boolean reads as `"yes"`/`"no"`, a `score` as its decimal string. */
export interface JudgeAnswer {
  readonly answer: string
  readonly p: number
}

export type StepRequest =
  | {
      readonly kind: "agent"
      readonly name: string
      readonly prompt: string
      readonly options: AgentOptions
    }
  | { readonly kind: "human"; readonly name: string; readonly options: HumanOptions }
  | {
      readonly kind: "run"
      readonly name: string
      readonly body: RunBody
      readonly options: RunOptions
    }
  | {
      readonly kind: "judge"
      readonly name: string
      readonly questions: readonly JudgeQuestion[]
      readonly evidence: unknown
      readonly options: JudgeOptions
    }
  | { readonly kind: "restart"; readonly name: string }

export interface Changes {
  readonly added: readonly string[]
  readonly modified: readonly string[]
  readonly deleted: readonly string[]
}

/** The engine side of the facade — see `installContext`. */
export interface FlowContext {
  readonly step: (request: StepRequest) => Promise<unknown>
  readonly refuse: (message: string) => never
  readonly pushScope: (prefix: string) => void
  readonly popScope: () => void
  readonly pushPersona: (persona: PersonaOptions) => void
  readonly popPersona: () => void
  readonly exists: (path: string) => boolean
  readonly read: (path: string) => string | undefined
  readonly glob: (pattern: string) => readonly string[]
  readonly changes: () => Changes
  readonly matches: (path: string, pattern: string) => boolean
  readonly tail: (pathOrContent: string, share: number) => string
  readonly previous: (path: string, since: string) => string | undefined
  readonly vars: Readonly<Record<string, string>>
  readonly refs: Refs
}

/** Commit positions a prompt names for an agent to inspect itself. */
export interface Refs {
  /** The process's diff base — its start, or the `--entry` base. */
  readonly start: string
  /** The commit the process rests on. */
  readonly head: string
  /** The review window's diff base. */
  readonly reviewBase: string
  /** The parent of the process's first commit. */
  readonly processBase: string
}

const CONTEXT_KEY = Symbol.for("@pmelab/gtd/flow-context")

type ContextHolder = { [CONTEXT_KEY]?: FlowContext | undefined }

/** Engine-only: install the replay context a flow run reads. */
export const installContext = (context: FlowContext | undefined): void => {
  ;(globalThis as ContextHolder)[CONTEXT_KEY] = context
}

const ctx = (): FlowContext => {
  const context = (globalThis as ContextHolder)[CONTEXT_KEY]
  if (context === undefined) {
    throw new Error("gtd: a workflow step or helper was called outside a gtd replay")
  }
  return context
}

// ── Steps ───────────────────────────────────────────────────────────────────

/** An agent turn: `prompt` is emitted, the driver lands the diff. */
export const agent = (name: string, prompt: string, options: AgentOptions = {}): Promise<void> =>
  ctx().step({ kind: "agent", name, prompt, options }) as Promise<void>

/** A human gate: the process rests until a person lands a turn. */
export const human = (name: string, options: HumanOptions = {}): Promise<void> =>
  ctx().step({ kind: "human", name, options }) as Promise<void>

/** A check: `body` runs at the edge and its effect on the tree is committed. */
export const run = (name: string, body: RunBody, options: RunOptions = {}): Promise<void> =>
  ctx().step({ kind: "run", name, body, options }) as Promise<void>

/**
 * A judge gate over one question. Resolves to the recorded answer, or
 * `undefined` when the turn landed without a verdict or the verdict's
 * probability fell short of `options.minP`.
 */
export function judge(
  name: string,
  question: JudgeQuestion,
  evidence: unknown,
  options?: JudgeOptions,
): Promise<string | undefined>
/** A judge gate over several questions. Resolves to every answer that cleared `options.minP`, by question id. */
export function judge(
  name: string,
  questions: readonly JudgeQuestion[],
  evidence: unknown,
  options?: JudgeOptions,
): Promise<Readonly<Record<string, JudgeAnswer>>>
export async function judge(
  name: string,
  question: JudgeQuestion | readonly JudgeQuestion[],
  evidence: unknown,
  options: JudgeOptions = {},
): Promise<string | undefined | Readonly<Record<string, JudgeAnswer>>> {
  const questions = Array.isArray(question) ? question : [question as JudgeQuestion]
  const answers = (await ctx().step({
    kind: "judge",
    name,
    questions,
    evidence,
    options,
  })) as Readonly<Record<string, JudgeAnswer>>
  if (Array.isArray(question)) return answers
  return answers[(question as JudgeQuestion).id]?.answer
}

/** End the episode from any depth. The next episode starts the default entry afresh. */
export const restart = (name: string): Promise<never> =>
  ctx().step({ kind: "restart", name }) as Promise<never>

/** Refuse the pending turn: nothing lands, the process stays where it rests. */
export const refuse = (message: string): never => ctx().refuse(message)

// ── Composition ─────────────────────────────────────────────────────────────

/** Prefix every step name reached inside `fn` with `prefix.` — also the memory scope of those steps. */
export const scope = async <T>(prefix: string, fn: () => Promise<T>): Promise<T> => {
  const context = ctx()
  context.pushScope(prefix)
  try {
    return await fn()
  } finally {
    context.popScope()
  }
}

/** Give every agent step inside `fn` this model and system prompt, unless the step sets its own. */
export const persona = async <T>(options: PersonaOptions, fn: () => Promise<T>): Promise<T> => {
  const context = ctx()
  context.pushPersona(options)
  try {
    return await fn()
  } finally {
    context.popPersona()
  }
}

// ── Helpers: pure reads of the commit at the replay position ───────────────

export const exists = (path: string): boolean => ctx().exists(path)

export const read = (path: string): string | undefined => ctx().read(path)

/** Every path in the tree matching `pattern` (`*` stays within a segment, `**` crosses them). */
export const glob = (pattern: string): readonly string[] => ctx().glob(pattern)

const filterChanged = (paths: readonly string[], pattern: string | undefined): readonly string[] =>
  pattern === undefined ? paths : paths.filter((path) => ctx().matches(path, pattern))

/** Paths the last step's commit added, modified, or deleted, optionally filtered by glob. */
export const changed = (pattern?: string): readonly string[] => {
  const { added: a, modified, deleted: d } = ctx().changes()
  return filterChanged([...a, ...modified, ...d], pattern)
}

export const added = (pattern?: string): readonly string[] =>
  filterChanged(ctx().changes().added, pattern)

export const modified = (pattern?: string): readonly string[] =>
  filterChanged(ctx().changes().modified, pattern)

export const deleted = (pattern?: string): readonly string[] =>
  filterChanged(ctx().changes().deleted, pattern)

/**
 * The end of a file (or of literal text, when no such path exists) bounded to
 * `share` of the `judgeBudgetBytes` budget, cut at a line boundary.
 */
export const tail = (pathOrContent: string, share: number): string =>
  ctx().tail(pathOrContent, share)

export const history = {
  /** `path` as the previous completion of step `since` left it — `undefined` before a second completion. */
  previous: (path: string, options: { readonly since: string }): string | undefined =>
    ctx().previous(path, options.since),
}

/** The merged workflow variables. Fragments take values as arguments instead of reading this. */
export const vars: Readonly<Record<string, string>> = new Proxy(
  {},
  {
    get: (_target, key) => (typeof key === "string" ? ctx().vars[key] : undefined),
    has: (_target, key) => typeof key === "string" && key in ctx().vars,
    ownKeys: () => Object.keys(ctx().vars),
    getOwnPropertyDescriptor: (_target, key) =>
      typeof key === "string" && key in ctx().vars
        ? { enumerable: true, configurable: true, value: ctx().vars[key] }
        : undefined,
  },
)

export const refs: Refs = {
  get start() {
    return ctx().refs.start
  },
  get head() {
    return ctx().refs.head
  },
  get reviewBase() {
    return ctx().refs.reviewBase
  },
  get processBase() {
    return ctx().refs.processBase
  },
}

// ── The workflow ────────────────────────────────────────────────────────────

export type Flow = () => Promise<void>

export interface EntryDef {
  readonly flow: Flow
  /** Resolves to the commitish that fixes the process's diff base when this entry is entered. */
  readonly base?: (vars: Readonly<Record<string, string>>) => string
}

export interface SummaryContext {
  readonly entryCommit: string
  readonly processBase: string
  readonly processTip: string
  readonly humanCommits: readonly { readonly hash: string; readonly state: string }[]
  readonly processCost: number
  readonly processCostByModel: readonly { readonly model: string; readonly cost: number }[]
  readonly vars: Readonly<Record<string, string>>
}

export interface WorkflowOptions {
  /** Variable defaults; `.gtdrc` `vars:`, `--var` and `GTD_<NAME>` override them. */
  readonly vars?: Readonly<Record<string, string>>
  /** `gtd summary`'s prompt. */
  readonly summary?: (context: SummaryContext) => string
}

export interface Workflow {
  readonly kind: "gtd-workflow"
  readonly entries: Readonly<Record<string, EntryDef>>
  readonly vars: Readonly<Record<string, string>>
  readonly summary?: (context: SummaryContext) => string
}

/** Map each `--entry` name to a flow. `default` is where a process starts when nothing else is asked for. */
export const workflow = (
  entries: { readonly default: Flow | EntryDef } & Readonly<Record<string, Flow | EntryDef>>,
  options: WorkflowOptions = {},
): Workflow => ({
  kind: "gtd-workflow",
  entries: Object.fromEntries(
    Object.entries(entries).map(([name, entry]) => [
      name,
      typeof entry === "function" ? { flow: entry } : entry,
    ]),
  ),
  vars: options.vars ?? {},
  ...(options.summary !== undefined ? { summary: options.summary } : {}),
})
