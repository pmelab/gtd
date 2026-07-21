import type {
  ActorDef,
  BaselineFacts,
  CaptureRule,
  ClassifyFlags,
  Counters,
  EdgeAction,
  EntryRule,
  IllegalCombinationRule,
  LadderRule,
  ResolvePayload,
  RuleBranch,
  RuleOutcome,
  StateDef,
  TurnRule,
  WorkflowDefinition,
} from "./Workflow.js"
import { defaultWorkflow, forceApprove, setActiveWorkflow } from "./Workflow.js"

/**
 * The `.gtdrc` `workflow:` key: the WHOLE machine shape, buildable from
 * configuration. This module defines the serializable form of every
 * `WorkflowDefinition` field and compiles it into the definition the
 * interpreter runs — `extends: default` (the default) merges over the
 * built-in machine, `extends: none` builds one from scratch.
 *
 * The definition's function-valued fields (guards, stamps) are expressed in
 * a CLOSED, declarative vocabulary:
 *
 * - **Guards** (`when`) — an expression tree over the resolver's facts:
 *   `{fact: <payload boolean>}`, `{not: e}`, `{all: [e]}`, `{any: [e]}`,
 *   `{counterAtLeast: {counter, limit}}`, `{headIs: "<subject>"}`,
 *   `{lastTurnIs: {actor, gate}}`, `{forceApprove: true}`,
 *   `{reviewable: true}`, `{packagesRemaining: true}`,
 *   `{noSteeringFiles: true}`, `{healthFixBaseAnchored: true}`,
 *   `{squashOrLearningEnabled: true}`. Turn/routing-rule branches see the
 *   narrower `ClassifyFlags` fact set; ladder rungs see everything.
 * - **Stamps** — `{set: {testFix?, reviewFix?, healthFix?}, add: {...}}`,
 *   applied set-then-add to the previous trailer vector.
 * - **Prompts** — either an `@name` reference to a built-in template, or any
 *   other string, registered verbatim as an inline Eta template.
 *
 * Validation is load-time and total: every actor/state/gate reference must
 * resolve, or config loading fails with a `workflow config:`-prefixed error
 * before anything touches the repository.
 */

// ─── Serializable shapes (what YAML/JSON carries) ────────────────────────────

export type GuardConfig =
  | { readonly fact: string }
  | { readonly not: GuardConfig }
  | { readonly all: readonly GuardConfig[] }
  | { readonly any: readonly GuardConfig[] }
  | {
      readonly counterAtLeast: {
        readonly counter: "testFix" | "reviewFix" | "healthFix"
        readonly limit: number | "fixAttemptCap" | "reviewThreshold"
      }
    }
  | { readonly headIs: string }
  | { readonly lastTurnIs: { readonly actor: string; readonly gate: string } }
  | { readonly forceApprove: true }
  | { readonly reviewable: true }
  | { readonly packagesRemaining: true }
  | { readonly noSteeringFiles: true }
  | { readonly healthFixBaseAnchored: true }
  | { readonly squashOrLearningEnabled: true }

export interface StampConfig {
  readonly set?: Partial<Record<"testFix" | "reviewFix" | "healthFix", number>>
  readonly add?: Partial<Record<"testFix" | "reviewFix" | "healthFix", number>>
}

export interface ActionConfig {
  readonly commitRouting?: {
    readonly subject: string
    readonly seedArchitectureFromTodo?: boolean
    readonly seedArchitectureFromPlan?: boolean
    readonly removeArchitecture?: boolean
    readonly removeReview?: boolean
    readonly removeFeedback?: boolean
    readonly removeHealth?: boolean
    readonly removeLearning?: boolean
    readonly promoteCheckOutputToErrors?: boolean
  }
  readonly closePackage?: true
  readonly writeSquashTemplate?: true
  readonly writeLearningTemplate?: true
  readonly squashCommit?: true
}

export type OutcomeConfig =
  | { readonly rest: { readonly state: string; readonly actor: string } }
  | {
      readonly chain: {
        readonly state: string
        readonly actor: string
        readonly action: ActionConfig
      }
    }
  | { readonly settle: { readonly state: string; readonly learningAlreadyRan?: boolean } }
  | { readonly defer: true }

export interface BranchConfig {
  readonly when?: GuardConfig
  readonly to: OutcomeConfig
}

