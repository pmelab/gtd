/**
 * Pure, event-sourced resolver for the gtd v2 turn-taking state machine.
 *
 * This module is the **interpreter**: the machine's shape (states, HEAD
 * classification rules, interrupt/fallback ladders, counter folds, illegal
 * combinations, entry points) lives as data in `./Workflow.ts`
 * (`defaultWorkflow`), and `resolve(events)` folds the event stream through
 * that definition. The contract types (`GtdState`, `CommitEvent`,
 * `ResolvePayload`, `EdgeAction`, `Counters`) are defined in `Workflow.ts`
 * and re-exported here, so this module remains the canonical import path for
 * edge code (`Events.ts`), the CLI (`program.ts`), and tests.
 *
 * v2 replaces v1's single mutating `gtd` command with a turn-taking model:
 * `gtd step <actor>` (mutator for any declared actor) and `gtd next` (pure
 * prompt emitter, `invoker: "none"`) both compile against `resolve`. The
 * commit-subject grammar (`./Subjects.ts`) is the sole channel the machine
 * reads: who authored the last turn, whether it is the rest of a chain or
 * mid-chain bookkeeping, and which workflow phase it belongs to. File
 * **content** never steers, with exactly two machine-verified exceptions:
 * FEEDBACK.md emptiness and REVIEW.md checkbox-only diffs.
 *
 * What stays code here (the turn-taking engine, deliberately NOT data):
 * out-of-turn refusals, the fixpoint (idempotent re-invocation), the
 * dirty-boundary entry turn, and the idle/health-fix same-chain carve-outs.
 * The definition parameterizes them (entry rules, per-state empty-turn
 * policies, per-gate validation) but their skeleton is the safety core.
 *
 * It is intentionally free of IO: no git, no filesystem, no Effect. State is
 * folded from **first-parent** history only (single writer, linear branch). A
 * merge commit at HEAD is unsupported — documented, not handled.
 */

import type { Actor, TurnGate } from "./Subjects.js"
import { parseSubject } from "./Subjects.js"
import type {
  BaselineFacts,
  ClassifyFlags,
  CommitEvent,
  Counters,
  EdgeAction,
  GtdState,
  ResolvePayload,
  RuleOutcome,
} from "./Workflow.js"
import {
  defaultAutonomousActor,
  defaultInteractiveActor,
  defaultWorkflow,
  isAutonomousActor,
  isInteractiveActor,
} from "./Workflow.js"

export type {
  CommitEvent,
  Counters,
  EdgeAction,
  GtdPackageFact,
  GtdState,
  ResolvePayload,
} from "./Workflow.js"

/** The terminal working-tree snapshot the ladder branches on. */
export interface ResolveEvent {
  readonly type: "RESOLVE"
  readonly payload: ResolvePayload
}

/**
 * The event stream `resolve` folds. A typical stream is the first-parent
 * commit history (`COMMIT[]`, oldest→newest) followed by a single terminal
 * `RESOLVE` carrying the current working-tree snapshot.
 */
export type GtdEvent = CommitEvent | ResolveEvent

/** The folded prompt context carried on every `Result`. */
export interface ResolveContext {
  /** `gtd: test-failed` commits since the most recent of {package-start, feedback round, ERRORS.md removal}. */
  readonly testFixCount: number
  /** Feedback rounds (`isFeedback`) since the most recent package-start. */
  readonly reviewFixCount: number
  /** `.gtd/` packages (passthrough); `packages[0]` is active. */
  readonly packages: ResolvePayload["packages"]
  /** `git diff <reviewBase> HEAD` (passthrough), when present. */
  readonly refDiff?: string
  /** Review base commit (passthrough), when present. */
  readonly reviewBase?: string
  /** Squash base commit (passthrough), when present. */
  readonly squashBase?: string
  /** `git diff <squashBase> HEAD` (passthrough), when present. */
  readonly squashDiff?: string
  /** Full `FEEDBACK.md` text (passthrough); "" when absent. Inlined into the Fixing prompt. */
  readonly feedbackContent: string
  /** `headTurnDiff` passthrough, for prompts that inline the turn diff (e.g. re-grilling from review feedback). */
  readonly turnDiff?: string
  /** Concatenated `## Decisions` history from past squash commits (passthrough); "" when none. Inlined into grilling/architecting prompts. */
  readonly decisionLog: string
}

