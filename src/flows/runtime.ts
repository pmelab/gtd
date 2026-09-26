// The authoring surface of a gtd workflow. Every function here is a thin
// facade over the replay context the engine installs on `globalThis` — keyed by
// a registered symbol, not a module-local variable, so a copy of this file
// loaded through a user's `gtd.config.ts` (jiti) and the copy bundled into the
// gtd binary drive the same replay.

/** A steering-file declaration shared by the steps that rest on one. */
export interface SteeringOptions {
  /** The steering file — a repository path under `.gtd/`. */
  readonly file?: string | undefined
  /** The steering file's mode — a built-in name or a `modes:` entry. Requires `file`. */
  readonly mode?: string | undefined
  /** Display name for drivers and viewers. */
  readonly label?: string | undefined
  /** The commit this step reviews changes since — what `gtd base` prints while it rests here. */
  readonly base?: string | undefined
}

export interface AgentOptions extends SteeringOptions {
  readonly model?: string | undefined
  readonly system?: string | undefined
  /** Skills prose prepended through the `skillsPreamble` var. */
  readonly skills?: string | undefined
  /**
   * A turn that changes nothing completes the step. Without this an empty turn
   * is an attempt: recorded, but the process stays at the step (a stall).
   */
  readonly allowEmpty?: boolean | undefined
}