export interface CaptureRuleConfig {
  readonly empty?: boolean
  readonly actor?: string
  readonly when?: GuardConfig
  readonly label: string
  readonly stamp?: StampConfig
  readonly consumeFeedback?: boolean
}

export interface StateConfig {
  readonly kind: "prompt" | "label"
  readonly awaits: string
  readonly prompts?: Readonly<Record<string, string>>
  readonly model?:
    | "decompose"
    | "grilling"
    | "architecting"
    | "building"
    | "fixing"
    | "agentic-review"
    | "clean"
  readonly captureRules?: readonly CaptureRuleConfig[]
}

export interface WorkflowConfig {
  readonly extends?: "default" | "none"
  readonly actors?: readonly { readonly name: string; readonly kind: ActorDef["kind"] }[]
  readonly states?: Readonly<Record<string, StateConfig>>
  readonly turnRules?: readonly {
    readonly actor: string
    readonly gate: string
    readonly branches: readonly BranchConfig[]
  }[]
  readonly routingRules?: Readonly<Record<string, readonly BranchConfig[]>>
  readonly interrupts?: readonly {
    readonly when: GuardConfig
    readonly branches: readonly BranchConfig[]
  }[]
  readonly fallback?: readonly {
    readonly when: GuardConfig
    readonly branches: readonly BranchConfig[]
  }[]
  readonly conflicts?: readonly { readonly when: GuardConfig; readonly message: string }[]
  readonly entry?: readonly { readonly when?: GuardConfig; readonly gate: string }[]
  readonly agentTurnValidation?: Readonly<
    Record<
      string,
      { readonly file: string; readonly errorsField: "grillingDocErrors" | "reviewDocErrors" }
    >
  >
}

// ─── Compile errors ──────────────────────────────────────────────────────────

const fail = (message: string): never => {
  throw new Error(`workflow config: ${message}`)
}

// ─── Guard compilation ───────────────────────────────────────────────────────

/**
 * One evaluation environment per guard context. Payload-context guards
 * (capture rules, entry, conflicts) see the payload; flags-context guards
 * (turn/routing branches) see the small `ClassifyFlags` set; facts-context
 * guards (ladder rungs) see everything.
 */
interface GuardEnv<T> {
  readonly context: string
  readonly fact: (facts: T, name: string) => boolean | undefined
  readonly counters?: (facts: T) => Counters
  readonly limit?: (facts: T, name: "fixAttemptCap" | "reviewThreshold") => number
  readonly head?: (facts: T) => string
  readonly lastTurn?: (facts: T) => { actor: string; gate: string } | undefined
  readonly forceApprove?: (facts: T) => boolean
  readonly reviewable?: (facts: T) => boolean
  readonly packagesRemaining?: (facts: T) => boolean
  readonly noSteeringFiles?: (facts: T) => boolean
  readonly healthFixBaseAnchored?: (facts: T) => boolean
  readonly squashOrLearningEnabled?: (facts: T) => boolean
}

/** ResolvePayload boolean facts a config guard may name. */
const PAYLOAD_FACTS: ReadonlySet<string> = new Set([
  "todoExists",
  "todoCommitted",
  "architectureExists",
  "architectureCommitted",
  "planExists",
  "planCommitted",
  "packagesPresent",
  "reviewPresent",
  "feedbackPresent",
  "errorsPresent",
  "gtdModified",
  "codeDirty",
  "feedbackCommitted",
  "feedbackEmpty",
  "feedbackContent",
  "reviewCommitted",
  "reviewDirty",
  "reviewCheckboxOnly",
  "reviewDeletedOnly",
  "pendingErrorsDeletion",
  "pendingFeedbackDeletion",
  "workingTreeClean",
  "hasCommitsAfterLastDone",
  "agenticReviewEnabled",
  "squashEnabled",
  "learningEnabled",
  "squashMsgPresent",
  "squashMsgDirty",
  "healthPresent",
  "healthCommitted",
  "learningMsgPresent",
  "learningMsgDirty",
])

const payloadNoSteeringFiles = (p: ResolvePayload): boolean =>
  !p.packagesPresent &&
  !p.reviewPresent &&
  !p.feedbackPresent &&
  !p.errorsPresent &&
  !p.healthPresent &&
  !p.todoExists &&
  !p.architectureExists &&
  !p.planExists