/** The resolved decision: the state, the awaited actor, an optional edge action, and context. */
export interface Result {
  readonly state: GtdState
  /** The actor awaited at this rest (or, for a mid-chain HEAD, the actor the chain is driven by). */
  readonly actor: Actor
  /** Clean tree, mid-chain HEAD — meaningful for invoker "none" (`gtd next`/`gtd status`). */
  readonly pending: boolean
  /** Set when an out-of-turn invocation is refused — the invoking actor is not the awaited one, in either direction. The CLI prints this to stderr and exits non-zero; zero commits happen. */
  readonly refusal?: string
  readonly edgeAction?: EdgeAction
  readonly context: ResolveContext
}

/**
 * A hard error raised by the resolver. `kind` distinguishes the two documented
 * throw sites: an `illegal-combination` of steering files, or `corruption`
 * (no precedence rule matched — the repo is in a state the machine refuses to
 * guess at).
 */
export class GtdStateError extends Error {
  readonly kind: "illegal-combination" | "corruption"
  constructor(kind: "illegal-combination" | "corruption", message: string) {
    super(message)
    this.name = "GtdStateError"
    this.kind = kind
  }
}

/**
 * Counter folds over the event stream (oldest→newest), interpreting the
 * definition's `counters` rules — the edge stays thin. Only `COMMIT` events
 * contribute; `RESOLVE` events are ignored here. Reset is checked before
 * increment for every counter, so a commit that both resets and increments
 * (none currently do) would net to 1, not 0.
 */
export const foldCounters = (events: readonly GtdEvent[]): Counters => {
  const counts: Record<keyof Counters, number> = {
    testFixCount: 0,
    reviewFixCount: 0,
    healthFixCount: 0,
  }
  const rules = Object.entries(defaultWorkflow.counters) as [
    keyof Counters,
    (typeof defaultWorkflow.counters)[keyof Counters],
  ][]
  for (const event of events) {
    if (event.type !== "COMMIT") continue
    for (const [name, rule] of rules) {
      if (rule.resetsOn(event)) counts[name] = 0
      if (rule.incrementsOn(event)) counts[name] += 1
    }
  }
  return counts
}

/**
 * The nearest workflow (turn or routing) commit's turn identity, walking
 * newest→oldest and skipping boundary commits (`isWorkflowCommit === false`).
 * Used to recognize an operational-recovery HEAD: a boundary commit (e.g. a
 * config fix) landed on top of a mid-chain checkpoint turn, so HEAD itself no
 * longer names the checkpoint even though it is still the active one.
 * `undefined` when no workflow commit precedes HEAD in the stream at all.
 */
const lastWorkflowTurn = (
  events: readonly GtdEvent[],
): { readonly actor: Actor; readonly gate: string } | undefined => {
  let found: { readonly actor: Actor; readonly gate: string } | undefined
  for (const event of events) {
    if (event.type !== "COMMIT") continue
    if (!event.isWorkflowCommit) continue
    found =
      event.turnActor !== undefined && event.turnGate !== undefined
        ? { actor: event.turnActor, gate: event.turnGate }
        : undefined
  }
  return found
}

/**
 * The payload a degenerate `RESOLVE`-less stream resolves against — also the
 * canonical field-default table tests spread-override instead of hand-writing
 * every `ResolvePayload` field.
 */
export const DEFAULT_PAYLOAD: ResolvePayload = {
  invoker: "none",
  headTurnDiff: "",
  todoExists: false,
  todoCommitted: false,
  architectureExists: false,
  architectureCommitted: false,
  planExists: false,
  planCommitted: false,
  packagesPresent: false,
  reviewPresent: false,
  feedbackPresent: false,
  errorsPresent: false,
  gtdModified: false,
  codeDirty: false,
  feedbackCommitted: false,
  feedbackEmpty: false,
  feedbackContent: "",
  reviewCommitted: false,
  reviewDirty: false,
  reviewCheckboxOnly: false,
  reviewDeletedOnly: false,
  pendingErrorsDeletion: false,
  pendingFeedbackDeletion: false,
  lastCommitSubject: "",
  workingTreeClean: true,
  packages: [],
  hasCommitsAfterLastDone: true,
  agenticReviewEnabled: true,
  fixAttemptCap: 3,
  reviewThreshold: 3,
  squashEnabled: false,
  squashMsgPresent: false,
  squashMsgDirty: false,
  healthPresent: false,
  healthContent: "",
  healthCommitted: false,
  learningEnabled: false,
  learningMsgPresent: false,
  learningMsgDirty: false,
  decisionLog: "",
}

