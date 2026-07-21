/**
 * The workflow definition: the gtd v2 state machine's **shape as data**.
 *
 * This module owns the canonical contract types (`GtdState`, `CommitEvent`,
 * `ResolvePayload`, `EdgeAction`, `Counters` — re-exported by `Machine.ts`
 * for compatibility) and the declarative `WorkflowDefinition` that
 * `Machine.ts`'s pure interpreter runs on:
 *
 *  - `states`        — one `StateDef` per `GtdState`: prompt-bearing rest vs
 *                      edge-only label, the awaited actor, prompt/model
 *                      bindings, and the state's `captureRules` — which label
 *                      a step commits, decided at capture time from the
 *                      pending tree (the δ(label, diff) discipline).
 *  - `turnRules` /
 *    `routingRules`  — the HEAD-classification table (the wire-format rows
 *                      previously unrolled in `classifyHead`).
 *  - `interrupts`    — the steering-file precedence ladder that fires BEFORE
 *                      HEAD classification.
 *  - `fallback`      — the boundary-HEAD ladder that fires AFTER it.
 *  - `counters`      — reset/increment fold rules over the commit stream.
 *  - `conflicts`     — the illegal steering-file combinations.
 *  - `entry`         — dirty-boundary entry-gate selection.
 *  - `agentTurnValidation` — per-gate structural-validation refusals.
 *
 * Everything here is **pure data plus pure predicates** — no git, no
 * filesystem, no Effect. The turn-taking engine itself (out-of-turn refusals,
 * the fixpoint, dirty-boundary capture, the idle/health carve-outs) stays in
 * `Machine.ts`: it is the product's safety core, parameterized by this
 * definition but never user-defined.
 *
 * The wire format (commit subjects, `src/Subjects.ts`) is frozen: this
 * definition must describe exactly the behavior pinned by STATES.md and the
 * e2e feature suite. Changing a rule here is a wire-format change.
 */

import type { Actor, RoutingPhase, TurnGate } from "./Subjects.js"
import type { ModelState } from "./Config.js"

// NOTE: this module must stay free of RUNTIME imports from `./Subjects.js`
// (type-only imports are fine): the grammar derives its closed actor
// vocabulary from `defaultWorkflow.actors` below, so `Subjects.ts` imports
// THIS module at runtime — a runtime import in the other direction would be
// a cycle.

// ─── Contract types (re-exported by Machine.ts) ─────────────────────────────

/** The 21 resolved states (frozen contract). `Result.state` is one of these. */
export type GtdState =
  | "grilling"
  | "architecting"
  | "grilled"
  | "planning"
  | "building"
  | "testing"
  | "fixing"
  | "escalate"
  | "agentic-review"
  | "close-package"
  | "review"
  | "await-review"
  | "done"
  | "learning"
  | "await-learning-review"
  | "learning-apply"
  | "learning-applied"
  | "squashing"
  | "idle"
  | "health-check"
  | "health-fixing"

/**
 * One first-parent commit, reduced to what the machine still reads from the
 * stream: the turn identity for the boundary-skip recovery walk. Counters no
 * longer fold from the stream — they ride the labels themselves as
 * `Gtd-Counters` trailers (the δ-discipline) and arrive on the payload.
 */
export interface CommitEvent {
  readonly type: "COMMIT"
  /** Set when the subject is a turn commit (`gtd(<actor>): <gate>`). */
  readonly turnActor?: Actor
  /** The `<gate>` of a turn commit. */
  readonly turnGate?: string
  /** Recognized turn or machine-label subject (kind !== "boundary"). */
  readonly isWorkflowCommit: boolean
}

/** A `.gtd/` work package, reduced to what the prompts list. */
export interface GtdPackageFact {
  readonly name: string
  /** Task `.md` filenames, sorted. */
  readonly tasks: readonly string[]
  /** Full contents of each task `.md`, parallel-sorted to `tasks`. */
  readonly taskContents: readonly { readonly name: string; readonly content: string }[]
}

/**
 * The working-tree snapshot carried by a `RESOLVE` event: steering-file
 * presence and dirtiness, the last commit subject, the invoking actor, and
 * prompt passthrough. Presence and dirtiness only — **no counts** (the counts
 * fold from `COMMIT[]` in the machine).
 */
