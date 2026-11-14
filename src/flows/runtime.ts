// The authoring surface of a gtd workflow. Every function here is a thin
// facade over the replay context the engine installs on `globalThis` — keyed by
// a registered symbol, not a module-local variable, so a copy of this file
// a user's `gtd.config.ts` brings along and the copy bundled into the
// gtd binary drive the same replay.
import type { WorkflowBuild } from "./factory.js"

interface SteeringCommon {
  /** Display name for drivers and viewers. */
  readonly label?: string | undefined
  /** The commit this step reviews changes since — what `gtd base` prints while it rests here. */
  readonly base?: string | undefined
}

/** A step's steering file, read as widgets. */
type SteeringFile = {
  /** The steering file — a repository path under `.gtd/`. */
  readonly file?: string | undefined
}

/** A steering-file declaration shared by the steps that rest on one. */
export type SteeringOptions = SteeringCommon & SteeringFile

/** What a validator is told about the work so far. */
export interface ValidateTurn {
  /** Every change since before the first try, minus the files the validator's own steps wrote. */
  readonly changes: Changes
}

export type ValidateResult = string | readonly string[] | undefined

interface AgentCommon {
  readonly model?: string | undefined
  readonly system?: string | undefined
  /** With `file`: the widget kinds the steering file may hold. Static content is always allowed. */
  readonly widgets?: readonly WidgetKind[] | undefined
  /** With `file`: every change since the review base must be listed by a 🔍 widget. */
  readonly coverage?: boolean | undefined
  /** Runs after each landed turn; errors it returns become the correction the next try gets. Only `check`, `run` and `judge` may run inside. */
  readonly validate?: ((turn: ValidateTurn) => Promise<ValidateResult>) | undefined
  /** Retries before `exhausted` runs. Default 3. */
  readonly cap?: number | undefined
  /** Runs once `cap` retries failed; default rests at a `<name>.invalid` gate. The validator then runs again. */
  readonly exhausted?: ((errors: readonly string[]) => Promise<void>) | undefined
  /** The retry's `content`, instead of the default lead-in plus the errors. */
  readonly correction?: ((errors: readonly string[]) => string) | undefined
}

export type AgentOptions = SteeringOptions &
  AgentCommon &
  (
    | {
        /**
         * A turn that changes nothing completes the step. Without this an empty turn
         * is an attempt: recorded, but the process stays at the step (a stall).
         */
        readonly allowEmpty?: boolean | undefined
        readonly keep?: false | undefined
      }
    | {
        /**
         * Set the turn aside: its tip goes to `refs/gtd/kept/<entry>/<step>/<hash>` and the
         * branch stays where it was, a marker commit recording that the step ran.
         * The step's full name must be usable as a git ref component. Excludes `allowEmpty`.
         */
        readonly keep: true
        readonly allowEmpty?: false | undefined
      }
  )

interface HumanCommon {
  readonly message?: string | undefined
  /**
   * A landing that changes nothing completes the gate — accepting as-is.
   * Without this a clean landing is a no-op: the gate waits for a change.
   */
  readonly acceptClean?: boolean | undefined
}

export type HumanOptions = HumanCommon &
  (
    | (SteeringOptions & { readonly approve?: false | undefined })
    | (SteeringCommon & {
        /**
         * A sign-off gate: only a clean landing completes it, and that commit
         * carries `Gtd-Approved: {"step":"<step>#<n>","name":"<name>","email":"<email>"}`.
         * A dirty landing is refused. Implies `acceptClean`. Excludes `file`:
         * an approval records exactly the judged tree.
         */
        readonly approve: true
        readonly file?: undefined
      })
  )

/** A step that rests on no steering file. */
type NoSteeringFile = { readonly file?: undefined }

export type RunOptions = SteeringCommon &
  NoSteeringFile & {
    /**
     * `"rest"`: a non-zero exit is recorded in the tree and the process rests at
     * the step as `stalled`; any tree change runs the script again, and only a
     * zero exit advances. Without it a failing body lands and the flow carries on.
     */
    readonly onFail?: "rest" | undefined
  }