export interface HumanOptions extends SteeringOptions {
  readonly message?: string | undefined
  /**
   * A landing that changes nothing completes the gate — accepting as-is.
   * Without this a clean landing is a no-op: the gate waits for a change.
   */
  readonly acceptClean?: boolean | undefined
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
 * tree — flow code reads it back through `changes()` and `read()`.
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

export interface JudgeSpec {
  readonly questions: readonly JudgeQuestion[]
  /** What the judge sees. The `judgeBudgetBytes` budget is split evenly across the keys; a value over its share keeps its end. */
  readonly evidence: Readonly<Record<string, string>>
  /** The human-facing message a driver unaware of judge gates shows. */
  readonly message?: string | undefined
  readonly label?: string | undefined
}

/** One recorded answer. A `noul`'s boolean reads as `"yes"`/`"no"`, a `score` as its decimal string. */
export interface JudgeAnswer {
  readonly answer: string
  readonly p: number
}

export interface Judgment {
  /** Every question's answer, `undefined` when the turn landed without a verdict for it. */
  readonly answers: Readonly<Record<string, JudgeAnswer | undefined>>
  /** The evidence keys the budget cut. */
  readonly truncated: readonly string[]
}

/** One path the last step changed. */
export interface Change {
  readonly path: string
  readonly status: "added" | "modified" | "deleted"
  /** The content before the step, `undefined` when the step added the path. */
  readonly before: string | undefined
  /** The content the step left, `undefined` when the step deleted the path. */
  readonly after: string | undefined
}

export interface Changes extends ReadonlyArray<Change> {
  readonly paths: readonly string[]
  readonly get: (path: string) => Change | undefined
}

export interface ScopeOptions {
  /** Prefixes every step name inside, and so names their memory scope. */
  readonly name?: string | undefined
  /** The model every agent step inside runs with, unless it sets its own. */
  readonly model?: string | undefined
  /** The system prompt every agent step inside runs with, unless it sets its own. */
  readonly system?: string | undefined
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
      readonly evidence: Readonly<Record<string, string>>
      readonly options: SteeringOptions & { readonly message?: string | undefined }
    }
  | { readonly kind: "restart" }

/** The engine side of the facade — see `installContext`. */
export interface FlowContext {
  readonly step: (request: StepRequest) => Promise<unknown>
  readonly refuse: (message: string) => never
  readonly pushScope: (scope: ScopeOptions) => void
  readonly popScope: () => void
  readonly read: (path: string) => string | undefined
  readonly glob: (pattern: string) => readonly string[]
  /** The last step's changes, content read on demand. */
  readonly changes: () => readonly Change[]
  readonly matches: (path: string, pattern: string) => boolean
  readonly sections: (text: string) => readonly string[]
  readonly openQuestions: (text: string) => readonly OpenQuestion[]
  readonly vars: Readonly<Record<string, string>>
  readonly head: () => string
  readonly start: () => string
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

/** A judge gate: resolves to what the judge answered, for the flow to decide on. */
export const judge = (name: string, spec: JudgeSpec): Promise<Judgment> => {
  const { questions, evidence, ...options } = spec
  return ctx().step({ kind: "judge", name, questions, evidence, options }) as Promise<Judgment>
}

/** End the episode from any depth. The next episode starts the flow afresh. */
export const restart = (): Promise<never> => ctx().step({ kind: "restart" }) as Promise<never>

/** Refuse the pending turn: nothing lands, the process stays where it rests. */
export const refuse = (message: string): never => ctx().refuse(message)

// ── Composition ─────────────────────────────────────────────────────────────

/**
 * Run `fn` inside a scope: `scope("build", fn)` prefixes every step name with
 * `build.` (also their memory scope); an object may add the model and system
 * prompt its agent steps run with.
 */
export const scope = async <T>(scope: string | ScopeOptions, fn: () => Promise<T>): Promise<T> => {
  const context = ctx()
  context.pushScope(typeof scope === "string" ? { name: scope } : scope)
  try {
    return await fn()
  } finally {
    context.popScope()
  }
}

// ── Reads of the commit replay stands on ────────────────────────────────────

export const read = (path: string): string | undefined => ctx().read(path)

/** Every path in the tree matching `pattern` (`*` stays within a segment, `**` crosses them). */
export const glob = (pattern: string): readonly string[] => ctx().glob(pattern)

/** What the last step changed, optionally only the paths matching a glob. */
export const changes = (pattern?: string): Changes => {
  const context = ctx()
  const all = context.changes()
  const list = pattern === undefined ? all : all.filter((c) => context.matches(c.path, pattern))
  return Object.freeze(
    Object.assign([...list], {
      paths: list.map((c) => c.path),
      get: (path: string) => list.find((c) => c.path === path),
    }),
  )
}

/** The commit the process stands on at this point of the flow. */
export const head = (): string => ctx().head()

/** The process's diff base: the commit before it began, or the base `gtd --entry` fixed. */
export const start = (): string => ctx().start()

/** The merged workflow variables. */
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

// ── Text utilities ──────────────────────────────────────────────────────────

/** The top-level `## ` heading texts of markdown `text`. */
export const sections = (text: string): readonly string[] => ctx().sections(text)

export interface OpenQuestion {
  readonly question: string
  /** The 1-based line of the question's heading. */
  readonly line: number
}

/** The qa-format questions in `text` that are still unanswered. */
export const openQuestions = (text: string): readonly OpenQuestion[] => ctx().openQuestions(text)

// ── The workflow ────────────────────────────────────────────────────────────

export interface FlowArgs {
  /** The name `gtd --entry <name>` started the process with; `undefined` for an ordinary start. */
  readonly entry: string | undefined
}

/**
 * A workflow's one flow. A flow that never reads `entry` accepts no
 * `--entry`; one that does decides for itself which names it honours,
 * `refuse()`-ing the rest.
 */
export type Flow = (args: FlowArgs) => Promise<void>

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
  /**
   * The commitish that fixes the diff base of a process `gtd --entry <entry>`
   * starts, or `undefined` for none. Runs when the process is entered, with
   * the vars `--var` sets.
   */
  readonly base?: (entry: string, vars: Readonly<Record<string, string>>) => string | undefined
}

export interface Workflow {
  readonly kind: "gtd-workflow"
  readonly flow: Flow
  readonly vars: Readonly<Record<string, string>>
  readonly summary?: (context: SummaryContext) => string
  readonly base?: (entry: string, vars: Readonly<Record<string, string>>) => string | undefined
}

export const workflow = (flow: Flow, options: WorkflowOptions = {}): Workflow => ({
  kind: "gtd-workflow",
  flow,
  vars: options.vars ?? {},
  ...(options.summary !== undefined ? { summary: options.summary } : {}),
  ...(options.base !== undefined ? { base: options.base } : {}),
})