const payloadEnv: GuardEnv<ResolvePayload> = {
  context: "payload",
  fact: (p, name) =>
    PAYLOAD_FACTS.has(name) ? Boolean((p as unknown as Record<string, unknown>)[name]) : undefined,
  counters: (p) => p.counters,
  limit: (p, name) => (name === "fixAttemptCap" ? p.fixAttemptCap : p.reviewThreshold),
  head: (p) => p.lastCommitSubject,
  forceApprove: (p) => forceApprove(p),
  packagesRemaining: (p) => p.packages.length > 0,
  noSteeringFiles: payloadNoSteeringFiles,
  healthFixBaseAnchored: (p) => p.healthFixBase !== undefined,
  squashOrLearningEnabled: (p) => p.squashEnabled || p.learningEnabled,
}

/** ClassifyFlags facts a turn/routing branch guard may name. */
const FLAG_FACTS: ReadonlySet<string> = new Set([
  "hasPackages",
  "planExists",
  "agenticReviewForceApproved",
  "squashEnabled",
  "hasSquashBase",
  "learningEnabled",
  "reviewPresent",
])

const flagsEnv: GuardEnv<ClassifyFlags> = {
  context: "turn/routing rule branch",
  fact: (f, name) =>
    FLAG_FACTS.has(name) ? Boolean((f as unknown as Record<string, unknown>)[name]) : undefined,
  forceApprove: (f) => f.agenticReviewForceApproved,
}

const factsEnv: GuardEnv<BaselineFacts> = {
  context: "ladder rung",
  fact: (f, name) => payloadEnv.fact(f.payload, name),
  counters: (f) => f.counters,
  limit: (f, name) => payloadEnv.limit!(f.payload, name),
  head: (f) => f.head,
  lastTurn: (f) => f.lastTurn,
  forceApprove: (f) => f.forceApprove,
  reviewable: (f) => f.reviewable,
  packagesRemaining: (f) => f.payload.packages.length > 0,
  noSteeringFiles: (f) => payloadNoSteeringFiles(f.payload),
  healthFixBaseAnchored: (f) => f.payload.healthFixBase !== undefined,
  squashOrLearningEnabled: (f) => f.payload.squashEnabled || f.payload.learningEnabled,
}

/** Compile one guard expression against an environment; load-time errors for atoms the context lacks. */
// fallow-ignore-next-line complexity
const compileGuard = <T>(
  g: GuardConfig,
  env: GuardEnv<T>,
  where: string,
): ((facts: T) => boolean) => {
  if ("fact" in g) {
    // Probe with a name-only check at compile time: unknown names must fail
    // loading, not silently evaluate false forever.
    const known =
      env === (payloadEnv as unknown as GuardEnv<T>) || env === (factsEnv as unknown as GuardEnv<T>)
        ? PAYLOAD_FACTS.has(g.fact)
        : FLAG_FACTS.has(g.fact)
    if (!known) return fail(`${where}: unknown fact "${g.fact}" for a ${env.context} guard`)
    return (facts) => env.fact(facts, g.fact) === true
  }
  if ("not" in g) {
    const inner = compileGuard(g.not, env, where)
    return (facts) => !inner(facts)
  }
  if ("all" in g) {
    const inner = g.all.map((e) => compileGuard(e, env, where))
    return (facts) => inner.every((fn) => fn(facts))
  }
  if ("any" in g) {
    const inner = g.any.map((e) => compileGuard(e, env, where))
    return (facts) => inner.some((fn) => fn(facts))
  }
  if ("counterAtLeast" in g) {
    if (env.counters === undefined || env.limit === undefined) {
      return fail(`${where}: counterAtLeast is not available in a ${env.context} guard`)
    }
    const { counter, limit } = g.counterAtLeast
    const key = `${counter}Count` as keyof Counters
    return (facts) => {
      const bound = typeof limit === "number" ? limit : env.limit!(facts, limit)
      return env.counters!(facts)[key] >= bound
    }
  }
  if ("headIs" in g) {
    if (env.head === undefined)
      return fail(`${where}: headIs is not available in a ${env.context} guard`)
    return (facts) => env.head!(facts).trim() === g.headIs
  }
  if ("lastTurnIs" in g) {
    if (env.lastTurn === undefined) {
      return fail(`${where}: lastTurnIs is not available in a ${env.context} guard`)
    }
    return (facts) => {
      const turn = env.lastTurn!(facts)
      return (
        turn !== undefined && turn.actor === g.lastTurnIs.actor && turn.gate === g.lastTurnIs.gate
      )
    }
  }
  const single = <K extends keyof GuardEnv<T>>(key: K): ((facts: T) => boolean) => {
    const fn = env[key] as ((facts: T) => boolean) | undefined
    if (fn === undefined)
      return fail(`${where}: ${String(key)} is not available in a ${env.context} guard`)
    return fn
  }
  if ("forceApprove" in g) return single("forceApprove")
  if ("reviewable" in g) return single("reviewable")
  if ("packagesRemaining" in g) return single("packagesRemaining")
  if ("noSteeringFiles" in g) return single("noSteeringFiles")
  if ("healthFixBaseAnchored" in g) return single("healthFixBaseAnchored")
  if ("squashOrLearningEnabled" in g) return single("squashOrLearningEnabled")
  return fail(`${where}: unrecognized guard ${JSON.stringify(g)}`)
}