export interface ResolvePayload {
  /** Who is invoking: "human" (`gtd step`), "agent" (`gtd step-agent`), or "none" (`gtd next`/`gtd status`, a pure query). */
  readonly invoker: Actor | "none"
  /** Diff of HEAD when HEAD is a turn commit (workflow files excluded), else "" — prompt passthrough only, never a steering input (δ-discipline: branch decisions read the PENDING diff at capture, encoded in the label). */
  readonly headTurnDiff: string
  /** Base hash from the newest `gtd: review <hash>` in the current cycle. */
  readonly reviewAnchor?: string
  /** `TODO.md` exists (committed or pending). */
  readonly todoExists: boolean
  /** The present `TODO.md` is tracked at HEAD. */
  readonly todoCommitted: boolean
  /** `ARCHITECTURE.md` exists (committed or pending). */
  readonly architectureExists: boolean
  /** The present `ARCHITECTURE.md` is tracked at HEAD. */
  readonly architectureCommitted: boolean
  /** `PLAN.md` exists (committed or pending) — a final, decompose-as-is architecture. */
  readonly planExists: boolean
  /** The present `PLAN.md` is tracked at HEAD. */
  readonly planCommitted: boolean
  /** Numbered work packages exist under `.gtd/` (committed or pending). NOT "the directory exists" — steering files share `.gtd/`, so bare dir presence means nothing. */
  readonly packagesPresent: boolean
  /** `REVIEW.md` is present (committed and/or pending). */
  readonly reviewPresent: boolean
  /** `FEEDBACK.md` is present (committed and/or pending). */
  readonly feedbackPresent: boolean
  /** A committed `ERRORS.md` is present — the test loop escalated. */
  readonly errorsPresent: boolean
  /** `.gtd/` work-package files (numbered dirs only, never steering files) were added/edited vs the committed tree. */
  readonly gtdModified: boolean
  /** Pending changes outside `.gtd/` — everything not workflow-managed is code. */
  readonly codeDirty: boolean
  /** The present `FEEDBACK.md` is committed. */
  readonly feedbackCommitted: boolean
  /** The present `FEEDBACK.md` is whitespace-only (`!/\S/`) — a clean agentic review = approval. */
  readonly feedbackEmpty: boolean
  /** Full text of the present `FEEDBACK.md` ("" when absent). */
  readonly feedbackContent: string
  /** `REVIEW.md` is committed AND the tree is clean. */
  readonly reviewCommitted: boolean
  /** `REVIEW.md` is committed BUT there are pending edits. */
  readonly reviewDirty: boolean
  /** Pending REVIEW.md change is a pure checkbox-state flip and nothing else is dirty. */
  readonly reviewCheckboxOnly: boolean
  /** The working tree deletes the committed `REVIEW.md` and nothing else is dirty — the outright-deletion approval shape at the await-review gate. */
  readonly reviewDeletedOnly: boolean
  /** The working tree deletes a committed `ERRORS.md` (human resume → fresh budget). */
  readonly pendingErrorsDeletion: boolean
  /** `FEEDBACK.md` has a pending (uncommitted) deletion — a delete-dispute. */
  readonly pendingFeedbackDeletion: boolean
  /** Subject of HEAD (first-parent). */
  readonly lastCommitSubject: string
  /**
   * The counter vector of the NEAREST workflow commit's `Gtd-Counters`
   * trailer (zero when the nearest labeled commit carries none — fresh
   * repos, post-squash boundaries, and pre-trailer histories). Every commit
   * the machine writes carries the vector stamped at write time, so reading
   * ONE trailer replaces folding the whole stream.
   */
  readonly counters: Counters
  /** The whole working tree is clean. */
  readonly workingTreeClean: boolean
  /** `.gtd/` packages, lowest-numbered first; `packages[0]` is the active one. */
  readonly packages: readonly GtdPackageFact[]
  /** The base commit for a review, if one is available. */
  readonly reviewBase?: string
  /** `git diff <reviewBase> HEAD` (workflow files excluded). */
  readonly refDiff?: string
  /** Commits exist after the most recent `gtd: done` (or none exists). */
  readonly hasCommitsAfterLastDone: boolean
  /** Agentic review enabled (config kill-switch; false → Agentic Review force-approves). */
  readonly agenticReviewEnabled: boolean
  /** Fix-attempt cap (config, default 3). */
  readonly fixAttemptCap: number
  /** Review-fix threshold (config, default 3). */
  readonly reviewThreshold: number
  /** Parent commit of the first persisting cycle commit (squash base). */
  readonly squashBase?: string
  /** `git diff <squashBase> HEAD`, the whole feature diff. */
  readonly squashDiff?: string
  /** Squash enabled (config kill-switch). */
  readonly squashEnabled: boolean
  readonly squashMsgPresent: boolean
  /**
   * The working tree has pending changes to `SQUASH_MSG.md` — the agent's
   * real message overwrite. The squashing capture rule keys on this (a
   * diff fact, per the δ-discipline): a landed squashing turn therefore
   * always carries a real message, so the machine never squashes the
   * unmodified template (the file's content becomes the squash commit's
   * message verbatim).
   */
  readonly squashMsgDirty: boolean
  /** `HEALTH.md` exists (committed or pending). */
  readonly healthPresent: boolean
  /** Full text of the present `HEALTH.md` ("" when absent). */
  readonly healthContent: string
  /** `HEALTH.md` is tracked at HEAD (committed health check) vs pending. */
  readonly healthCommitted: boolean
  /** Parent commit of the first persisting health-fix cycle commit. */
  readonly healthFixBase?: string
  /** Learning phase enabled (config kill-switch). */
  readonly learningEnabled: boolean
  /** `.gtd/LEARNINGS.md` is present (committed or pending). */
  readonly learningMsgPresent: boolean
  /**
   * The working tree has pending changes to `LEARNINGS.md` — the agent's
   * real draft. Mirrors `squashMsgDirty`: the learning capture rule keys on
   * this diff fact, so the machine never mid-chains on an unmodified
   * placeholder.
   */
  readonly learningMsgDirty: boolean
  /**
   * Every past squash commit's `## Decisions` section, concatenated oldest to
   * newest with no deduplication ("" when none/config disabled) — see
   * `src/Events.ts`'s `decisionLog` computation. Pure per-prompt input (like
   * `squashDiff`), consumed as prior-decision context by grilling/architecting.
   */
  readonly decisionLog: string
  /**
   * Structural-validation errors for whichever of `TODO.md`/`ARCHITECTURE.md`
   * is present (the two never coexist, so one field covers both phases), from
   * `parseOpenQuestions` (`src/OpenQuestions.ts`). Empty/absent when the
   * present file is well-formed or neither file exists. Consulted ONLY when
   * the AGENT is about to capture a fresh `grilling`/`architecting` turn
   * (`applyTurnTaking`) — a human's own turn is never blocked by this.
   */
  readonly grillingDocErrors?: readonly string[]
  /**
   * Structural-validation errors for the present `REVIEW.md`, from
   * `parseReviewDoc` (`src/ReviewDoc.ts`). Empty/absent when well-formed or
   * absent. Consulted ONLY when the AGENT is about to capture a fresh
   * `review` turn (the human's checkbox/feedback turn at `await-review` is
   * never blocked by this).
   */
  readonly reviewDocErrors?: readonly string[]
}

/**
 * A side effect the driver performs, then re-gathers + re-resolves until a
 * prompt-bearing rest or a pending mid-chain checkpoint.
 *   - `captureTurn`      — author the first commit of a turn chain:
 *                          `git add -A` + `git commit --allow-empty` with
 *                          subject `gtd(<actor>): <gate>`.
 *   - `commitRouting`    — machine bookkeeping commit with a fixed `subject`
 *                          (one of the routing subjects). `removeArchitecture` /
 *                          `removeReview` / `removeFeedback` / `removeHealth`
 *                          delete the named steering file first so its
 *                          removal lands in this commit.
 *                          `seedArchitectureFromTodo` instead reads the
 *                          present `TODO.md`, writes its content (with a
 *                          short scaffold banner) as `ARCHITECTURE.md`, and
 *                          deletes `TODO.md` — the grilling→architecting
 *                          hand-off, all in this one commit.
 *                          `seedArchitectureFromPlan` mirrors it for the
 *                          PLAN.md entry: reads the present `PLAN.md`, writes
 *                          its content (with a banner) as `ARCHITECTURE.md`,
 *                          and deletes `PLAN.md` — the direct-to-decompose
 *                          hand-off.
 *   - `runTest`          — run the configured test command; on red write
 *                          FEEDBACK (below cap) or ERRORS (`capReached`),
 *                          commit `gtd: test-failed`; on green commit
 *                          `gtd: tests-green`.
 *   - `closePackage`     — rm the (maybe-empty / maybe-absent) FEEDBACK.md, rm
 *                          the first package dir (+ empty `.gtd/`), commit
 *                          `gtd: close-package`.
 *   - `writeSquashTemplate` — write + commit SQUASH_MSG.md `gtd: squashing`.
 *   - `squashCommit`     — soft-reset to `squashBase`, then `gtd(agent): squashing`
 *                          reads SQUASH_MSG.md at perform time for the message.
 *   - `writeLearningTemplate` — write + commit LEARNINGS.md `gtd: learning`.
 *   - `runHealthCheck`   — run the configured test command; on red write
 *                          HEALTH.md (below cap) or ERRORS.md (`capReached`),
 *                          commit `gtd: health-check`; on green with prior
 *                          fixes and `chainAfterGreen` (squash and/or learning
 *                          enabled), commit `gtd: tests-green` to chain into
 *                          the learning/squash template; otherwise stop idle
 *                          with zero commits.
 */
export type EdgeAction =
  | {
      readonly kind: "captureTurn"
      readonly actor: Actor
      readonly gate: TurnGate
      /** The stamped vector this turn commit carries (attached at dispatch). */
      readonly counters?: Counters
    }
  | {
      readonly kind: "commitRouting"
      readonly subject: string
      readonly seedArchitectureFromTodo?: boolean
      readonly seedArchitectureFromPlan?: boolean
      readonly removeArchitecture?: boolean
      readonly removeReview?: boolean
      readonly removeFeedback?: boolean
      readonly removeHealth?: boolean
      readonly removeLearning?: boolean
      /** The stamped vector this label carries (attached at dispatch). */
      readonly counters?: Counters
    }
  | {
      readonly kind: "runTest"
      readonly errorCount: number
      readonly capReached: boolean
      /**
       * The green outcome, decided at DISPATCH time (write-time labeling):
       * `"agentic-review"` — packages remain, threshold not reached — rest
       * for the reviewer's verdict; `"close-package"` — force-approve
       * (agentic review off, or the review-fix threshold reached) — perform
       * the close inline; `"tests-green"` — the health path's green marker
       * (no packages), whose settle decision follows.
       */
      readonly onGreen: "tests-green" | "agentic-review" | "close-package"
      /** The PREVIOUS vector at dispatch; the writer stamps each outcome label from it. */
      readonly counters?: Counters
    }
  | { readonly kind: "closePackage"; readonly counters?: Counters }
  | { readonly kind: "writeSquashTemplate"; readonly counters?: Counters }
  | { readonly kind: "squashCommit"; readonly squashBase: string }
  | { readonly kind: "writeLearningTemplate"; readonly counters?: Counters }
  | {
      readonly kind: "runHealthCheck"
      readonly errorCount: number
      readonly capReached: boolean
      readonly chainAfterGreen: boolean
      /** The PREVIOUS vector at dispatch; the writer stamps each outcome label from it. */
      readonly counters?: Counters
    }