/** A ship step rests on no steering file. */
export type ShipOptions = SteeringCommon & NoSteeringFile

export type JudgePrimitive = "noul" | "choice" | "score"

export interface JudgeQuestion {
  readonly id: string
  readonly primitive: JudgePrimitive
  readonly instructions: string
  readonly criteria: string
}

/** A question as `judge()` takes it: `"yesno"` is another name for `"noul"`. */
export interface JudgeQuestionInput<Id extends string = string> extends Omit<
  JudgeQuestion,
  "id" | "primitive"
> {
  readonly id: Id
  readonly primitive: JudgePrimitive | "yesno"
}

export type JudgeSpec<Q extends readonly JudgeQuestionInput[] = readonly JudgeQuestion[]> =
  SteeringCommon &
    NoSteeringFile & {
      readonly questions: Q
      /** What the judge sees. The `judgeBudgetBytes` budget is split evenly across the keys; a value over its share keeps its end. */
      readonly evidence: Readonly<Record<string, string>>
      /** The human-facing message a driver unaware of judge gates shows. */
      readonly message?: string | undefined
    }

/** One recorded answer. A `noul`'s boolean reads as `"yes"`/`"no"`, a `score` as its decimal string. */
export interface JudgeAnswer {
  readonly answer: string
  readonly p: number
}

export interface Judgment<Id extends string = string> {
  /**
   * Every question's answer, `undefined` when the turn landed without a verdict for it.
   * Keyed by the question ids: literal ids allow only themselves, a computed id reads as any string.
   */
  readonly answers: Readonly<Record<Id, JudgeAnswer | undefined>>
  /** The evidence keys the budget cut. */
  readonly truncated: readonly string[]
}

/** One path the last step changed. */
export interface Change {
  readonly path: string
  readonly status: "added" | "modified" | "deleted"
  /** The content before the step, `undefined` when the step added the path or it could not be read. */
  readonly before: string | undefined
  /** The content the step left, `undefined` when the step deleted the path or it could not be read. */
  readonly after: string | undefined
}

export interface Changes extends ReadonlyArray<Change> {
  readonly paths: readonly string[]
  readonly get: (path: string) => Change | undefined
}

/** Glob arrays in the `glob()`/`changes()` dialect. A missing side is unrestricted, `[]` allows nothing; `write` grants no read. */
export interface ScopeAccess {
  readonly read?: readonly string[] | undefined
  readonly write?: readonly string[] | undefined
}

/** A workflow's `access` option: scope full name -> access, or a function of the process settings returning that. */
export type AccessExport =
  | Readonly<Record<string, ScopeAccess>>
  | ((vars: Settings) => Readonly<Record<string, ScopeAccess>>)

/** A workflow's `skills` option: scope full name -> skill names, or a function of the process settings returning that. */
export type SkillsExport =
  | Readonly<Record<string, readonly string[]>>
  | ((vars: Settings) => Readonly<Record<string, readonly string[]>>)

/** Settings as flow code reads them; `K` narrows to the names a workflow declares. */
export type Settings<K extends string = string> = Readonly<Record<K, string>>

/** A resolved access: `null` is an unrestricted side. */
export interface AccessDef {
  readonly read: readonly string[] | null
  readonly write: readonly string[] | null
}

export interface ScopeOptions {
  /** Prefixes every step name inside, and so names their memory scope. */
  readonly name?: string | undefined
  /** The model every agent step inside runs with, unless it sets its own. */
  readonly model?: string | undefined
  /** The system prompt every agent step inside runs with, unless it sets its own. */
  readonly system?: string | undefined
  /** The skill names every agent step inside declares — `gtd next --json`'s `skills`. A nested scope inherits it unless it sets its own. */
  readonly skills?: readonly string[] | undefined
  /** The file access every agent step inside runs with — `gtd next --json`'s `access`. A nested scope inherits it; its own replaces it wholesale. */
  readonly access?: ScopeAccess | undefined
}