/** Build the prompt context from the payload passthrough + the folded counters. */
const buildContext = (p: ResolvePayload, counters: Counters): ResolveContext => ({
  testFixCount: counters.testFixCount,
  reviewFixCount: counters.reviewFixCount,
  packages: p.packages,
  ...(p.refDiff !== undefined ? { refDiff: p.refDiff } : {}),
  ...(p.reviewBase !== undefined ? { reviewBase: p.reviewBase } : {}),
  ...(p.squashBase !== undefined ? { squashBase: p.squashBase } : {}),
  ...(p.squashDiff !== undefined ? { squashDiff: p.squashDiff } : {}),
  feedbackContent: p.feedbackContent !== "" ? p.feedbackContent : p.healthContent,
  ...(p.headTurnDiff !== "" ? { turnDiff: p.headTurnDiff } : {}),
  decisionLog: p.decisionLog,
})

/**
 * Throw on the definition's documented illegal-combination set. These never
 * arise in normal flow; if seen, gtd hard-errors rather than guessing.
 * Enforced before the ladder, in the definition's declared order.
 */
const assertLegal = (p: ResolvePayload): void => {
  for (const rule of defaultWorkflow.conflicts) {
    if (rule.isViolated(p)) {
      throw new GtdStateError("illegal-combination", `illegal combination: ${rule.message}`)
    }
  }
}

// ── HEAD classification ──────────────────────────────────────────────────────
//
// The rest-vs-mid-chain classification pinned by the wire-format contract,
// shared by `resolve` and `predictTurn`. A HEAD is classified into exactly
// one row of `HeadClass`: a **rest** (the state/actor `next` reports, with no
// further machine work at that HEAD) or **mid-chain** (bookkeeping the
// resolver performs immediately, carrying the `EdgeAction` that does it).
// Boundary commits, and rows whose classification additionally depends on
// payload facts beyond the subject itself, are resolved by the interrupt/
// fallback ladders — the definition's `turnRules`/`routingRules` cover
// exactly the rows that are a pure function of the subject plus the small
// config-dependent flag set (`ClassifyFlags`).

/** One row of the classification table. */
type HeadClass =
  | { readonly kind: "rest"; readonly state: GtdState; readonly actor: Actor }
  | {
      readonly kind: "mid-chain"
      readonly state: GtdState
      readonly actor: Actor
      readonly action: EdgeAction
    }

/**
 * The learning/squash decision shared by `gtd: done`, `gtd: tests-green`
 * (health path, no packages), and `gtd: learning-applied` (`settle` rule
 * outcomes): learning first (when it hasn't already run), then squash, else
 * rest at idle. `state` is the label the mid-chain hop reports (mirrors the
 * just-consumed routing phase's own name, e.g. "done" for the `gtd: done`
 * case).
 */
const nextAfterReviewOrLearning = (
  flags: ClassifyFlags,
  state: GtdState,
  learningAlreadyRan: boolean,
): HeadClass => {
  const machineDriver = defaultAutonomousActor()
  if (!learningAlreadyRan && flags.learningEnabled && flags.hasSquashBase) {
    return {
      kind: "mid-chain",
      state,
      actor: machineDriver,
      action: { kind: "writeLearningTemplate" },
    }
  }
  return flags.squashEnabled && flags.hasSquashBase
    ? { kind: "mid-chain", state, actor: machineDriver, action: { kind: "writeSquashTemplate" } }
    : { kind: "rest", state: "idle", actor: defaultWorkflow.states.idle.awaits }
}

/** First branch whose guard passes (an omitted guard always passes), or null. */
const firstMatch = <Facts>(
  branches: readonly { readonly when?: (facts: Facts) => boolean; readonly to: RuleOutcome }[],
  facts: Facts,
): RuleOutcome | null => {
  for (const branch of branches) {
    if (branch.when === undefined || branch.when(facts)) return branch.to
  }
  return null
}

/** Realize a rule outcome against the classification flags (`settle` folds through `nextAfterReviewOrLearning`). */
const outcomeToHeadClass = (outcome: RuleOutcome, flags: ClassifyFlags): HeadClass | null => {
  switch (outcome.kind) {
    case "rest":
      return { kind: "rest", state: outcome.state, actor: outcome.actor }
    case "chain":
      return {
        kind: "mid-chain",
        state: outcome.state,
        actor: outcome.actor,
        action: outcome.action,
      }
    case "defer":
      return null
    case "settle":
      return nextAfterReviewOrLearning(flags, outcome.state, outcome.learningAlreadyRan)
  }
}