/** The three derived counters folded from the `COMMIT[]` stream. */
export interface Counters {
  readonly testFixCount: number
  readonly reviewFixCount: number
  readonly healthFixCount: number
}

// ─── Definition types ────────────────────────────────────────────────────────

/** The small set of config/content-dependent facts a subject-only classification still needs. */
export interface ClassifyFlags {
  readonly hasPackages: boolean
  readonly planExists: boolean
  readonly agenticReviewForceApproved: boolean
  readonly squashEnabled: boolean
  readonly hasSquashBase: boolean
  readonly learningEnabled: boolean
  readonly reviewPresent: boolean
}

/**
 * The outcome a matched rule branch selects.
 *   - `rest`   — a prompt-bearing rest: the state `next` reports and the
 *                actor awaited there.
 *   - `chain`  — mid-chain bookkeeping: the state label the hop reports and
 *                the `EdgeAction` the driver performs before re-resolving.
 *   - `defer`  — not decidable from the subject/flags alone; fall through to
 *                the interpreter's fallback ladder (classifyHead's `null`).
 *   - `settle` — the shared learning-then-squash-then-idle decision reached
 *                from `gtd: done`, the health path's `gtd: tests-green`, and
 *                `gtd: learning-applied` (`nextAfterReviewOrLearning`).
 */
export type RuleOutcome =
  | { readonly kind: "rest"; readonly state: GtdState; readonly actor: Actor }
  | {
      readonly kind: "chain"
      readonly state: GtdState
      readonly actor: Actor
      readonly action: EdgeAction
    }
  | { readonly kind: "defer" }
  | { readonly kind: "settle"; readonly state: GtdState; readonly learningAlreadyRan: boolean }

/** One guarded branch of a head-classification rule; first match wins. */
export interface RuleBranch {
  /** Guard over the classification flags; omitted = always matches. */
  readonly when?: (flags: ClassifyFlags) => boolean
  readonly to: RuleOutcome
}

/** Classification rule for a turn commit `gtd(<actor>): <gate>` at HEAD. */
export interface TurnRule {
  readonly actor: Actor
  readonly gate: TurnGate
  readonly branches: readonly RuleBranch[]
}

/**
 * The facts the interrupt/fallback ladder rules consult — the payload plus
 * the handful of derived helpers `resolveBaseline` historically computed
 * inline (fixer-turn exceptions, force-approve, effective-feedback, the
 * reviewable predicate, the nearest workflow turn for recovery).
 */
export interface BaselineFacts {
  readonly payload: ResolvePayload
  readonly counters: Counters
  readonly head: string
  /** HEAD is the health-fixer's own turn commit (`gtd(agent): health-fixing`) consuming HEALTH.md. */
  readonly headIsHealthFixerTurn: boolean
  /** Agentic review is off, or the review-fix threshold is reached. */
  readonly forceApprove: boolean
  /** A review base + non-empty diff + commits since the last `gtd: done`. */
  readonly reviewable: boolean
  /** Nearest workflow turn (skipping boundary commits), for recovery rungs. */
  readonly lastTurn?: { readonly actor: Actor; readonly gate: string }
}

/** One guarded branch of an interrupt/fallback ladder rule; first match wins. */
export interface LadderBranch {
  readonly when?: (facts: BaselineFacts) => boolean
  readonly to: RuleOutcome
}

/** One ordered rung of the interrupt or fallback ladder. */
export interface LadderRule {
  /** Gate for the whole rung; its branches are consulted only when this holds. */
  readonly when: (facts: BaselineFacts) => boolean
  readonly branches: readonly LadderBranch[]
}

/**
 * The zero vector — fresh repos, post-squash boundaries, and histories
 * written before trailers existed.
 */
export const zeroCounters: Counters = { testFixCount: 0, reviewFixCount: 0, healthFixCount: 0 }

/**
 * Write-time counter stamping (the δ-discipline): the WRITER of each machine
 * label derives that commit's vector from the previous label's vector. Labels
 * with no entry carry the previous vector unchanged. Turn-side stamps live on
 * the capture rules (`CaptureRule.stamp`).
 */
export const labelCounterStamps: Partial<Record<RoutingPhase, (prev: Counters) => Counters>> = {
  // A package starts (first or next): fresh test and review budgets.
  building: (prev) => ({ ...prev, testFixCount: 0, reviewFixCount: 0 }),
  "close-package": (prev) => ({ ...prev, testFixCount: 0, reviewFixCount: 0 }),
  // A red round below the cap.
  "test-failed": (prev) => ({ ...prev, testFixCount: prev.testFixCount + 1 }),
  // A red health round below the cap.
  "health-check": (prev) => ({ ...prev, healthFixCount: prev.healthFixCount + 1 }),
  // A green marker ends the health run.
  "tests-green": (prev) => ({ ...prev, healthFixCount: 0 }),
}

/** Apply a machine label's stamp to the previous vector (carry when unmapped). */
export const stampLabelCounters = (phase: RoutingPhase | undefined, prev: Counters): Counters =>
  phase !== undefined ? (labelCounterStamps[phase]?.(prev) ?? prev) : prev

/**
 * One illegal steering-file combination: a predicate over `ResolvePayload`
 * paired with the exact diagnosis `assertLegal` throws when it matches.
 */
export interface IllegalCombinationRule {
  readonly isViolated: (p: ResolvePayload) => boolean
  readonly message: string
}

/**
 * One rung of the dirty-boundary entry-gate pick: which gate the human's
 * entry turn is captured under, driven purely by which steering file the
 * dirty tree already contains (file *presence*, never content). The entry
 * files are pairwise illegal combinations, so the ordered pick is inert.
 */
export interface EntryRule {
  /** Presence predicate; omitted = the default entry (last rung). */
  readonly when?: (p: ResolvePayload) => boolean
  readonly gate: TurnGate
}

/**
 * Structural validation applied when the AGENT is about to capture a fresh
 * turn under this gate — a narrow content-inspection exception (STATES.md
 * §1). Never applied to a human's turn capture at the same gate.
 */
export interface AgentTurnValidation {
  /** Which `ResolvePayload` error list carries this gate's validation. */
  readonly errorsField: "grillingDocErrors" | "reviewDocErrors"
  /** The file named in the refusal message. */
  readonly file: string
}

/**
 * One capture rule of a rest state: when the awaited actor steps, the first
 * matching rule decides the LABEL the turn is committed under — the
 * δ(label, diff) discipline: every branch a label's meaning used to carry in
 * its own diff (empty = accept-defaults, checkbox-only = approval, empty
 * FEEDBACK.md = agentic approval) is decided HERE, at capture time, from the
 * pending tree, and encoded in the label. **No rule matching = a no-op
 * invocation** (zero commits; `gtd next` re-emits the same prompt) — inert
 * empty steps are the DEFAULT, and empty-turn signals are opt-in `empty`
 * rules.
 */