export type StepRequest =
  | {
      readonly kind: "agent"
      readonly name: string
      readonly prompt: string
      readonly options: AgentOptions
      /** On a validator retry: the step's original prompt (`prompt` is then the correction). */
      readonly original?: string
    }
  | { readonly kind: "human"; readonly name: string; readonly options: HumanOptions }
  | {
      readonly kind: "run"
      readonly name: string
      readonly body: string
      readonly options: RunOptions
    }
  | {
      readonly kind: "ship"
      readonly name: string
      readonly message: string
      readonly options: ShipOptions
    }
  | {
      readonly kind: "judge"
      readonly name: string
      readonly questions: readonly JudgeQuestion[]
      readonly evidence: Readonly<Record<string, string>>
      readonly options: SteeringCommon & NoSteeringFile & { readonly message?: string | undefined }
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
  readonly widgets: (text: string) => readonly Widget[]
  /** Everything a steering step's turn must still fix in `file`, as `file:line: message` lines. */
  readonly steeringFindings: (file: string, options: SteeringCheck) => readonly string[]
  readonly vars: Readonly<Record<string, string>>
  readonly env: Readonly<Record<string, string>>
  readonly head: () => string
  readonly start: () => string
  /** The skill list the memory scope `localName` lands in resolves to — the same resolver as the wire's `skills`. */
  readonly skillsFor: (localName: string) => readonly string[]
  /** The folded access the memory scope `localName` lands in resolves to; `file` is the step's own steering file. */
  readonly accessFor: (localName: string, file?: string) => AccessDef
  /** Absent on an engine older than `mark`; FLOWS_PROTOCOL stays 1. */
  readonly mark?: (name: string, value: string) => void
  /** Absent on an engine older than `kept`. */
  readonly kept?: (
    name: string,
  ) => { readonly hash: string; readonly changes: readonly Change[] } | undefined
}

/**
 * Bump only when the installed `FlowContext` object changes shape or semantics;
 * type-only authoring-API changes don't count. A bump past 1 must keep v1
 * members working or move the context to a new symbol key — pre-handshake
 * facades never read the protocol.
 */
export const FLOWS_PROTOCOL = 2

export class FlowsProtocolError extends Error {
  constructor(engine: number, flows: number) {
    const upgrade =
      engine < flows
        ? "upgrade the gtd that runs it"
        : "upgrade the @pmelab/gtd the workflow imports"
    super(
      `gtd: the workflow speaks flows protocol ${flows}, but the engine installed protocol ${engine} — ${upgrade}`,
    )
    this.name = "FlowsProtocolError"
  }
}

const CONTEXT_KEY = Symbol.for("@pmelab/gtd/flow-context")
// Separate from the context so a facade older than the protocol still reads
// the context it expects.
const PROTOCOL_KEY = Symbol.for("@pmelab/gtd/flow-protocol")
// The first mismatch, kept for the engine: workflow code may catch what ctx()
// throws, and the refusal must still win.
const MISMATCH_KEY = Symbol.for("@pmelab/gtd/flow-protocol-mismatch")

type ContextHolder = {
  [CONTEXT_KEY]?: FlowContext | undefined
  [PROTOCOL_KEY]?: number | undefined
  [MISMATCH_KEY]?: Error | undefined
}

/** Engine-only. */
export const installContext = (context: FlowContext | undefined): void => {
  const holder = globalThis as ContextHolder
  holder[CONTEXT_KEY] = context
  holder[PROTOCOL_KEY] = FLOWS_PROTOCOL
  holder[MISMATCH_KEY] = undefined
}

/** Engine-only: the mismatch a facade copy hit during this replay, if any. */
export const protocolMismatch = (): Error | undefined => (globalThis as ContextHolder)[MISMATCH_KEY]