// ─── Stamp / action / outcome compilation ────────────────────────────────────

const COUNTER_KEYS = {
  testFix: "testFixCount",
  reviewFix: "reviewFixCount",
  healthFix: "healthFixCount",
} as const

const compileStamp = (s: StampConfig): ((prev: Counters) => Counters) => {
  return (prev) => {
    const next: Record<string, number> = { ...prev }
    for (const [short, value] of Object.entries(s.set ?? {})) {
      next[COUNTER_KEYS[short as keyof typeof COUNTER_KEYS]] = value
    }
    for (const [short, value] of Object.entries(s.add ?? {})) {
      const key = COUNTER_KEYS[short as keyof typeof COUNTER_KEYS]
      next[key] = (next[key] ?? 0) + value
    }
    return next as unknown as Counters
  }
}

const compileAction = (a: ActionConfig, where: string): EdgeAction => {
  if (a.commitRouting !== undefined) return { kind: "commitRouting", ...a.commitRouting }
  if (a.closePackage === true) return { kind: "closePackage" }
  if (a.writeSquashTemplate === true) return { kind: "writeSquashTemplate" }
  if (a.writeLearningTemplate === true) return { kind: "writeLearningTemplate" }
  if (a.squashCommit === true) return { kind: "squashCommit", squashBase: "" }
  return fail(
    `${where}: action must name exactly one of commitRouting/closePackage/writeSquashTemplate/writeLearningTemplate/squashCommit`,
  )
}

const compileOutcome = (o: OutcomeConfig, where: string): RuleOutcome => {
  if ("rest" in o) return { kind: "rest", state: o.rest.state, actor: o.rest.actor }
  if ("chain" in o) {
    return {
      kind: "chain",
      state: o.chain.state,
      actor: o.chain.actor,
      action: compileAction(o.chain.action, where),
    }
  }
  if ("settle" in o) {
    return {
      kind: "settle",
      state: o.settle.state,
      learningAlreadyRan: o.settle.learningAlreadyRan ?? false,
    }
  }
  if ("defer" in o) return { kind: "defer" }
  return fail(`${where}: outcome must be one of rest/chain/settle/defer`)
}

const compileBranches = <T>(
  branches: readonly BranchConfig[],
  env: GuardEnv<T>,
  where: string,
): readonly { readonly when?: (facts: T) => boolean; readonly to: RuleOutcome }[] =>
  branches.map((b, i) => ({
    ...(b.when !== undefined
      ? { when: compileGuard(b.when, env, `${where} branch ${i + 1}`) }
      : {}),
    to: compileOutcome(b.to, `${where} branch ${i + 1}`),
  }))

// ─── State / prompt compilation ──────────────────────────────────────────────

const compileCaptureRule = (r: CaptureRuleConfig, where: string): CaptureRule => ({
  ...(r.empty !== undefined ? { empty: r.empty } : {}),
  ...(r.actor !== undefined ? { actor: r.actor } : {}),
  ...(r.when !== undefined ? { when: compileGuard(r.when, payloadEnv, where) } : {}),
  label: r.label,
  ...(r.stamp !== undefined ? { stamp: compileStamp(r.stamp) } : {}),
  ...(r.consumeFeedback !== undefined ? { consumeFeedback: r.consumeFeedback } : {}),
})