export interface CaptureRule {
  /**
   * `true` — matches a CLEAN tree (an empty-turn signal: accept-defaults,
   * clean approval, environmental health fix). Omitted/false — matches a
   * dirty tree (a real move).
   */
  readonly empty?: boolean
  /** Restrict the rule to one invoking actor (the alternating gates' empty rules are human-only). */
  readonly actor?: Actor
  /** Guard over the pending tree/payload; omitted = always matches. */
  readonly when?: (p: ResolvePayload) => boolean
  /** The `<gate>` label the captured commit carries (`gtd(<actor>): <label>`). */
  readonly label: TurnGate
  /**
   * Write-time counter stamp for the captured commit (default: carry the
   * previous vector). The verdict labels increment the review-fix count; the
   * escalate turn's ERRORS.md deletion resets the test/health budgets.
   */
  readonly stamp?: (prev: Counters, p: ResolvePayload) => Counters
}

/**
 * Per-state declaration. `kind: "prompt"` states are real rests (`gtd next`
 * renders `prompts`, `awaits` names the accepted invoker); `kind: "label"`
 * states only ever appear as the state label on mid-chain hops (edge-only,
 * never rest, never prompt).
 */
export interface StateDef {
  readonly kind: "prompt" | "label"
  /**
   * The actor whose `step` is accepted at this rest. `"dynamic"` marks the
   * alternating gates (grilling/architecting) whose awaited actor is decided
   * per-rest by the matching rule; for `awaitedActor()` purposes a dynamic
   * state defaults to the agent.
   */
  readonly awaits: Actor | "dynamic"
  /**
   * Ordered capture rules: what a step of the awaited actor commits, and
   * under which label (first match wins; none = no-op). Label states carry
   * none — they never rest.
   */
  readonly captureRules?: readonly CaptureRule[]
  /**
   * Prompt template name per awaitable actor (the `@`-names registered in
   * `src/Prompt.ts`). Dynamic states bind both actors; when a result's actor
   * has no binding (e.g. a pending human hop at an agent-prompting state),
   * the single bound template is used — matching the historical
   * one-template-per-state behavior.
   */
  readonly prompts?: Partial<Record<Actor, string>>
  /**
   * Which `ModelState` this state's prompt resolves `{{MODEL}}` against.
   * Human-gated states spawn no subagent and carry none.
   */
  readonly model?: ModelState
}

/** The whole machine shape. `Machine.ts` interprets exactly one of these. */
/**
 * One declared actor. Actors are definition data, not engine constants: the
 * default workflow ships `human` (interactive) and `agent` (autonomous), and
 * a workflow may declare any number of either kind. The `kind` is what the
 * turn-taking engine keys its safety behaviors on — never the name:
 *   - **interactive** — a person at a terminal. Their dirty boundary tree is
 *     the entry turn, their step at idle re-runs the health check, and their
 *     empty turn is always a meaningful signal (accept-defaults, approval).
 *   - **autonomous** — a driven agent. Its clean-tree step at an inert gate
 *     is a no-op (the loop protocol's opening beat), and its authored drafts
 *     are structurally validated before capture.
 */
export interface ActorDef {
  readonly name: Actor
  readonly kind: "interactive" | "autonomous"
}

export interface WorkflowDefinition {
  /** The declared actors; `gtd step <actor>` validates against this set. */
  readonly actors: readonly ActorDef[]
  readonly states: Record<GtdState, StateDef>
  readonly turnRules: readonly TurnRule[]
  readonly routingRules: Partial<Record<RoutingPhase, readonly RuleBranch[]>>
  readonly interrupts: readonly LadderRule[]
  readonly fallback: readonly LadderRule[]
  readonly conflicts: readonly IllegalCombinationRule[]
  readonly entry: readonly EntryRule[]
  readonly agentTurnValidation: Partial<Record<TurnGate, AgentTurnValidation>>
}

// ─── Outcome shorthands ──────────────────────────────────────────────────────

const rest = (state: GtdState, actor: Actor): RuleOutcome => ({ kind: "rest", state, actor })
const chain = (state: GtdState, actor: Actor, action: EdgeAction): RuleOutcome => ({
  kind: "chain",
  state,
  actor,
  action,
})
const defer: RuleOutcome = { kind: "defer" }
const settle = (state: GtdState, learningAlreadyRan: boolean): RuleOutcome => ({
  kind: "settle",
  state,
  learningAlreadyRan,
})

/**
 * HEAD is the human's HEALTH.md entry turn (`gtd(human): health-fixing`) —
 * the hand-written error description was just captured and no agent has
 * acted on it yet. Compared as a subject literal (this file's own actor and
 * gate names) rather than via `parseSubject`, which would be a runtime
 * import cycle — see the module-level note.
 */
const isHumanHealthEntryHead = (head: string): boolean =>
  head.trim() === "gtd(human): health-fixing"

// ─── Default definition: states ──────────────────────────────────────────────

/**
 * The 21 state declarations. Each rest state's `captureRules` decide, at
 * capture time from the pending tree, which label a step commits — the
 * δ(label, diff) discipline. Inert empty steps are the default (no `empty`
 * rule = a clean-tree step is a no-op; the loop protocol opens every
 * iteration with `gtd step agent` BEFORE the agent acts); empty-turn signals
 * are opt-in `empty` rules (accept-defaults at the grilling/architecting
 * answer gates, clean approval at review, accept-the-draft at the learning
 * review, the environmental health fix). Branch labels — `grilling-accepted`
 * vs a plain answer, `review-approved` vs `review-feedback`,
 * `agentic-approved` vs `agentic-findings` — are decided here so their
 * classification never has to re-inspect the turn's own diff.
 */