const ctx = (): FlowContext => {
  const holder = globalThis as ContextHolder
  const context = holder[CONTEXT_KEY]
  if (context === undefined) {
    throw new Error("gtd: a workflow step or helper was called outside a gtd replay")
  }
  // An engine older than the handshake installs no number but the context
  // protocol 1 describes.
  const protocol = holder[PROTOCOL_KEY] ?? 1
  if (protocol !== FLOWS_PROTOCOL) {
    const error = new FlowsProtocolError(protocol, FLOWS_PROTOCOL)
    holder[MISMATCH_KEY] ??= error
    throw error
  }
  return context
}

// ── Steps ───────────────────────────────────────────────────────────────────

// While a validator runs: its step's name, and the paths its own steps changed. Keyed by the
// replay's context: a validator suspended at a rest never unwinds, so a global would leak.
type Validating = { readonly name: string; readonly paths: Set<string> }
const validatingBy = new WeakMap<FlowContext, Validating>()

const DEFAULT_CAP = 3

const noValidatorStep = (kind: string, name: string): void => {
  const validating = validatingBy.get(ctx())
  if (validating !== undefined) {
    throw new Error(
      `gtd: step "${name}": ${kind}() cannot run inside the validator of "${validating.name}" — a validator may only run check, run and judge steps`,
    )
  }
}

const noteValidatorPaths = (): void => {
  const validating = validatingBy.get(ctx())
  if (validating !== undefined) for (const c of ctx().changes()) validating.paths.add(c.path)
}

const errorList = (result: ValidateResult): readonly string[] =>
  result === undefined ? [] : typeof result === "string" ? [result] : result

/**
 * A steering step's own validator, in front of the workflow's: the file must
 * exist and hold valid widgets, and the turn may change nothing else.
 */
const withSteeringCheck = (options: AgentOptions): AgentOptions["validate"] => {
  const { file, validate } = options
  if (file === undefined || options.keep === true) return validate
  return async (turn) => {
    const others = turn.changes.paths.filter((path) => path !== file)
    const errors = [
      ...ctx().steeringFindings(file, {
        base: options.base,
        widgets: options.widgets,
        coverage: options.coverage,
      }),
      ...(others.length === 0
        ? []
        : [
            `this step writes only ${file}; undo your changes to ${others.join(", ")} — say what should change in ${file} instead`,
          ]),
    ]
    if (errors.length > 0) return errors
    return validate === undefined ? undefined : validate(turn)
  }
}

/** An agent turn: `prompt` is emitted, the driver lands the diff. */
export const agent = async (
  name: string,
  prompt: string,
  options: AgentOptions = {},
): Promise<void> => {
  noValidatorStep("agent", name)
  const context = ctx()
  const { cap = DEFAULT_CAP, exhausted, correction } = options
  const validate = withSteeringCheck(options)
  const base = typeof validate === "function" ? context.head() : ""
  await context.step({ kind: "agent", name, prompt, options })
  if (typeof validate !== "function") return

  const own = new Set<string>()
  // Paths an agent turn or a person changed. Whatever changed since the last validator returned
  // is theirs — even on a path a validator `run` (lint --fix) wrote in an earlier round.
  const agentPaths = new Set<string>()
  let validated = base
  const validateNow = async (): Promise<readonly string[]> => {
    for (const c of context.changesSince(validated)) agentPaths.add(c.path)
    const turn: ValidateTurn = {
      get changes() {
        return toChanges(
          context.changesSince(base).filter((c) => !own.has(c.path) || agentPaths.has(c.path)),
        )
      },
    }
    validatingBy.set(context, { name, paths: own })
    try {
      return errorList(await scope(`${name}.validate`, () => validate(turn)))
    } finally {
      validatingBy.delete(context)
      validated = context.head()
    }
  }

  let errors = await validateNow()
  let retries = 0
  while (errors.length > 0) {
    if (retries >= cap) {
      if (exhausted !== undefined) await exhausted(errors)
      else await human(`${name}.invalid`, errors.join("\n"), { acceptClean: true })
      retries = 0
    } else {
      retries++
      const text =
        correction !== undefined
          ? correction(errors)
          : `The result did not pass validation. Fix these errors:\n\n${errors.join("\n")}\n`
      await context.step({ kind: "agent", name, prompt: text, options, original: prompt })
    }
    errors = await validateNow()
  }
}