/**
 * Classify HEAD per the definition's wire-format table (turn commits and
 * routing commits only — boundary subjects, unruled `(actor, gate)` pairs,
 * and `defer` outcomes return `null` for the caller's fallback ladder to
 * resolve). Shared internally by both `resolve` and `predictTurn` so they
 * use one classification.
 */
const classifyHead = (subject: string, flags: ClassifyFlags): HeadClass | null => {
  const parsed = parseSubject(subject)

  if (parsed.kind === "turn") {
    const rule = defaultWorkflow.turnRules.find(
      (r) => r.actor === parsed.actor && r.gate === parsed.gate,
    )
    if (rule === undefined) return null
    const outcome = firstMatch(rule.branches, flags)
    return outcome === null ? null : outcomeToHeadClass(outcome, flags)
  }

  if (parsed.kind === "routing") {
    const branches = defaultWorkflow.routingRules[parsed.phase]
    if (branches === undefined) return null
    const outcome = firstMatch(branches, flags)
    return outcome === null ? null : outcomeToHeadClass(outcome, flags)
  }

  return null
}

/** Map a state to the turn gate an invocation at that state's rest would author. */
/**
 * The definition's capture-rule match for a step of `invoker` at `state`'s
 * rest: the first rule whose emptiness mode fits the tree, whose actor
 * restriction (if any) fits the invoker, and whose guard passes. `undefined`
 * = nothing to capture (a do-nothing invocation). Shared by `applyTurnTaking`
 * (author nothing) and `predictTurn` (predict null) so the two can never
 * disagree.
 */
const matchCaptureRule = (state: GtdState, invoker: Actor, p: ResolvePayload) => {
  // An empty-turn signal is meaningful exactly once: when HEAD already
  // carries the very turn an empty rule would author (same actor, same
  // label) and the tree is still clean, there is nothing new to say — the
  // fixpoint, expressed as a label fact (δ-pure). A DIRTY tree at the same
  // head is a genuinely new capture and is unaffected.
  const parsedHead = parseSubject(p.lastCommitSubject)
  const headIsOwnTurn = (label: TurnGate): boolean =>
    parsedHead.kind === "turn" && parsedHead.actor === invoker && parsedHead.gate === label
  return (defaultWorkflow.states[state].captureRules ?? []).find(
    (rule) =>
      (rule.empty === true
        ? p.workingTreeClean && !headIsOwnTurn(rule.label)
        : !p.workingTreeClean) &&
      (rule.actor === undefined || rule.actor === invoker) &&
      (rule.when === undefined || rule.when(p)),
  )
}

/**
 * Derive the facts the interrupt/fallback ladder rules consult: the payload
 * plus the fixer-turn precedence exceptions, force-approve, the effective
 * FEEDBACK.md view (a pending delete-dispute counts as present-and-empty),
 * and the reviewable predicate.
 */
const buildBaselineFacts = (
  p: ResolvePayload,
  counters: Counters,
  head: string,
  lastTurn?: { readonly actor: Actor; readonly gate: string },
): BaselineFacts => {
  const parsedHead = parseSubject(head)
  // The consuming turn's actor is whoever the consuming state awaits —
  // definition data, not a hard-coded actor name.
  const headIsHealthFixerTurn =
    parsedHead.kind === "turn" &&
    parsedHead.actor === defaultWorkflow.states["health-fixing"].awaits &&
    parsedHead.gate === "health-fixing"
  return {
    payload: p,
    counters,
    head,
    headIsHealthFixerTurn,
    forceApprove: !p.agenticReviewEnabled || counters.reviewFixCount >= p.reviewThreshold,
    reviewable:
      p.hasCommitsAfterLastDone &&
      p.reviewBase !== undefined &&
      (p.refDiff ?? "").trim().length > 0,
    ...(lastTurn !== undefined ? { lastTurn } : {}),
  }
}

/**
 * Run one ordered ladder (interrupts or fallback): the first rung whose gate
 * holds resolves via its own first matching branch. Ladder outcomes are
 * always concrete rest/chain rows — `settle`/`defer` are classification-rule
 * concepts and skip the rung defensively.
 */
const runLadder = (
  rules: readonly (typeof defaultWorkflow.interrupts)[number][],
  facts: BaselineFacts,
): HeadClass | null => {
  for (const rule of rules) {
    if (!rule.when(facts)) continue
    const outcome = firstMatch(rule.branches, facts)
    if (outcome === null || outcome.kind === "defer" || outcome.kind === "settle") continue
    return outcome.kind === "rest"
      ? { kind: "rest", state: outcome.state, actor: outcome.actor }
      : {
          kind: "mid-chain",
          state: outcome.state,
          actor: outcome.actor,
          action: outcome.action,
        }
  }
  return null
}