const compileState = (name: string, s: StateConfig): StateDef => {
  // Prompt bindings pass through verbatim: an `@name` string references a
  // built-in template; anything else IS the template source, rendered inline
  // by `buildPrompt` — so a config can carry whole prompts in the file.
  return {
    kind: s.kind,
    awaits: s.awaits,
    ...(s.prompts !== undefined ? { prompts: { ...s.prompts } } : {}),
    ...(s.model !== undefined ? { model: s.model } : {}),
    ...(s.captureRules !== undefined
      ? {
          captureRules: s.captureRules.map((r, i) =>
            compileCaptureRule(r, `state "${name}" capture rule ${i + 1}`),
          ),
        }
      : {}),
  }
}

// ─── Whole-definition compilation + validation ───────────────────────────────

const compileLadder = (
  rules: readonly { readonly when: GuardConfig; readonly branches: readonly BranchConfig[] }[],
  where: string,
): readonly LadderRule[] =>
  rules.map((r, i) => ({
    when: compileGuard(r.when, factsEnv, `${where} rung ${i + 1}`),
    branches: compileBranches(
      r.branches,
      factsEnv,
      `${where} rung ${i + 1}`,
    ) as LadderRule["branches"],
  }))

/** Name-reference checkers over the compiled definition's declared sets. */
interface RefCheckers {
  readonly actor: (name: string, where: string) => void
  readonly state: (name: string, where: string) => void
  readonly outcome: (o: RuleOutcome, where: string) => void
}

const makeRefCheckers = (def: WorkflowDefinition): RefCheckers => {
  const actors = new Set(def.actors.map((a) => a.name))
  const states = new Set(Object.keys(def.states))
  const actor = (name: string, where: string): void => {
    if (!actors.has(name)) fail(`${where} references undeclared actor "${name}"`)
  }
  const state = (name: string, where: string): void => {
    if (!states.has(name)) fail(`${where} references undeclared state "${name}"`)
  }
  const outcome = (o: RuleOutcome, where: string): void => {
    if (o.kind === "rest" || o.kind === "chain") {
      state(o.state, where)
      actor(o.actor, where)
    }
    if (o.kind === "settle") state(o.state, where)
  }
  return { actor, state, outcome }
}

const validateStates = (def: WorkflowDefinition, check: RefCheckers): void => {
  for (const [name, state] of Object.entries(def.states)) {
    if (state.awaits !== "dynamic") check.actor(state.awaits, `state "${name}" awaits`)
    for (const actor of Object.keys(state.prompts ?? {})) {
      check.actor(actor, `state "${name}" prompts`)
    }
    for (const rule of state.captureRules ?? []) {
      if (rule.actor !== undefined) check.actor(rule.actor, `state "${name}" capture rule`)
    }
  }
}

const validateRules = (def: WorkflowDefinition, check: RefCheckers): void => {
  for (const rule of def.turnRules) {
    check.actor(rule.actor, `turn rule (${rule.actor}, ${rule.gate})`)
    for (const b of rule.branches) check.outcome(b.to, `turn rule (${rule.actor}, ${rule.gate})`)
  }
  for (const [phase, branches] of Object.entries(def.routingRules)) {
    for (const b of branches ?? []) check.outcome(b.to, `routing rule "${phase}"`)
  }
  for (const ladder of [def.interrupts, def.fallback]) {
    for (const rule of ladder) for (const b of rule.branches) check.outcome(b.to, "ladder rung")
  }
}

/** Referential validation over the compiled definition (mirrors Workflow.test.ts, at load time). */
const validate = (def: WorkflowDefinition): WorkflowDefinition => {
  if (def.actors.length === 0) return fail("at least one actor must be declared")
  if (Object.keys(def.states).length === 0) return fail("at least one state must be declared")
  const check = makeRefCheckers(def)
  validateStates(def, check)
  validateRules(def, check)
  return def
}

/** Config states merged over the base's (a config state replaces its namesake wholesale). */
const mergeStates = (base: WorkflowDefinition | undefined, config: WorkflowConfig) => {
  const states: Record<string, StateDef> = { ...base?.states }
  for (const [name, s] of Object.entries(config.states ?? {})) {
    states[name] = compileState(name, s)
  }
  return states
}