// `Omit` over a union collapses it; this keeps each member's own rules.
type OmitEach<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export interface Human {
  /** `message` is what the person sees, so `options` take none. */
  (name: string, message: string, options?: OmitEach<HumanOptions, "message">): Promise<void>
  (name: string, options?: HumanOptions): Promise<void>
}

/** A human gate: the process rests until a person lands a turn. */
export const human: Human = (
  name: string,
  messageOrOptions?: string | HumanOptions,
  options?: OmitEach<HumanOptions, "message">,
): Promise<void> => {
  noValidatorStep("human", name)
  return ctx().step({
    kind: "human",
    name,
    options:
      typeof messageOrOptions === "string"
        ? { ...options, message: messageOrOptions }
        : (messageOrOptions ?? {}),
  }) as Promise<void>
}

/** A check: `body` runs at the edge and its effect on the tree is committed. */
export const run = async (name: string, body: string, options: RunOptions = {}): Promise<void> => {
  await ctx().step({ kind: "run", name, body, options })
  noteValidatorPaths()
}

/**
 * Squashes HEAD's tree, with `.gtd/` as the user's branch has it, into one commit on the user's branch
 * with `message`, and moves that branch there; HEAD stays on `gtd/<b>`.
 * Resolves to the new commit's hash, or `undefined` when nothing shipped.
 */
export const ship = (
  name: string,
  message: string,
  options: ShipOptions = {},
): Promise<string | undefined> => {
  noValidatorStep("ship", name)
  return ctx().step({ kind: "ship", name, message, options }) as Promise<string | undefined>
}

/** A judge gate: resolves to what the judge answered, for the flow to decide on. */
export const judge = <const Q extends readonly JudgeQuestionInput[] = readonly JudgeQuestion[]>(
  name: string,
  spec: JudgeSpec<Q>,
): Promise<Judgment<Q[number]["id"]>> => {
  const { questions, evidence, ...options } = spec
  // Normalized here, so the engine and every driver only ever see `noul`.
  const canonical = questions.map((q) =>
    q.primitive === "yesno" ? { ...q, primitive: "noul" as const } : (q as JudgeQuestion),
  )
  return ctx()
    .step({
      kind: "judge",
      name,
      questions: canonical,
      evidence,
      options,
    })
    .then((judgment) => {
      noteValidatorPaths()
      return judgment as Judgment<Q[number]["id"]>
    })
}

/** End the episode from any depth. The next episode starts the flow afresh. */
export const restart = (): Promise<never> => {
  noValidatorStep("restart", "restart")
  return ctx().step({ kind: "restart" }) as Promise<never>
}

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

/** Whether `path` matches `pattern` in the `glob()`/`changes()` dialect. */
export const matches = (path: string, pattern: string): boolean => ctx().matches(path, pattern)

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

export interface KeptTip {
  /** The kept commit. `""` while the keeping turn is still pending (a landing decision): never branch on it, the landed replay sees the real hash. */
  readonly hash: string
  /** The kept tip against the commit it diverged from. */
  readonly changes: Changes
}

/**
 * The latest kept tip of step `name` (scoped from here, same as `agent()`) in
 * this episode, or `undefined` when none.
 */
export const kept = (name: string): KeptTip | undefined => {
  const context = ctx()
  // FLOWS_PROTOCOL stays 1, so an older engine's context simply lacks `kept`.
  if (typeof context.kept !== "function") {
    throw new Error("gtd: kept() needs a newer gtd — upgrade the gtd that runs it")
  }
  const tip = context.kept(name)
  return tip === undefined ? undefined : { hash: tip.hash, changes: toChanges(tip.changes) }
}

export interface Mark {
  readonly name: string
  readonly value: string
}

