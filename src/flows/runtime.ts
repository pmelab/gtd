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
  /**
   * A turn that changes nothing completes the step. Without this an empty turn
   * is an attempt: recorded, but the process stays at the step (a stall).
   */
  readonly allowEmpty?: boolean | undefined
  /** The skill names this turn declares — what `gtd next --json`'s `skills` key carries. */
  readonly skills?: readonly string[] | undefined
}

export interface HumanOptions extends SteeringOptions {
  readonly message?: string | undefined
  /**
   * A landing that changes nothing completes the gate — accepting as-is.
   * Without this a clean landing is a no-op: the gate waits for a change.
   */
  readonly acceptClean?: boolean | undefined
}

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
      readonly body: string
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
  /** Every change from the tree at `hash` to the tree replay stands on. Throws when `hash` resolves to neither. */
  readonly changesSince: (hash: string) => readonly Change[]
  readonly matches: (path: string, pattern: string) => boolean
  readonly sections: (text: string) => readonly string[]
  readonly sectionBodies: (text: string) => readonly Section[]
  readonly openQuestions: (text: string) => readonly OpenQuestion[]
  readonly threads: (text: string) => readonly ThreadInfo[]
  readonly codeThreads: () => readonly CodeThreadInfo[]
  readonly vars: Readonly<Record<string, string>>
  readonly env: Readonly<Record<string, string>>
  readonly head: () => string
  readonly start: () => string
  /**
   * The skill list `localName` (scoped from here, same as `agent()`) resolves
   * to — for a prompt preamble. `ownSkills`, when given, is the same
   * precedence tier as a call's own `skills` option: it stands in for the
   * bundled default when there isn't one, but a `.gtdrc` entry still beats
   * it. Shares its resolution with `agent()`'s own wire resolver (both read
   * `Workflow.ts`'s `configuredSkills`/`skills`), so the two can never drift.
   */
  readonly skillsFor: (localName: string, ownSkills?: readonly string[]) => readonly string[]
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
export const run = (name: string, body: string, options: RunOptions = {}): Promise<void> =>
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

const toChanges = (list: readonly Change[]): Changes =>
  Object.freeze(
    Object.assign([...list], {
      paths: list.map((c) => c.path),
      get: (path: string) => list.find((c) => c.path === path),
    }),
  )

/** What the last step changed, optionally only the paths matching a glob. */
export const changes = (pattern?: string): Changes => {
  const context = ctx()
  const all = context.changes()
  return toChanges(
    pattern === undefined ? all : all.filter((c) => context.matches(c.path, pattern)),
  )
}

/**
 * Every change from the tree at `hash` to the tree replay stands on — this
 * package's own range, when `hash` is captured at its first step. `hash` must
 * be the episode's base or one of its commits; anything else fails the step.
 */
export const changesSince = (hash: string, pattern?: string): Changes => {
  const context = ctx()
  const all = context.changesSince(hash)
  return toChanges(
    pattern === undefined ? all : all.filter((c) => context.matches(c.path, pattern)),
  )
}

/** The commit the process stands on at this point of the flow. */
export const head = (): string => ctx().head()

/** The process's diff base: the commit before it began, or the base `gtd --entry` fixed. */
export const start = (): string => ctx().start()

/** The skill list `localName` (scoped from here, same as `agent()`) resolves to — for a prompt preamble. See `FlowContext.skillsFor` for `ownSkills`. */
export const skillsFor = (localName: string, ownSkills?: readonly string[]): readonly string[] =>
  ctx().skillsFor(localName, ownSkills)

const settingsProxy = (
  read: () => Readonly<Record<string, string>>,
): Readonly<Record<string, string>> =>
  new Proxy(
    {},
    {
      get: (_target, key) => (typeof key === "string" ? read()[key] : undefined),
      has: (_target, key) => typeof key === "string" && key in read(),
      ownKeys: () => Object.keys(read()),
      getOwnPropertyDescriptor: (_target, key) =>
        typeof key === "string" && key in read()
          ? { enumerable: true, configurable: true, value: read()[key] }
          : undefined,
    },
  )

/** The process settings: pinned at process start, so flow code may branch on them. */
export const vars: Readonly<Record<string, string>> = settingsProxy(() => ctx().vars)

/**
 * The environment settings: resolved live on every invocation. Flow code must
 * read them only where they cannot change the next step (step options, script
 * bodies) — replay cannot enforce this.
 */
export const env: Readonly<Record<string, string>> = settingsProxy(() => ctx().env)

// ── Text utilities ──────────────────────────────────────────────────────────

/** The top-level `## ` heading texts of markdown `text`. */
export const sections = (text: string): readonly string[] => ctx().sections(text)

export interface Section {
  readonly title: string
  /** The section's own markdown, its heading line included. */
  readonly body: string
}

/** The top-level `## ` sections of markdown `text`, each with its own markdown. */
export const sectionBodies = (text: string): readonly Section[] => ctx().sectionBodies(text)

export interface OpenQuestion {
  readonly question: string
  /** The 1-based line of the question's heading. */
  readonly line: number
}

export interface ThreadInfo {
  readonly name: string
  /** The 1-based line of the thread's `[^name]:` definition. */
  readonly line: number
  /** `"human"` means the last entry is the agent's: the thread is open. */
  readonly waitingOn: "human" | "agent"
  /** Syntax faults, each already prefixed `Footnote thread "[^name]":`. */
  readonly faults: readonly string[]
}

/** Every `H:`/`A:` thread (a footnote) in `text`. */
export const threads = (text: string): readonly ThreadInfo[] => ctx().threads(text)

export interface CodeThreadInfo {
  readonly path: string
  /** The 1-based line of the thread's first comment line. */
  readonly line: number
  /** `"human"` means the last entry is the agent's: the thread is open. */
  readonly waitingOn: "human" | "agent"
  /** The text of the opening `H:` entry. */
  readonly first: string
  /** Syntax faults, each already prefixed `Code thread at <path>:<line>:`. */
  readonly faults: readonly string[]
}

/** Every `H:`/`A:` thread in line comments of the files changed since the process's diff base. */
export const codeThreads = (): readonly CodeThreadInfo[] => ctx().codeThreads()

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
  readonly env: Readonly<Record<string, string>>
}

/** `gtd summary`'s prompt — a workflow module's optional `summary` export. */
export type Summary = (context: SummaryContext) => string

/**
 * A workflow module's optional `base` export: the commitish that fixes the
 * diff base of a process `gtd --entry <entry>` starts, or `undefined` for
 * none. Runs when the process is entered, with the vars `--var` sets.
 */
export type EntryBase = (
  entry: string,
  vars: Readonly<Record<string, string>>,
) => string | undefined