/**
 * Fill in the payload/counter-dependent action fields the classification
 * rules carry placeholders for (they have no direct payload access):
 * `squashCommit.squashBase`, and the fix-attempt budget on `runTest` /
 * `runHealthCheck`. Without this, the building/fixing/escalate mid-chain
 * re-test paths never escalate — a red result past the cap would still write
 * a fresh FEEDBACK.md forever instead of ERRORS.md. Applies ONLY to
 * classification outcomes: the fallback ladder's operational-recovery
 * `runTest` deliberately keeps its zero placeholders.
 */
const fillInActionBudgets = (
  classified: HeadClass,
  p: ResolvePayload,
  counters: Counters,
): HeadClass => {
  if (classified.kind !== "mid-chain") return classified
  if (classified.action.kind === "squashCommit") {
    return {
      ...classified,
      action: { kind: "squashCommit", squashBase: p.squashBase ?? "" },
    }
  }
  if (classified.action.kind === "runTest") {
    return {
      ...classified,
      action: {
        kind: "runTest",
        errorCount: counters.testFixCount,
        capReached: counters.testFixCount >= p.fixAttemptCap,
      },
    }
  }
  if (classified.action.kind === "runHealthCheck") {
    return {
      ...classified,
      action: {
        kind: "runHealthCheck",
        errorCount: counters.healthFixCount,
        capReached: counters.healthFixCount >= p.fixAttemptCap,
        chainAfterGreen: classified.action.chainAfterGreen,
      },
    }
  }
  return classified
}

/**
 * The baseline decision: the interrupt ladder (steering-file precedence sits
 * above HEAD classification — file presence is more current than the last
 * commit), then HEAD classification per the definition's rules, then the
 * fallback ladder for the rows classification cannot resolve alone.
 * Ignorant of turn-taking — `resolve` layers that on afterward via
 * `applyTurnTaking`.
 */
const resolveBaseline = (
  p: ResolvePayload,
  counters: Counters,
  head: string,
  corrupt: () => never,
  lastTurn?: { readonly actor: Actor; readonly gate: string },
): HeadClass => {
  const facts = buildBaselineFacts(p, counters, head, lastTurn)

  const interrupted = runLadder(defaultWorkflow.interrupts, facts)
  if (interrupted !== null) return interrupted

  const flags: ClassifyFlags = {
    hasPackages: p.packagesPresent,
    planExists: p.planExists,
    agenticReviewForceApproved: facts.forceApprove,
    squashEnabled: p.squashEnabled,
    hasSquashBase: p.squashBase !== undefined,
    learningEnabled: p.learningEnabled,
    // A pending (uncommitted) deletion of ERRORS.md still counts as "ERRORS.md
    // was committed at this HEAD" for classification purposes: `fs.exists`
    // (which `p.errorsPresent` reads) already sees the file as gone once the
    // working tree deletes it, but the `gtd: test-failed` commit at HEAD was still
    // the cap-reached escalation round — the human resuming by deleting
    // ERRORS.md must land at the escalate turn (mid-chain re-test), not
    // fixing.
    errorsPresent: p.errorsPresent || p.pendingErrorsDeletion,
    reviewPresent: p.reviewPresent,
  }

  const classified = classifyHead(head, flags)
  if (classified !== null) return fillInActionBudgets(classified, p, counters)

  const fellBack = runLadder(defaultWorkflow.fallback, facts)
  if (fellBack !== null) return fellBack

  return corrupt()
}

/**
 * Layer turn-taking semantics over the baseline classification: out-of-turn
 * guards, fixpoint (idempotent re-invocation), the idle health-check
 * carve-out, and the dirty-boundary entry turn. `invoker: "none"` never
 * mutates — mid-chain HEADs report `pending: true` instead of an edge action.
 */