const states: Record<GtdState, StateDef> = {
  grilling: {
    kind: "prompt",
    awaits: "dynamic",
    prompts: { agent: "@grilling-agent", human: "@grilling-answers" },
    model: "grilling",
    captureRules: [
      { label: "grilling" },
      // Empty HUMAN turn = accept the suggested defaults.
      { empty: true, actor: "human", label: "grilling-accepted" },
    ],
  },
  architecting: {
    kind: "prompt",
    awaits: "dynamic",
    prompts: { agent: "@architecting-agent", human: "@architecting-answers" },
    model: "architecting",
    captureRules: [
      { label: "architecting" },
      { empty: true, actor: "human", label: "architecting-accepted" },
    ],
  },
  grilled: {
    kind: "prompt",
    awaits: "agent",
    prompts: { agent: "@decompose" },
    model: "decompose",
    captureRules: [
      { label: "grilled" },
      // Recovery: a committed PLAN.md at a boundary HEAD rests here awaiting
      // the HUMAN (the fallback ladder's plan rung) — their clean step
      // resumes the entry, whose classification seeds and routes.
      { empty: true, actor: "human", when: (p) => p.planExists, label: "grilled" },
    ],
  },
  planning: {
    kind: "label",
    awaits: "agent",
    // Historical oddity preserved: a capture at the planning rest (pending
    // `.gtd/` package edits under a boundary-ish HEAD) lands under the
    // legacy default gate.
    captureRules: [{ label: "review" }],
  },
  building: {
    kind: "prompt",
    awaits: "agent",
    prompts: { agent: "@building" },
    model: "building",
    captureRules: [{ label: "building" }],
  },
  testing: { kind: "label", awaits: "agent" },
  fixing: {
    kind: "prompt",
    awaits: "agent",
    prompts: { agent: "@fixing" },
    model: "fixing",
    // A dirty tree here includes the delete-dispute (a pending FEEDBACK.md
    // deletion/emptying) — it is the fixer's move, captured like any fix.
    captureRules: [{ label: "fixing" }],
  },
  escalate: {
    kind: "prompt",
    awaits: "human",
    prompts: { human: "@escalate" },
    captureRules: [
      {
        label: "escalate",
        // Deleting ERRORS.md is the budget reset, stamped on the turn itself.
        stamp: (prev, p) =>
          p.pendingErrorsDeletion ? { ...prev, testFixCount: 0, healthFixCount: 0 } : prev,
      },
      // An empty human step still lands the escalate turn (its own chain
      // re-tests; without an ERRORS.md deletion the budget stays spent).
      { empty: true, actor: "human", label: "escalate" },
    ],
  },
  "agentic-review": {
    kind: "prompt",
    awaits: "agent",
    prompts: { agent: "@agentic-review" },
    model: "agentic-review",
    captureRules: [
      // The verdict is the LABEL now: an empty FEEDBACK.md write is the
      // approval; a non-empty one is a findings round. A dirty tree that
      // never wrote FEEDBACK.md at all is a no-verdict turn (inert
      // re-emit after capture — never an implicit approval).
      {
        when: (p) => p.feedbackPresent && p.feedbackEmpty,
        label: "agentic-approved",
        stamp: (prev) => ({ ...prev, reviewFixCount: prev.reviewFixCount + 1 }),
      },
      {
        when: (p) => p.feedbackPresent,
        label: "agentic-findings",
        stamp: (prev) => ({ ...prev, reviewFixCount: prev.reviewFixCount + 1 }),
      },
      { label: "agentic-review" },
    ],
  },
  "close-package": { kind: "label", awaits: "agent" },
  review: {
    kind: "prompt",
    awaits: "agent",
    prompts: { agent: "@review" },
    model: "clean",
    captureRules: [{ label: "review" }],
  },
  "await-review": {
    kind: "prompt",
    awaits: "human",
    prompts: { human: "@await-review" },
    captureRules: [
      // Approval shapes, decided from the PENDING tree: a pure checkbox
      // flip, or deleting .gtd/REVIEW.md outright (and nothing else).
      { when: (p) => p.reviewCheckboxOnly, label: "review-approved" },
      { when: (p) => p.reviewDeletedOnly, label: "review-approved" },
      { label: "review-feedback" },
      // A clean step = touch nothing = approve.
      { empty: true, actor: "human", label: "review-approved" },
    ],
  },
  done: { kind: "label", awaits: "agent" },
  learning: {
    kind: "prompt",
    awaits: "agent",
    prompts: { agent: "@learning" },
    model: "clean",
    // The move IS the draft: only a pending LEARNINGS.md edit captures (a
    // diff fact), so a landed learning turn always carries a real draft and
    // its classification never re-inspects content.
    captureRules: [{ when: (p) => p.learningMsgDirty, label: "learning" }],
  },
  "await-learning-review": {
    kind: "prompt",
    awaits: "human",
    prompts: { human: "@await-learning-review" },
    // No reject path: empty (accept the draft as-is) or edited, the human's
    // step always proceeds forward under the shared learning gate.
    captureRules: [{ label: "learning" }, { empty: true, actor: "human", label: "learning" }],
  },
  "learning-apply": {
    kind: "prompt",
    awaits: "agent",
    prompts: { agent: "@learning-apply" },
    model: "clean",
    captureRules: [{ label: "learning-apply" }],
  },
  "learning-applied": { kind: "label", awaits: "agent" },
  squashing: {
    kind: "prompt",
    awaits: "agent",
    prompts: { agent: "@squashing" },
    model: "clean",
    // The move IS the message: only a pending SQUASH_MSG.md overwrite
    // captures, so a landed squashing turn always squashes a real message —
    // the unmodified template can never be captured, let alone squashed.
    captureRules: [{ when: (p) => p.squashMsgDirty, label: "squashing" }],
  },
  idle: {
    kind: "prompt",
    awaits: "human",
    prompts: { human: "@idle" },
    // No capture rules: a human step at idle is the health-check carve-out
    // (engine), never a turn commit.
  },
  "health-check": { kind: "label", awaits: "agent" },
  "health-fixing": {
    kind: "prompt",
    awaits: "agent",
    prompts: { agent: "@health-fixing" },
    model: "fixing",
    captureRules: [
      { label: "health-fixing" },
      // An empty agent step is the environmental-fix signal — EXCEPT while
      // HEAD is still the human's hand-written HEALTH.md entry turn, whose
      // description must survive until an agent has actually read it.
      {
        empty: true,
        actor: "agent",
        when: (p) => !isHumanHealthEntryHead(p.lastCommitSubject),
        label: "health-fixing",
      },
    ],
  },
}

// ─── Default definition: turn rules ──────────────────────────────────────────

/**
 * Classification rows for turn commits (`gtd(<actor>): <gate>` at HEAD).
 * `(actor, gate)` pairs with no rule fall through to the fallback ladder —
 * exactly the pairs the unrolled `classifyHead` returned `null` for.
 */