const MARK_NAME = /^[a-z][a-z0-9-]*$/
const MARK_VALUE =
  // eslint-disable-next-line no-control-regex -- the control range IS the point
  /^[^\s\x00-\x1f\x7f-\x9f\u2028\u2029]([^\x00-\x1f\x7f-\x9f\u2028\u2029]*[^\s\x00-\x1f\x7f-\x9f\u2028\u2029])?$/

/**
 * Record a fact on the landing that leaves the current rest: one
 * `Gtd-Mark: <name>=<value>` trailer per call, in call order. Throws on an
 * invalid name or value (a newline would inject a trailer) and on an older engine.
 * A settled no-op landing (a clean script step landing on itself) drops its marks.
 */
export const mark = (name: string, value: string): void => {
  const context = ctx()
  if (typeof context.mark !== "function") {
    throw new Error("gtd: mark() needs a newer gtd — upgrade the gtd that runs it")
  }
  if (!MARK_NAME.test(name)) {
    throw new Error(`gtd: mark(): name ${JSON.stringify(name)} must match ${MARK_NAME}`)
  }
  if (!MARK_VALUE.test(value)) {
    throw new Error(
      `gtd: mark(${name}): value must be one line, no control characters, no surrounding whitespace`,
    )
  }
  context.mark(name, value)
}

/** The commit the process stands on at this point of the flow. */
export const head = (): string => ctx().head()

/** The process's diff base: the commit before it began, or the base `gtd start` fixed. */
export const start = (): string => ctx().start()

/** The skill list `localName` (scoped from here, same as `agent()`) resolves to — for a prompt preamble. */
export const skillsFor = (localName: string): readonly string[] => ctx().skillsFor(localName)

/** The folded access `localName` (scoped from here, same as `agent()`) resolves to — for a prompt preamble. */
export const accessFor = (localName: string, file?: string): AccessDef =>
  ctx().accessFor(localName, file)

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
export const settings: Settings = settingsProxy(() => ctx().vars)

/**
 * The environment settings: resolved live on every invocation. Flow code must
 * read them only where they cannot change the next step (step options, script
 * bodies) — replay cannot enforce this.
 */
export const envSettings: Settings = settingsProxy(() => ctx().env)

/**
 * `settings`, typed by the names `declared` holds — pass the workflow's
 * `defaults`. Every declared name resolves to a string, so none reads as
 * possibly `undefined`, and a misspelled one is a type error.
 */
export const settingsOf = <D extends Readonly<Record<string, string>>>(
  _declared: D,
): Settings<keyof D & string> => settings as Settings<keyof D & string>

/** `envSettings`, typed by the names `declared` holds — pass the workflow's `envDefaults`. */
export const envSettingsOf = <D extends Readonly<Record<string, string>>>(
  _declared: D,
): Settings<keyof D & string> => envSettings as Settings<keyof D & string>

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

export type WidgetKind =
  | "review-checklist"
  | "single-select"
  | "multi-select"
  | "boolean"
  | "static"

interface WidgetBase {
  readonly title: string
  /** The 1-based line the widget starts on. */
  readonly line: number
  /** Labels of the annotations whose markers sit in the widget. */
  readonly annotations: readonly string[]
  /** `false` only for a single select with no answer and a review checklist with an unticked hunk. */
  readonly answered: boolean
}

interface InputWidgetBase extends WidgetBase {
  /** The markdown between the widget's heading and its checkboxes. */
  readonly description: string
}

export interface WidgetChoice {
  readonly label: string
  readonly checked: boolean
}

export interface WidgetCustomAnswer {
  readonly text: string
  readonly checked: boolean
}

export interface WidgetHunk {
  readonly pointer: string
  readonly path: string
  readonly start: number
  readonly end: number
  readonly note: string
  readonly checked: boolean
}

export type Widget =
  | (InputWidgetBase & {
      readonly kind: "single-select" | "multi-select"
      readonly options: readonly WidgetChoice[]
      readonly custom?: WidgetCustomAnswer
    })
  | (InputWidgetBase & {
      readonly kind: "boolean"
      readonly label: string
      readonly checked: boolean
    })
  | (InputWidgetBase & { readonly kind: "review-checklist"; readonly hunks: readonly WidgetHunk[] })
  | (WidgetBase & { readonly kind: "static"; readonly markdown: string })