// fallow-ignore-next-line complexity
const applyTurnTaking = (
  p: ResolvePayload,
  counters: Counters,
  head: string,
  baseline: HeadClass,
): Result => {
  const context = buildContext(p, counters)
  const invoker = p.invoker

  // Dirty boundary + invoker human, no steering files, no COMMITTED TODO/
  // ARCHITECTURE, HEAD is not itself a turn commit — the v2 entry turn.
  // Checks `todoCommitted`/`architectureCommitted` rather than
  // `todoExists`/`architectureExists`: a steering file the human just wrote
  // as part of THIS dirty tree (uncommitted) is exactly what gets captured
  // by this turn (a pre-existing coincidentally-named file must not be
  // mistaken for an already-in-progress grilling/architecting process — only
  // a file already tracked at HEAD indicates that). `gtd: done` counts as a
  // boundary HEAD here too (a settled cycle is exactly where the next
  // feature's dirty tree lands), even though it parses as a `"routing"`
  // subject in the general taxonomy.
  //
  // Which gate the entry turn is captured under depends on which steering
  // file the human's dirty tree already contains (file *presence*, never
  // content — the definition's `entry` rules; the entry files are pairwise
  // illegal combinations, so the pick order is inert).
  const isDirtyBoundaryEntry =
    isInteractiveActor(invoker) &&
    !p.workingTreeClean &&
    !p.todoCommitted &&
    !p.architectureCommitted &&
    !p.planCommitted &&
    !p.packagesPresent &&
    !p.reviewPresent &&
    !p.feedbackPresent &&
    !p.errorsPresent &&
    !p.healthCommitted &&
    (parseSubject(head).kind === "boundary" || head === "gtd: done")

  if (isDirtyBoundaryEntry) {
    const entryGate = pickEntryGate(p)
    return {
      state: entryGate as GtdState,
      actor: invoker,
      pending: false,
      edgeAction: { kind: "captureTurn", actor: invoker, gate: entryGate },
      context,
    }
  }

  if (baseline.kind === "mid-chain") {
    // Mid-chain bookkeeping is not a turn — any invoker's step (or a pure
    // query) can observe/drive it. Only "none" refrains from mutating.
    if (invoker === "none") {
      return { state: baseline.state, actor: baseline.actor, pending: true, context }
    }
    return {
      state: baseline.state,
      actor: baseline.actor,
      pending: false,
      edgeAction: baseline.action,
      context,
    }
  }

  // baseline.kind === "rest"
  const awaited = baseline.actor

  if (invoker === "none") {
    return { state: baseline.state, actor: awaited, pending: false, context }
  }

  // `gtd: testing` re-tests in the SAME chain regardless of which actor is
  // driving this invocation (the health-fixer's own step call must
  // continue past its own routing commit to re-test, not stop on an
  // idle/human "out-of-turn" refusal) — mirrors `gtd(agent): fixing`'s
  // runTest re-test. `gtd next` (invoker "none") is unaffected (handled by
  // the branch above) and still reports idle/human, matching "a clean tree
  // self-heals: the next invocation's health check will simply re-run."
  //
  // `gtd: health-check` gets the same forced re-check ONLY once the
  // fix-attempt budget is already exhausted (`capReached`): a health-fixing
  // rest normally awaits the agent's fix, but once the cap is used up there
  // is nothing left to fix — any invocation (including a human's `gtd step`)
  // must force the re-test that writes ERRORS.md and escalates, rather than
  // silently no-op-ing as an "agent turn awaited, clean tree" out-of-turn step.
  const healthCheckCapReached =
    head === "gtd: health-check" && counters.healthFixCount >= p.fixAttemptCap
  if (
    (head === "gtd: testing" && baseline.state === "idle") ||
    (healthCheckCapReached && baseline.state === "health-fixing")
  ) {
    // `healthFixBase !== undefined` alone: the edge only anchors a base for a
    // live, unprocessed health run (the anchor scan resets on `gtd: tests
    // green`), and a hand-written-HEALTH.md entry run whose first fix goes
    // green has a base but ZERO `gtd: health-check` commits — so a count
    // conjunct would wrongly skip its squash/learning chain.
    const chainAfterGreenAtHealthFix =
      (p.squashEnabled || p.learningEnabled) && p.healthFixBase !== undefined
    return {
      state: "idle",
      actor: defaultAutonomousActor(),
      pending: false,
      edgeAction: {
        kind: "runHealthCheck",
        errorCount: counters.healthFixCount,
        capReached: counters.healthFixCount >= p.fixAttemptCap,
        chainAfterGreen: chainAfterGreenAtHealthFix,
      },
      context,
    }
  }

  // Out-of-turn: the invoker is not the awaited actor → refuse, in BOTH
  // directions. Turns are strictly separated: the wrong mutator always errors
  // instead of no-op-ing or adopting the dirty tree as a turn of its own.
  // In particular a dirty tree at an agent-awaited rest is often the agent's
  // own uncommitted output (the decompose subagent's `.gtd/` packages at the
  // grilled rest) — a human capture there would misattribute agent work and
  // derail routing (`gtd(human): grilled` has no classification route).
  // Human edits made while the agent is awaited (amendment notes in `.gtd/`
  // package files, extra TODO.md detail) stay pending and ride along as
  // input to the agent's next captured turn.
  if (invoker !== awaited) {
    const article = /^[aeiou]/.test(awaited) ? "an" : "a"
    return {
      state: baseline.state,
      actor: awaited,
      pending: false,
      refusal: `${baseline.state} awaits ${article} ${awaited} turn — run \`gtd step ${awaited}\``,
      context,
    }
  }

  // Idle carve-out: an interactive actor's step at idle always re-runs the
  // health check — never an empty turn commit, and never a plain fixpoint
  // no-op.
  if (baseline.state === "idle" && isInteractiveActor(invoker)) {
    // Same reasoning as `chainAfterGreenAtHealthFix` above: base presence is
    // the whole signal.
    const chainAfterGreen = (p.squashEnabled || p.learningEnabled) && p.healthFixBase !== undefined
    return {
      state: "idle",
      actor: invoker,
      pending: false,
      edgeAction: {
        kind: "runHealthCheck",
        errorCount: counters.healthFixCount,
        capReached: counters.healthFixCount >= p.fixAttemptCap,
        chainAfterGreen,
      },
      context,
    }
  }

  // Invoker matches the awaited actor: the state's capture rules decide,
  // from the PENDING tree, which label this step commits — the δ(label,
  // diff) discipline: every branch a label's meaning used to carry in its
  // own diff (empty = accept-defaults, checkbox-only = approval, empty
  // FEEDBACK.md = agentic approval) is decided here and encoded in the
  // label. No matching rule = a do-nothing invocation (zero commits;
  // `gtd next` re-emits the same prompt): inert empty steps are the DEFAULT
  // — the loop protocol opens every iteration with `gtd step agent` before
  // the agent has acted, and an empty capture would at best author a junk
  // commit and at worst consume workflow state. Empty-turn signals are
  // opt-in `empty` rules. A DIRTY tree at a rest whose HEAD already carries
  // the same turn is a genuinely NEW capture (e.g. a fixer whose first
  // attempt landed nothing now has real edits).
  const match = matchCaptureRule(baseline.state, invoker, p)
  if (match === undefined) {
    return { state: baseline.state, actor: awaited, pending: false, context }
  }

  // A malformed grilling/architecting/review draft blocks the AUTONOMOUS
  // actor's own turn capture — a third narrow content-inspection exception,
  // alongside FEEDBACK.md emptiness and REVIEW.md checkbox-only diffs
  // (STATES.md §1). The autonomous-kind guard is what keeps this from ever
  // firing on an INTERACTIVE actor's turn capture at these same gate names
  // (their answer at the grilling gate, their feedback/approval at the
  // review gate) — those are never structurally validated.
  if (isAutonomousActor(invoker)) {
    const validation = defaultWorkflow.agentTurnValidation[match.label]
    if (validation !== undefined) {
      const errors = p[validation.errorsField]
      if ((errors?.length ?? 0) > 0) {
        return {
          state: baseline.state,
          actor: awaited,
          pending: false,
          refusal: `${validation.file} does not match the required structure:\n- ${errors!.join("\n- ")}\n\nFix the file and re-run \`gtd step ${invoker}\`.`,
          context,
        }
      }
    }
  }

  return {
    state: baseline.state,
    actor: awaited,
    pending: false,
    edgeAction: { kind: "captureTurn", actor: invoker, gate: match.label },
    context,
  }
}