const turnRules: readonly TurnRule[] = [
  {
    // Capture rules guarantee a draft turn is never empty, so the landed
    // label is unambiguous: the human answer gate is next.
    actor: "agent",
    gate: "grilling",
    branches: [{ to: rest("grilling", "human") }],
  },
  {
    // A non-empty human answer (the empty accept-defaults case captures as
    // `grilling-accepted` instead) — back to the agent for another round.
    actor: "human",
    gate: "grilling",
    branches: [{ to: rest("grilling", "agent") }],
  },
  {
    // Accept-defaults, decided at capture: seed ARCHITECTURE.md from the
    // converged TODO.md and route onward.
    actor: "human",
    gate: "grilling-accepted",
    branches: [
      {
        to: chain("grilling", "agent", {
          kind: "commitRouting",
          subject: "gtd: architecting",
          seedArchitectureFromTodo: true,
        }),
      },
    ],
  },
  {
    actor: "agent",
    gate: "architecting",
    branches: [{ to: rest("architecting", "human") }],
  },
  {
    actor: "human",
    gate: "architecting",
    branches: [{ to: rest("architecting", "agent") }],
  },
  {
    actor: "human",
    gate: "architecting-accepted",
    branches: [
      { to: chain("architecting", "agent", { kind: "commitRouting", subject: "gtd: grilled" }) },
    ],
  },
  {
    actor: "human",
    gate: "grilled",
    branches: [
      // The PLAN.md entry turn: seed ARCHITECTURE.md from the final plan and
      // route straight to the decompose rest. Guarded on the plan file
      // actually being present: a hand-crafted history without PLAN.md, or a
      // crash half-way through the seed, must not overwrite an
      // already-seeded ARCHITECTURE.md with a banner-only body — fall
      // through to the ladder, whose `architectureExists` rung recovers the
      // half-seeded crash through a normal architecting round.
      {
        when: (f) => f.planExists,
        to: chain("grilled", "agent", {
          kind: "commitRouting",
          subject: "gtd: grilled",
          seedArchitectureFromPlan: true,
        }),
      },
      { to: defer },
    ],
  },
  {
    actor: "agent",
    gate: "grilled",
    branches: [
      // The decompose turn must actually have produced packages before the
      // machine consumes the architecture: routing to `gtd: building`
      // removes `.gtd/ARCHITECTURE.md`, and doing that for a turn WITHOUT
      // packages would destroy the architecture and drop the cycle into a
      // package-less building state that silently skips every review gate.
      {
        when: (f) => f.hasPackages,
        to: chain("grilled", "agent", {
          kind: "commitRouting",
          subject: "gtd: building",
          removeArchitecture: true,
        }),
      },
      { to: rest("grilled", "agent") },
    ],
  },
  {
    actor: "agent",
    gate: "building",
    branches: [
      {
        to: chain("building", "agent", {
          kind: "runTest",
          errorCount: 0,
          capReached: false,
          onGreen: "tests-green",
        }),
      },
    ],
  },
  {
    // Capture rules forbid an empty fixing turn, so a landed one always
    // strips FEEDBACK.md and re-tests in the same invocation.
    actor: "agent",
    gate: "fixing",
    branches: [
      {
        to: chain("fixing", "agent", {
          kind: "runTest",
          errorCount: 0,
          capReached: false,
          onGreen: "tests-green",
        }),
      },
    ],
  },
  {
    // A no-verdict turn: the reviewer dirtied something but never wrote
    // FEEDBACK.md at all (the verdict labels below carry the real outcomes).
    // Inert re-emit — never an implicit approval.
    actor: "agent",
    gate: "agentic-review",
    branches: [{ to: rest("agentic-review", "agent") }],
  },
  {
    // The approval verdict (an empty FEEDBACK.md write, decided at capture):
    // the same invocation closes the package.
    actor: "agent",
    gate: "agentic-approved",
    branches: [{ to: chain("close-package", "agent", { kind: "closePackage" }) }],
  },
  {
    // A findings round: rest for the fixer.
    actor: "agent",
    gate: "agentic-findings",
    branches: [{ to: rest("fixing", "agent") }],
  },
  {
    actor: "agent",
    gate: "review",
    branches: [
      // The record-writing turn must actually have produced `.gtd/REVIEW.md`
      // before the machine routes to the human gate.
      {
        when: (f) => f.reviewPresent,
        to: chain("review", "agent", { kind: "commitRouting", subject: "gtd: await-review" }),
      },
      { to: rest("review", "agent") },
    ],
  },
  {
    // Approval (clean step, checkbox-only flips, or an outright REVIEW.md
    // deletion — decided at capture): settle the cycle.
    actor: "human",
    gate: "review-approved",
    branches: [
      {
        to: chain("review", "human", {
          kind: "commitRouting",
          subject: "gtd: done",
          removeReview: true,
        }),
      },
    ],
  },
  {
    // Substantive feedback: re-grill the agent with the human's diff.
    actor: "human",
    gate: "review-feedback",
    branches: [
      {
        to: chain("review", "human", {
          kind: "commitRouting",
          subject: "gtd: grilling",
          removeReview: true,
        }),
      },
    ],
  },
  {
    actor: "agent",
    gate: "squashing",
    branches: [
      // The capture rule guarantees a landed squashing turn carries a real
      // message (only a pending SQUASH_MSG.md overwrite captures), so the
      // squash proceeds unconditionally once a base exists. The interpreter
      // fills in the real `squashBase`.
      {
        when: (f) => f.hasSquashBase,
        to: chain("squashing", "agent", { kind: "squashCommit", squashBase: "" }),
      },
      { to: rest("squashing", "agent") },
    ],
  },
  {
    actor: "agent",
    gate: "learning",
    branches: [
      // Mirrors squashing: the capture rule guarantees a real draft.
      {
        when: (f) => f.hasSquashBase,
        to: chain("learning", "agent", {
          kind: "commitRouting",
          subject: "gtd: await-learning-review",
        }),
      },
      { to: rest("learning", "agent") },
    ],
  },
  {
    actor: "human",
    gate: "learning",
    branches: [
      // No reject/redo path: any human turn here — even an empty one,
      // meaning "accept the draft as-is" — always proceeds forward.
      {
        to: chain("learning", "human", {
          kind: "commitRouting",
          subject: "gtd: learning-apply",
        }),
      },
    ],
  },
  {
    actor: "agent",
    gate: "learning-apply",
    branches: [
      {
        to: chain("learning-apply", "agent", {
          kind: "commitRouting",
          subject: "gtd: learning-applied",
          removeLearning: true,
        }),
      },
    ],
  },
  {
    actor: "agent",
    gate: "health-fixing",
    branches: [
      {
        to: chain("health-fixing", "agent", {
          kind: "commitRouting",
          subject: "gtd: testing",
          removeHealth: true,
        }),
      },
    ],
  },
  {
    actor: "human",
    gate: "escalate",
    branches: [
      {
        to: chain("escalate", "human", {
          kind: "runTest",
          errorCount: 0,
          capReached: false,
          onGreen: "tests-green",
        }),
      },
    ],
  },
]

// ─── Default definition: routing rules ───────────────────────────────────────

/**
 * Classification rows for routing commits (`gtd: <phase>` at HEAD). A phase
 * mapping to `defer` (or absent) is resolved by the fallback ladder.
 */
const routingRules: Partial<Record<RoutingPhase, readonly RuleBranch[]>> = {
  architecting: [{ to: rest("architecting", "agent") }],
  grilled: [{ to: rest("grilled", "agent") }],
  building: [{ to: rest("building", "agent") }],
  // The health path's green marker (the check writes it only when no
  // packages remain in play) — the settle decision follows. Package-path
  // green outcomes are decided at write time: `gtd: agentic-review` or an
  // inline close.
  "tests-green": [{ to: settle("testing", false) }],
  // The check went green with packages remaining and the threshold not
  // reached: rest for the reviewer's verdict.
  "agentic-review": [{ to: rest("agentic-review", "agent") }],
  // Marker state: a red check outcome BELOW the cap (the check decides at
  // write time — at the cap it writes `gtd: escalated` instead).
  "test-failed": [{ to: rest("fixing", "agent") }],
  // The check crossed the fix-attempt cap and wrote ERRORS.md: a human gate.
  escalated: [{ to: rest("escalate", "human") }],
  // Depends on remaining packages / reviewable diff — fallback ladder.
  "close-package": [{ to: defer }],
  "await-review": [{ to: rest("await-review", "human") }],
  // The human's review feedback re-enters grilling with their diff.
  grilling: [{ to: rest("grilling", "agent") }],
  done: [{ to: settle("done", false) }],
  squashing: [{ to: rest("squashing", "agent") }],
  review: [{ to: rest("review", "agent") }],
  learning: [{ to: rest("learning", "agent") }],
  "await-learning-review": [{ to: rest("await-learning-review", "human") }],
  "learning-apply": [{ to: rest("learning-apply", "agent") }],
  "learning-applied": [{ to: settle("learning-applied", true) }],
  "health-check": [{ to: rest("health-fixing", "agent") }],
  // `gtd: testing` — a re-test is owed (the health-fixer's turn consumed
  // HEALTH.md). A plain REST for classification purposes (`gtd next`/pure
  // queries report idle/human here, since a clean tree "self-heals" — the
  // very next invocation's health check simply re-runs). But an actual
  // mutating invocation landing HERE mid-chain must re-test in that same
  // chain rather than stopping — handled as a carve-out in the turn-taking
  // engine, not here.
  testing: [{ to: rest("idle", "human") }],
}

// ─── Default definition: interrupt ladder ────────────────────────────────────

/**
 * Steering-file precedence, checked BEFORE HEAD classification: these fire
 * regardless of what HEAD says, because the file presence is itself more
 * current than the last commit. Only the two check-outcome files remain here
 * (they are written by the checks, not by labeled turns — a Phase C concern);
 * the FEEDBACK.md rung dissolved when the agentic verdict moved into the
 * capture-time labels (`agentic-approved` / `agentic-findings`). The
 * health-fixer-turn exception keeps the precedence from pre-empting the very
 * turn that consumes the file.
 */
const interrupts: readonly LadderRule[] = [
  {
    when: (f) => f.payload.healthPresent && !f.headIsHealthFixerTurn,
    branches: [{ to: rest("health-fixing", "agent") }],
  },
]

// ─── Default definition: fallback ladder ─────────────────────────────────────

/** No steering files at all — the boundary/idle lifecycle rung's gate. */
const noSteeringFiles = (p: ResolvePayload): boolean =>
  !p.packagesPresent &&
  !p.reviewPresent &&
  !p.feedbackPresent &&
  !p.errorsPresent &&
  !p.healthPresent &&
  !p.todoExists &&
  !p.architectureExists &&
  !p.planExists

/**
 * The payload-driven ladder for the rows HEAD classification cannot resolve
 * alone (boundary subjects, `package-done`'s package/diff-dependent split),
 * checked in order AFTER classification. No rung matching is the corruption
 * error — the interpreter refuses to guess.
 */