/** Config turn rules replace their (actor, gate) namesake; new pairs append. */
const mergeTurnRules = (base: WorkflowDefinition | undefined, config: WorkflowConfig) => {
  const turnRules: TurnRule[] = [...(base?.turnRules ?? [])]
  for (const rule of config.turnRules ?? []) {
    const compiled: TurnRule = {
      actor: rule.actor,
      gate: rule.gate,
      branches: compileBranches(
        rule.branches,
        flagsEnv,
        `turn rule (${rule.actor}, ${rule.gate})`,
      ) as TurnRule["branches"],
    }
    const existing = turnRules.findIndex((r) => r.actor === rule.actor && r.gate === rule.gate)
    if (existing >= 0) turnRules[existing] = compiled
    else turnRules.push(compiled)
  }
  return turnRules
}

/** Config routing rules replace their phase's row wholesale; new phases append. */
const mergeRoutingRules = (base: WorkflowDefinition | undefined, config: WorkflowConfig) => {
  const routingRules: Record<string, readonly RuleBranch[]> = {}
  for (const [phase, branches] of Object.entries(base?.routingRules ?? {})) {
    if (branches !== undefined) routingRules[phase] = branches
  }
  for (const [phase, branches] of Object.entries(config.routingRules ?? {})) {
    routingRules[phase] = compileBranches(
      branches,
      flagsEnv,
      `routing rule "${phase}"`,
    ) as readonly RuleBranch[]
  }
  return routingRules
}

/** Entry rules, compiled — or the base's when the key is absent. */
const compileEntry = (
  base: WorkflowDefinition | undefined,
  config: WorkflowConfig,
): readonly EntryRule[] => {
  if (config.entry === undefined) return base?.entry ?? []
  return config.entry.map((r, i) => ({
    ...(r.when !== undefined
      ? { when: compileGuard(r.when, payloadEnv, `entry rule ${i + 1}`) }
      : {}),
    gate: r.gate,
  }))
}

/** Conflict rules, compiled — or the base's when the key is absent. */
const compileConflicts = (
  base: WorkflowDefinition | undefined,
  config: WorkflowConfig,
): readonly IllegalCombinationRule[] => {
  if (config.conflicts === undefined) return base?.conflicts ?? []
  return config.conflicts.map((r, i) => ({
    isViolated: compileGuard(r.when, payloadEnv, `conflict rule ${i + 1}`),
    message: r.message,
  }))
}

/** One ladder, compiled — or the base's when the key is absent. */
const ladderOrBase = (
  configured:
    | readonly { readonly when: GuardConfig; readonly branches: readonly BranchConfig[] }[]
    | undefined,
  baseRules: readonly LadderRule[] | undefined,
  where: string,
): readonly LadderRule[] =>
  configured !== undefined ? compileLadder(configured, where) : (baseRules ?? [])

/** Compile a `workflow:` config into a full definition (merging over the default unless `extends: none`). */
export const compileWorkflowConfig = (config: WorkflowConfig): WorkflowDefinition => {
  const base = (config.extends ?? "default") === "default" ? defaultWorkflow : undefined

  const def: WorkflowDefinition = {
    actors: config.actors ?? base?.actors ?? [],
    states: mergeStates(base, config),
    turnRules: mergeTurnRules(base, config),
    routingRules: mergeRoutingRules(base, config),
    interrupts: ladderOrBase(config.interrupts, base?.interrupts, "interrupt"),
    fallback: ladderOrBase(config.fallback, base?.fallback, "fallback"),
    conflicts: compileConflicts(base, config),
    entry: compileEntry(base, config),
    agentTurnValidation: {
      ...base?.agentTurnValidation,
      ...config.agentTurnValidation,
    },
  }
  return validate(def)
}

/**
 * The config edge's one entry point: compile the raw `workflow:` value (or
 * reset to the built-in default when absent) and install it as the active
 * definition. Called during ConfigService construction — before any resolve
 * — by both the real and the in-memory config layers.
 */
export const activateWorkflowConfig = (raw: unknown): void => {
  if (raw === undefined || raw === null) {
    setActiveWorkflow(defaultWorkflow)
    return
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    fail("the workflow key must be an object")
  }
  setActiveWorkflow(compileWorkflowConfig(raw as WorkflowConfig))
}