export interface SteeringCheck {
  readonly base?: string | undefined
  readonly widgets?: readonly WidgetKind[] | undefined
  readonly coverage?: boolean | undefined
}

/** The widgets of steering file `file` in file order; none when it does not exist. */
export const widgets = (file: string): readonly Widget[] => {
  const text = ctx().read(file)
  return text === undefined ? [] : ctx().widgets(text)
}

/** The widgets a person still has to answer: a single select, a review checklist with an unticked hunk. */
export const unanswered = (list: readonly Widget[]): readonly Widget[] =>
  list.filter((w) => !w.answered)

/** The labels of every annotation marker in the widgets. */
export const annotations = (list: readonly Widget[]): readonly string[] =>
  list.flatMap((w) => w.annotations)

// ── The workflow ────────────────────────────────────────────────────────────

/** A workflow's one flow. */
export type Flow = () => Promise<void>

// Registered, like the replay context: any copy of this file marks for the engine's.
const MARKED = Symbol.for("@pmelab/gtd/workflow")

/** What `workflow(flow, options)` takes: a factory build's keys but `flow`. */
export type WorkflowOptions = Omit<WorkflowBuild, "flow">

/**
 * Make `flow` a workflow: exported from `gtd.config.ts`, it is startable by its
 * export name. An exported function not passed through this is a plain helper.
 * `options` are the ones a `defineWorkflow` build returns, checked the same way.
 * Returns a new function that runs `flow`, leaving `flow` itself untouched, so
 * an already-marked flow can be wrapped again: like a build, the options given
 * are the whole set — the wrapped flow's own are not inherited.
 */
export const workflow = (flow: Flow, options: WorkflowOptions = {}): Flow => {
  const marked: Flow = () => flow()
  Object.defineProperty(marked, "name", { value: flow.name })
  Object.defineProperty(marked, MARKED, { value: { ...options } })
  return marked
}

/** The options `value` was marked with, or `undefined` when it went through no `workflow()`. */
export const markedOptions = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "function" && MARKED in value
    ? (value as unknown as Record<symbol, Readonly<Record<string, unknown>>>)[MARKED]
    : undefined

export interface SummaryContext {
  readonly entryCommit: string
  readonly processBase: string
  readonly processTip: string
  readonly humanCommits: readonly { readonly hash: string; readonly state: string }[]
  readonly processCost: number
  readonly processCostByModel: readonly { readonly model: string; readonly cost: number }[]
  /** Every `Gtd-Mark` of the process's commits, oldest first. */
  readonly marks: readonly Mark[]
  readonly vars: Readonly<Record<string, string>>
  readonly env: Readonly<Record<string, string>>
}

/** `gtd summary`'s prompt — a workflow's optional `summary` option. */
export type Summary = (context: SummaryContext) => string

/**
 * A workflow's optional `base` option: the commitish that fixes the diff base
 * of a process `gtd start <workflow>` starts, or `undefined` for none. Runs
 * when the process is started, with the settings `--var` sets.
 */
export type WorkflowBase = (
  workflow: string,
  vars: Readonly<Record<string, string>>,
) => string | undefined

/** A named shortcut: `gtd start <name> [args…]` starts `workflow` with the positional args mapped to process settings. */
export interface Door {
  readonly workflow: string
  /** Static, so `gtd start --json` can list them. */
  readonly args?: readonly { readonly name: string; readonly optional?: boolean }[]
  /** A pure function of the args: no git runs at declaration time. */
  readonly vars?: (
    args: Readonly<Record<string, string | undefined>>,
  ) => Readonly<Record<string, string>>
}

/** Doors a workflow declares on itself: each starts whatever name the config exports the workflow under. */
export type WorkflowDoors = Readonly<Record<string, Omit<Door, "workflow">>>