const fallback: readonly LadderRule[] = [
  {
    // .gtd modified (package files added/edited) → Planning, regardless of HEAD.
    when: (f) => f.payload.packagesPresent && f.payload.gtdModified,
    branches: [{ to: rest("planning", "agent") }],
  },
  {
    when: (f) => f.head === "gtd: close-package",
    branches: [
      { when: (f) => f.payload.packages.length > 0, to: rest("building", "agent") },
      { when: (f) => f.reviewable, to: rest("review", "agent") },
      { to: rest("idle", "human") },
    ],
  },
  {
    // TODO.md present, boundary/other HEAD (e.g. right after `gtd: review
    // feedback`'s rest, or a fresh dirty-boundary entry already captured) —
    // grilling continues.
    when: (f) => f.payload.todoExists,
    branches: [{ to: rest("grilling", "agent") }],
  },
  {
    // ARCHITECTURE.md present, boundary/other HEAD — architecting continues.
    // The two never coexist (assertLegal guards it), so ordering between the
    // two rungs is inert.
    when: (f) => f.payload.architectureExists,
    branches: [{ to: rest("architecting", "agent") }],
  },
  {
    // PLAN.md present, boundary/other HEAD. Unlike TODO.md/ARCHITECTURE.md,
    // PLAN.md is only ever human-authored entry input, so the awaited actor
    // is the HUMAN: a committed PLAN.md at a boundary HEAD is recovered by
    // the human's `gtd step` resuming the entry.
    when: (f) => f.payload.planExists,
    branches: [{ to: rest("grilled", "human") }],
  },
  {
    // `.gtd/` exists with a pending package, and the nearest workflow commit
    // (skipping any boundary commits on top of it) is still the
    // `gtd(agent): building` checkpoint — an operational recovery commit
    // landed on top of it after a mid-chain failure. Resume the interrupted
    // chain as a mid-chain test run, NOT a rest: the build work is already
    // committed in the checkpoint turn, so the only thing left of the chain
    // is the test run the failure interrupted. (The budget placeholders stay
    // zero here — this rung is deliberately outside the classify fill-ins.)
    when: (f) =>
      f.payload.packagesPresent &&
      f.payload.packages.length > 0 &&
      f.lastTurn?.actor === "agent" &&
      f.lastTurn.gate === "building",
    branches: [
      {
        to: chain("building", "agent", {
          kind: "runTest",
          errorCount: 0,
          capReached: false,
          onGreen: "tests-green",
        }),
      },
    ],
  },
  {
    // A committed ERRORS.md under an unrecognized (boundary) HEAD — rider/
    // crash recovery; the machine's own cap writes land as `gtd: escalated`.
    when: (f) => f.payload.errorsPresent,
    branches: [{ to: rest("escalate", "human") }],
  },
  {
    // A committed FEEDBACK.md under an unrecognized (boundary) HEAD — e.g. a
    // rider commit atop a findings round. The verdict labels normally carry
    // this state; these rungs are pure crash/rider recovery, preserving the
    // old precedence outcomes: an (effectively) empty verdict closes, real
    // findings rest for the fixer. A pending deletion counts as emptied (the
    // delete-dispute shape).
    when: (f) => f.payload.feedbackPresent || f.payload.pendingFeedbackDeletion,
    branches: [
      {
        when: (f) => f.payload.feedbackEmpty || f.payload.pendingFeedbackDeletion,
        to: chain("close-package", "agent", { kind: "closePackage" }),
      },
      { to: rest("fixing", "agent") },
    ],
  },
  {
    // No steering files, no recognized workflow HEAD: boundary/idle lifecycle.
    when: (f) => noSteeringFiles(f.payload),
    branches: [
      { when: (f) => f.reviewable, to: rest("review", "agent") },
      { to: rest("idle", "human") },
    ],
  },
]

// ─── Default definition: illegal combinations ────────────────────────────────

// HEALTH.md-specific combinations are listed before the generic "<file>
// without packages" rules below: HEALTH.md + FEEDBACK.md (or + ERRORS.md) with
// no work packages present would otherwise also match the generic "FEEDBACK.md
// without packages" / "ERRORS.md without packages" rules, whose message names
// only one file and doesn't mention HEALTH.md at all — the more specific
// two-file diagnosis must win, so it must be checked first.
const healthFileConflictRules: readonly IllegalCombinationRule[] = [
  {
    isViolated: (p) => p.healthPresent && p.packagesPresent,
    message: ".gtd/HEALTH.md + packages",
  },
  {
    isViolated: (p) => p.healthPresent && p.reviewPresent,
    message: ".gtd/HEALTH.md + .gtd/REVIEW.md",
  },
  {
    isViolated: (p) => p.healthPresent && p.feedbackPresent,
    message: ".gtd/HEALTH.md + .gtd/FEEDBACK.md",
  },
  {
    isViolated: (p) => p.healthPresent && p.errorsPresent,
    message: ".gtd/HEALTH.md + .gtd/ERRORS.md",
  },
  // HEALTH.md now doubles as an entry file (a hand-written error description
  // enters the fix loop directly), so it must be unambiguous against the
  // other entry files. This also outlaws scribbling a next-feature TODO.md/
  // ARCHITECTURE.md draft while a health detour is live — previously a
  // tolerated ride-along that silently misattributed the draft into the
  // health-fixer's turn; now a refused guess.
  {
    isViolated: (p) => p.healthPresent && p.todoExists,
    message: ".gtd/HEALTH.md + .gtd/TODO.md",
  },
  {
    isViolated: (p) => p.healthPresent && p.architectureExists,
    message: ".gtd/HEALTH.md + .gtd/ARCHITECTURE.md",
  },
  {
    isViolated: (p) => p.healthPresent && p.planExists,
    message: ".gtd/HEALTH.md + .gtd/PLAN.md",
  },
]

// PLAN.md is a pure entry file: it exists only between the human writing it
// and the entry turn's seed hop consuming it, so it may never coexist with
// any other steering state. The SQUASH_MSG.md/LEARNINGS.md rules are
// defensive (like `learningFileConflictRules`): without them a stray PLAN.md
// would ride into a squash/learning capture, strand committed at a boundary
// HEAD, and silently block every future dirty-boundary entry.
const planFileConflictRules: readonly IllegalCombinationRule[] = [
  { isViolated: (p) => p.planExists && p.todoExists, message: ".gtd/PLAN.md + .gtd/TODO.md" },
  {
    isViolated: (p) => p.planExists && p.architectureExists,
    message: ".gtd/PLAN.md + .gtd/ARCHITECTURE.md",
  },
  { isViolated: (p) => p.planExists && p.packagesPresent, message: ".gtd/PLAN.md + packages" },
  { isViolated: (p) => p.planExists && p.reviewPresent, message: ".gtd/PLAN.md + .gtd/REVIEW.md" },
  {
    isViolated: (p) => p.planExists && p.feedbackPresent,
    message: ".gtd/PLAN.md + .gtd/FEEDBACK.md",
  },
  { isViolated: (p) => p.planExists && p.errorsPresent, message: ".gtd/PLAN.md + .gtd/ERRORS.md" },
  {
    isViolated: (p) => p.planExists && p.squashMsgPresent,
    message: ".gtd/PLAN.md + .gtd/SQUASH_MSG.md",
  },
  {
    isViolated: (p) => p.planExists && p.learningMsgPresent,
    message: ".gtd/PLAN.md + .gtd/LEARNINGS.md",
  },
]