/** The definition's entry-gate pick: first matching rule (an omitted guard is the default rung). */
const pickEntryGate = (p: ResolvePayload): TurnGate => {
  const matched = defaultWorkflow.entry.find((rule) => rule.when === undefined || rule.when(p))
  return matched?.gate ?? "grilling"
}

/**
 * Resolve the event stream to a single decision. Folds `COMMIT[]` into the
 * three counters, classifies HEAD (rest vs mid-chain) per the definition's
 * wire-format table, then layers turn-taking semantics on top.
 *
 * Throws `GtdStateError` for an illegal steering-file combination (before
 * classification) or for corruption (no rule matched). Every other input —
 * including `resolve([])` — returns a `Result` without throwing.
 */
export const resolve = (events: readonly GtdEvent[]): Result => {
  const counters = foldCounters(events)
  let payload: ResolvePayload = DEFAULT_PAYLOAD
  for (const event of events) if (event.type === "RESOLVE") payload = event.payload
  const p = payload
  assertLegal(p)
  const head = p.lastCommitSubject
  const corrupt = (): never => {
    throw new GtdStateError(
      "corruption",
      `no precedence rule matched (HEAD="${head}", clean=${p.workingTreeClean}); ` +
        `repo is in an unrecognized state — refusing to guess`,
    )
  }

  const baseline = resolveBaseline(p, counters, head, corrupt, lastWorkflowTurn(events))
  return applyTurnTaking(p, counters, head, baseline)
}