// LEARNINGS.md, like SQUASH_MSG.md, is HEAD-classification-driven, not
// precedence-driven — none of these can fire on a legal history (packages,
// REVIEW.md, FEEDBACK.md, ERRORS.md, and TODO.md are all gone by `gtd: done`;
// HEALTH.md is removed before tests-green; SQUASH_MSG.md is only written
// after `gtd: learning-applied` removes LEARNINGS.md). Defensive only: refuse
// to guess on a corrupted repo rather than silently mis-resolve.
const learningFileConflictRules: readonly IllegalCombinationRule[] = [
  {
    isViolated: (p) => p.learningMsgPresent && p.packagesPresent,
    message: ".gtd/LEARNINGS.md + packages",
  },
  {
    isViolated: (p) => p.learningMsgPresent && p.reviewPresent,
    message: ".gtd/LEARNINGS.md + .gtd/REVIEW.md",
  },
  {
    isViolated: (p) => p.learningMsgPresent && p.feedbackPresent,
    message: ".gtd/LEARNINGS.md + .gtd/FEEDBACK.md",
  },
  {
    isViolated: (p) => p.learningMsgPresent && p.errorsPresent,
    message: ".gtd/LEARNINGS.md + .gtd/ERRORS.md",
  },
  {
    isViolated: (p) => p.learningMsgPresent && p.healthPresent,
    message: ".gtd/LEARNINGS.md + .gtd/HEALTH.md",
  },
  {
    isViolated: (p) => p.learningMsgPresent && p.squashMsgPresent,
    message: ".gtd/LEARNINGS.md + .gtd/SQUASH_MSG.md",
  },
]

/** ERRORS.md briefly outlives the packages during the health-check cap escalation. */
const isHealthCapEscalation = (p: ResolvePayload): boolean =>
  p.lastCommitSubject === "gtd: health-check" ||
  p.lastCommitSubject === "gtd: testing" ||
  p.lastCommitSubject === "gtd: escalated"

const reviewAndFeedbackRules: readonly IllegalCombinationRule[] = [
  {
    isViolated: (p) => p.reviewPresent && p.packagesPresent,
    message: ".gtd/REVIEW.md + packages",
  },
  {
    isViolated: (p) => p.reviewPresent && p.todoCommitted,
    message: ".gtd/REVIEW.md + committed .gtd/TODO.md",
  },
  {
    isViolated: (p) => p.reviewPresent && !(p.reviewCommitted || p.reviewDirty) && p.todoExists,
    message: "uncommitted .gtd/REVIEW.md + .gtd/TODO.md",
  },
  {
    isViolated: (p) => p.reviewPresent && p.architectureCommitted,
    message: ".gtd/REVIEW.md + committed .gtd/ARCHITECTURE.md",
  },
  {
    isViolated: (p) =>
      p.reviewPresent && !(p.reviewCommitted || p.reviewDirty) && p.architectureExists,
    message: "uncommitted .gtd/REVIEW.md + .gtd/ARCHITECTURE.md",
  },
  // TODO.md and ARCHITECTURE.md are two lifecycle stages of the same document
  // — they never legitimately coexist.
  {
    isViolated: (p) => p.todoExists && p.architectureExists,
    message: ".gtd/TODO.md + .gtd/ARCHITECTURE.md",
  },
  {
    isViolated: (p) => p.feedbackPresent && p.reviewPresent,
    message: ".gtd/FEEDBACK.md + .gtd/REVIEW.md",
  },
  {
    isViolated: (p) => p.feedbackPresent && !p.packagesPresent,
    message: ".gtd/FEEDBACK.md without packages",
  },
  {
    isViolated: (p) => p.errorsPresent && p.feedbackPresent,
    message: ".gtd/ERRORS.md + .gtd/FEEDBACK.md",
  },
  {
    isViolated: (p) => p.errorsPresent && !p.packagesPresent && !isHealthCapEscalation(p),
    message: ".gtd/ERRORS.md without packages",
  },
]

/**
 * The documented illegal-combination set, in checked order: HEALTH.md's rules
 * run as their own pass ahead of the REVIEW.md/FEEDBACK.md/ERRORS.md rules
 * (see the comment above `healthFileConflictRules`), then each remaining rule
 * in the documented precedence order.
 */
const conflicts: readonly IllegalCombinationRule[] = [
  ...healthFileConflictRules,
  ...learningFileConflictRules,
  ...planFileConflictRules,
  ...reviewAndFeedbackRules,
]

// ─── Default definition: entry points + validation ───────────────────────────

/**
 * Which gate the dirty-boundary entry turn is captured under, by steering-file
 * presence:
 *   - `.gtd/HEALTH.md`       → `health-fixing` (a hand-written error
 *                              description enters the fix loop directly)
 *   - `.gtd/PLAN.md`         → `grilled` (a final architecture goes straight
 *                              to decomposition)
 *   - `.gtd/ARCHITECTURE.md` → `architecting` (an already-technical sketch
 *                              skips product grilling)
 *   - anything else          → `grilling` (product grilling, the default)
 * The four are pairwise illegal combinations (`conflicts`), so the pick order
 * is inert.
 */
const entry: readonly EntryRule[] = [
  { when: (p) => p.healthPresent, gate: "health-fixing" },
  { when: (p) => p.planExists, gate: "grilled" },
  { when: (p) => p.architectureExists, gate: "architecting" },
  { gate: "grilling" },
]

/**
 * A malformed grilling/architecting/review draft blocks the AGENT's own turn
 * capture — a narrow content-inspection exception, alongside FEEDBACK.md
 * emptiness and REVIEW.md checkbox-only diffs (STATES.md §1). Keyed by the
 * capture GATE; never applied to a human's turn capture at the same gate.
 */
const agentTurnValidation: Partial<Record<TurnGate, AgentTurnValidation>> = {
  grilling: { errorsField: "grillingDocErrors", file: ".gtd/TODO.md" },
  architecting: { errorsField: "grillingDocErrors", file: ".gtd/ARCHITECTURE.md" },
  review: { errorsField: "reviewDocErrors", file: ".gtd/REVIEW.md" },
}

// ─── The default workflow ────────────────────────────────────────────────────

/** The gtd v2 machine, expressed as data. `Machine.ts` interprets this. */
/** The default turn-taking pair. Workflows may declare more of either kind. */
const actors: readonly ActorDef[] = [
  { name: "human", kind: "interactive" },
  { name: "agent", kind: "autonomous" },
]

export const defaultWorkflow: WorkflowDefinition = {
  actors,
  states,
  turnRules,
  routingRules,
  interrupts,
  fallback,
  conflicts,
  entry,
  agentTurnValidation,
}

// ─── Actor helpers (over the active definition) ──────────────────────────────

const actorByName = (name: string): ActorDef | undefined =>
  defaultWorkflow.actors.find((a) => a.name === name)

/** The declared actor names, for CLI validation and error messages. */
export const definedActorNames = (): readonly string[] => defaultWorkflow.actors.map((a) => a.name)

/** True when `name` is a declared actor of the active definition. */
export const isDefinedActor = (name: string): boolean => actorByName(name) !== undefined

/** True for a declared interactive actor (false for unknown names and "none"). */
export const isInteractiveActor = (name: string): boolean =>
  actorByName(name)?.kind === "interactive"

/** True for a declared autonomous actor (false for unknown names and "none"). */
export const isAutonomousActor = (name: string): boolean => actorByName(name)?.kind === "autonomous"

/**
 * The definition's first interactive actor — the actor entry turns are
 * predicted for, and the fallback awaited actor at human-gated recoveries.
 */
export const defaultInteractiveActor = (): Actor =>
  defaultWorkflow.actors.find((a) => a.kind === "interactive")?.name ?? "human"

/**
 * The definition's first autonomous actor — the actor `awaits: "dynamic"`
 * states default to, and the driver of machine-owned chains.
 */
export const defaultAutonomousActor = (): Actor =>
  defaultWorkflow.actors.find((a) => a.kind === "autonomous")?.name ?? "agent"