/** Prediction of the first commit `gtd step <actor>` would author, for `gtd status`. */
export interface TurnPrediction {
  readonly actor: Actor
  readonly subject: string | null
  readonly state: GtdState
}

/**
 * Fold the same events `resolve` would, and report what `gtd step <actor>`
 * would commit first for the awaited actor (turn subject, or null when
 * nothing would be committed) and the predicted resulting state. Backs
 * `gtd status` — a pure query, so it forces `invoker: "none"` on the last
 * RESOLVE payload before re-deriving the mid-chain/rest classification, then
 * reports the subject the actual mutating action (`captureTurn` or
 * `commitRouting`) would write.
 */
// fallow-ignore-next-line complexity
export const predictTurn = (events: readonly GtdEvent[]): TurnPrediction => {
  const counters = foldCounters(events)
  let payload: ResolvePayload = DEFAULT_PAYLOAD
  for (const event of events) if (event.type === "RESOLVE") payload = event.payload
  const head = payload.lastCommitSubject
  const corrupt = (): never => {
    throw new GtdStateError(
      "corruption",
      `no precedence rule matched (HEAD="${head}", clean=${payload.workingTreeClean}); ` +
        `repo is in an unrecognized state — refusing to guess`,
    )
  }
  assertLegal(payload)
  const baseline = resolveBaseline(payload, counters, head, corrupt, lastWorkflowTurn(events))

  if (baseline.kind === "mid-chain") {
    const subject =
      baseline.action.kind === "commitRouting"
        ? baseline.action.subject
        : baseline.action.kind === "captureTurn"
          ? `gtd(${baseline.action.actor}): ${baseline.action.gate}`
          : null
    return { actor: baseline.actor, subject, state: baseline.state }
  }

  // Rest: what would the awaited actor's step author? Dirty-boundary entry
  // and idle both predict without needing a full turn-taking re-run since
  // they're pure functions of the payload; other rests predict a captureTurn
  // under the resolved gate whenever the tree is dirty (or the gate accepts
  // an empty turn, i.e. idle/grilling-accept).
  const isDirtyBoundaryEntry =
    !payload.workingTreeClean &&
    !payload.todoCommitted &&
    !payload.architectureCommitted &&
    !payload.planCommitted &&
    !payload.packagesPresent &&
    !payload.reviewPresent &&
    !payload.feedbackPresent &&
    !payload.errorsPresent &&
    !payload.healthCommitted &&
    (parseSubject(head).kind === "boundary" || head === "gtd: done")
  if (isDirtyBoundaryEntry) {
    const entryActor = defaultInteractiveActor()
    const entryGate = pickEntryGate(payload)
    return {
      actor: entryActor,
      subject: `gtd(${entryActor}): ${entryGate}`,
      state: entryGate as GtdState,
    }
  }

  if (baseline.state === "idle") {
    return { actor: defaultWorkflow.states.idle.awaits, subject: null, state: "idle" }
  }

  // Mirror applyTurnTaking's capture matching: no rule = nothing to commit
  // (predict null rather than a subject the mutator would refuse to author),
  // and a HEAD already carrying the predicted turn predicts null too
  // (idempotent re-run).
  const match = matchCaptureRule(baseline.state, baseline.actor, payload)
  if (match === undefined) {
    return { actor: baseline.actor, subject: null, state: baseline.state }
  }
  const parsedHead = parseSubject(head)
  if (
    parsedHead.kind === "turn" &&
    parsedHead.actor === baseline.actor &&
    parsedHead.gate === match.label
  ) {
    return { actor: baseline.actor, subject: null, state: baseline.state }
  }
  return {
    actor: baseline.actor,
    subject: `gtd(${baseline.actor}): ${match.label}`,
    state: baseline.state,
  }
}

/** Awaited actor for a given state — the actor `resolve` reports at that state's rest (dynamic gates default to the definition's autonomous actor). */
export const awaitedActor = (state: GtdState): Actor => {
  const awaits = defaultWorkflow.states[state].awaits
  return awaits === "dynamic" ? defaultAutonomousActor() : awaits
}
