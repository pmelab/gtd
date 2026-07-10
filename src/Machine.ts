/**
 * Pure, event-sourced resolver for the gtd state machine.
 *
 * This module is the **canonical public contract** for the runtime: edge code
 * (`Events.ts`) parses the working tree + first-parent commit history into the
 * events below, then `resolve(events)` folds them into a single resolved state,
 * the counters the prompts need, and an optional `EdgeAction` the driver must
 * perform before re-gathering and re-resolving.
 *
 * It is intentionally free of IO: no git, no filesystem, no Effect, no xstate.
 * The decision logic is STATES.md § Precedence implemented as a first-match-wins
 * ladder, plus the two counter folds (`testFixCount` / `reviewFixCount`) over
 * the `COMMIT[]` stream. Keeping it pure makes the whole decision tree trivially
 * unit-testable in isolation.
 *
 * State is folded from **first-parent** history only (single writer, linear
 * branch). A merge commit at HEAD is unsupported — it breaks the counter folds,
 * the review base, and last-commit detection; this is documented, not handled.
 */

/**
 * Sentinel written to `SQUASH_MSG.md` by `runHealthCheck` on a green health run
 * with prior fix commits (squash enabled). Its presence signals "health check
 * confirmed green; agent has not yet authored the real squash message." The
 * machine uses this to route to the squash prompt (which re-prompts the agent to
 * replace the sentinel with a real conventional-commits message) rather than
 * looping back into `runHealthCheck`. Rule 4c fires only when
 * `squashMsgContent !== HEALTH_SQUASH_SENTINEL` — i.e. the agent has written a
 * real message.
 */
export const HEALTH_SQUASH_SENTINEL = "<!-- gtd-health-squash-ready -->\n"

/** The 19 resolved states (STATES.md § States). `Result.state` is one of these. */
export type GtdState =
  | "transport"
  | "new-feature"
  | "grilling"
  | "grilled"
  | "planning"
  | "building"
  | "testing"
  | "fixing"
  | "escalate"
  | "agentic-review"
  | "close-package"
  | "clean"
  | "await-review"
  | "accept-review"
  | "done"
  | "squashing"
  | "idle"
  | "health-check"
  | "health-fixing"

/**
 * One first-parent commit, reduced to the flags the folds consume. The edge
 * derives every flag from the commit subject (and, for `removedErrors`, the
 * commit's name-status diff):
 *   - `isErrors`        — subject is `gtd: errors`
 *   - `isFeedback`      — subject is `gtd: feedback`
 *   - `isPackageStart`  — subject is `gtd: planning` OR `gtd: package done`
 *   - `isWorkflowCommit`— subject starts `gtd: ` (any phase commit)
 *   - `removedErrors`   — that commit's diff deleted `ERRORS.md`
 *   - `isHealthCheck`   — subject is `gtd: health-check`
 *   - `isHealthFix`     — subject is `gtd: health-fix`
 *
 * Ad-hoc review anchor: `gtd: reviewing` — used as the squash anchor when
 * initiating an ad-hoc review outside a normal workflow cycle (i.e. the
 * `review` command). It plays the same structural role as `gtd: new task`
 * (marks a review base) but targets the Clean state directly rather than
 * seeding a task.
 */
export interface CommitEvent {
  readonly type: "COMMIT"
  readonly isErrors: boolean
  readonly isFeedback: boolean
  readonly isPackageStart: boolean
  readonly isWorkflowCommit: boolean
  readonly removedErrors: boolean
  readonly isHealthCheck: boolean
  readonly isHealthFix: boolean
}

/** The terminal working-tree snapshot the ladder branches on. */
export interface ResolveEvent {
  readonly type: "RESOLVE"
  readonly payload: ResolvePayload
}

/**
 * The event stream `resolve` folds. A typical stream is the first-parent commit
 * history (`COMMIT[]`, oldest→newest) followed by a single terminal `RESOLVE`
 * carrying the current working-tree snapshot. The edge never re-enters the
 * machine with a test result or review record — those are handled at the edge.
 */
export type GtdEvent = CommitEvent | ResolveEvent

/** A `.gtd/` work package, reduced to what the prompts list. */
export interface GtdPackageFact {
  readonly name: string
  /** Task `.md` filenames, sorted. */
  readonly tasks: readonly string[]
  /** Full contents of each task `.md`, parallel-sorted to `tasks`. */
  readonly taskContents: readonly { readonly name: string; readonly content: string }[]
}

/**
 * The working-tree snapshot carried by a `RESOLVE` event: steering-file presence
 * and dirtiness, the last commit subject, and prompt passthrough. Presence and
 * dirtiness only — **no counts** (the counts fold from `COMMIT[]` in the machine).
 */
export interface ResolvePayload {
  /** `TODO.md` exists (committed or pending). */
  readonly todoExists: boolean
  /**
   * The present `TODO.md` is tracked at HEAD — a committed plan being iterated
   * (later grilling rounds capture user code sketches) vs a freshly seeded,
   * uncommitted one (the seed round commits the seed revert verbatim).
   */
  readonly todoCommitted: boolean
  /** `.gtd/` exists. */
  readonly gtdDirExists: boolean
  /** `REVIEW.md` is present (committed and/or pending). */
  readonly reviewPresent: boolean
  /** `FEEDBACK.md` is present (committed and/or pending). */
  readonly feedbackPresent: boolean
  /** A committed `ERRORS.md` is present — the test loop escalated. */
  readonly errorsPresent: boolean
  /** `.gtd/` package files were added/edited vs the committed tree. */
  readonly gtdModified: boolean
  /** Pending changes outside the steering set (TODO/REVIEW/FEEDBACK/ERRORS/.gtd). */
  readonly codeDirty: boolean
  /** The `<!-- user answers here -->` sentinel appears anywhere in `TODO.md` (after code-fence strip). */
  readonly todoMarkerPresent: boolean
  /** The present `FEEDBACK.md` is committed (written by Testing as `gtd: errors`). */
  readonly feedbackCommitted: boolean
  /** The present `FEEDBACK.md` is whitespace-only (`!/\S/`) — a clean agentic review = approval. */
  readonly feedbackEmpty: boolean
  /** Full text of the present `FEEDBACK.md` ("" when absent) — the edge reads it before removal so Fixing can inline it. */
  readonly feedbackContent: string
  /** `REVIEW.md` is committed AND the tree is clean (the human ran gtd without edits = approval). */
  readonly reviewCommitted: boolean
  /** `REVIEW.md` is committed BUT there are pending edits (to REVIEW or other files). */
  readonly reviewDirty: boolean
  /** Pending REVIEW.md change is a pure checkbox-state flip (`- [ ]` ↔ `- [x]`) and nothing else is dirty. */
  readonly reviewCheckboxOnly: boolean
  /** The working tree deletes a committed `ERRORS.md` (human resume → fresh budget). */
  readonly pendingErrorsDeletion: boolean
  /** Subject of HEAD (first-parent). */
  readonly lastCommitSubject: string
  /** The whole working tree is clean. */
  readonly workingTreeClean: boolean
  /** `.gtd/` packages, lowest-numbered first; `packages[0]` is the active one. */
  readonly packages: readonly GtdPackageFact[]
  /** The base commit for a Clean review, if one is available. */
  readonly reviewBase?: string
  /** `git diff <reviewBase> HEAD` (workflow files excluded) — non-empty distinguishes Clean from Idle. */
  readonly refDiff?: string
  /**
   * The review re-trigger gate, resolved at the edge: commits exist after the
   * last `gtd: done` (or no `gtd: done` exists). `false` forces the Clean/Idle
   * rule to Idle even with a reviewable diff, so an approved review settles
   * instead of immediately re-firing (the review → approve → done → review loop).
   * Gates only *whether* a review fires — never what `reviewBase` covers.
   */
  readonly hasCommitsAfterLastDone: boolean
  /** Agentic review enabled (config kill-switch; false → Agentic Review force-approves). */
  readonly agenticReviewEnabled: boolean
  /** Fix-attempt cap (config, default 3). `capReached` = `testFixCount >= fixAttemptCap`. */
  readonly fixAttemptCap: number
  /** Review-fix threshold (config, default 3). `reviewFixCount >= reviewThreshold` → force-approve. */
  readonly reviewThreshold: number
  /**
   * Parent commit of the first persisting cycle commit (the Rule-1 review base).
   * Set by the edge only when HEAD is `gtd: done` and squash is enabled.
   */
  readonly squashBase?: string
  /** `git diff <squashBase> HEAD`, the whole feature diff, inlined into the squashing prompt. */
  readonly squashDiff?: string
  /** Squash enabled (config kill-switch; false → skip squashing after `gtd: done`). */
  readonly squashEnabled: boolean
  readonly squashMsgPresent: boolean
  readonly squashMsgContent: string
  /** `HEALTH.md` exists (committed or pending). */
  readonly healthPresent: boolean
  /** Full text of the present `HEALTH.md` ("" when absent). */
  readonly healthContent: string
  /** `HEALTH.md` is tracked at HEAD (committed health check) vs pending. */
  readonly healthCommitted: boolean
  /**
   * Parent commit of the first persisting health-fix cycle commit.
   * Set by the edge only when squash is enabled.
   */
  readonly healthFixBase?: string
}

/**
 * A side effect the driver performs, then re-gathers + re-resolves until a
 * prompt-bearing or STOP state. The machine only decides which action; the
 * semantics live in the Events/driver tasks.
 *   - `transportReset`   — mixed-reset the `gtd: transport` HEAD, re-derive.
 *   - `seedNewFeature`   — capture raw input `gtd: new task`, revert it, seed TODO.md.
 *   - `seedAcceptReview` — capture the review changeset `gtd: review feedback`
 *                          (commit-then-revert), rm REVIEW.md, seed TODO.md. When HEAD
 *                          already carries the capture subject (regen), discard partial
 *                          state and re-derive from the commit.
 *   - `captureGrillingEdits` — fold the pending code diff into TODO.md as a suggestion
 *                          block, drop the code changes (reset tracked, delete
 *                          untracked), commit the lot `gtd: grilling`.
 *   - `runTest`          — commit pending `gtd: building`, run tests; on red write
 *                          FEEDBACK (below cap) or ERRORS (`capReached`), commit `gtd: errors`.
 *                          A green re-test of a no-op fixer (clean tree, HEAD
 *                          `gtd: fixing`) commits an empty `gtd: building` to advance HEAD.
 *   - `commitPending`    — commit the pending tree with a fixed `prefix`
 *                          (grilling / grilled / planning / fixing). `removeFeedback`
 *                          deletes FEEDBACK.md first so Fixing lands its removal in the
 *                          `gtd: fixing` / `gtd: feedback` commit (else Fixing re-fires forever).
 *                          `removeTodo` deletes TODO.md first so its removal lands in the
 *                          `gtd: planning` commit (once-only, at the planning→building edge).
 *   - `closePackage`     — rm the (maybe-empty / maybe-absent) FEEDBACK.md, rm the
 *                          first package dir (+ empty `.gtd/`), commit `gtd: package done`.
 *   - `commitReview`     — commit REVIEW.md `gtd: awaiting review`.
 *   - `done`             — rm REVIEW.md, commit `gtd: done`.
 */
export type EdgeAction =
  | { readonly kind: "transportReset" }
  | { readonly kind: "seedNewFeature" }
  | { readonly kind: "seedAcceptReview" }
  | { readonly kind: "captureGrillingEdits" }
  | { readonly kind: "runTest"; readonly errorCount: number; readonly capReached: boolean }
  | {
      readonly kind: "commitPending"
      readonly prefix: string
      readonly removeFeedback?: boolean
      /** Delete TODO.md first so its removal lands in the `gtd: planning` commit. */
      readonly removeTodo?: boolean
      /** Delete HEALTH.md first so its removal lands in the `gtd: health-check`/`gtd: health-fix` commit. */
      readonly removeHealth?: boolean
    }
  | {
      readonly kind: "runHealthCheck"
      readonly errorCount: number
      readonly capReached: boolean
      /** Parent commit of the first health-check in the current run (squash base). Only set when squash is enabled and healthFixCount > 0. */
      readonly healthFixBase?: string
      /** Commit the pending ERRORS.md deletion (budget reset) before running the test. */
      readonly commitErrorsReset?: boolean
    }
  | { readonly kind: "closePackage" }
  | { readonly kind: "commitReview" }
  | { readonly kind: "done" }
  | {
      readonly kind: "squashCommit"
      readonly squashBase: string
      readonly commitMessage: string
    }
  | {
      /**
       * Remove the HEALTH_SQUASH_SENTINEL file (SQUASH_MSG.md written by
       * `runHealthCheck` on green-with-fixes) so the squash-prompt state is
       * presented with a clean slate. Performed before the squash prompt is
       * emitted; the agent then writes the real SQUASH_MSG.md on its turn.
       */
      readonly kind: "removeHealthSentinel"
    }
  | {
      /**
       * Remove a stray SQUASH_MSG.md found under a boundary HEAD with no
       * matching squash cycle (squashBase undefined or squashEnabled false).
       * A SQUASH_MSG.md left from an aborted squash cycle must not seed a new
       * feature — this action cleans it up; the next gather then sees a clean
       * tree and routes to health-check or idle as normal.
       */
      readonly kind: "removeStraySquashMsg"
    }

/** The folded prompt context carried on every `Result`. */
export interface ResolveContext {
  /** `gtd: errors` commits since the most recent of {package-start, `gtd: feedback`, ERRORS.md removal}. */
  readonly testFixCount: number
  /** `gtd: feedback` commits since the most recent package-start. */
  readonly reviewFixCount: number
  /** `.gtd/` packages (passthrough); `packages[0]` is active. */
  readonly packages: readonly GtdPackageFact[]
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
  /** Set only for `state:"grilling"`: the STOP-for-answers vs agent-iterate sub-case. */
  readonly grillingCase?: "stop" | "iterate"
}

/** The resolved decision: the state, whether the agent should re-run, an optional edge action, and context. */
export interface Result {
  readonly state: GtdState
  readonly autoAdvance: boolean
  readonly edgeAction?: EdgeAction
  readonly context: ResolveContext
}

/** The three derived counters folded from the `COMMIT[]` stream. */
export interface Counters {
  readonly testFixCount: number
  readonly reviewFixCount: number
  readonly healthFixCount: number
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
 * Counter folds over the event stream (oldest→newest), in the machine — the edge
 * stays thin. Only `COMMIT` events contribute; `RESOLVE` events are ignored here.
 *
 * - `testFixCount` resets to 0 on any of {`isPackageStart`, `isFeedback`,
 *   `removedErrors`} and increments on `isErrors` — so each test-fix sub-loop,
 *   each review-fix, and a human resume (the `gtd: building` that deleted
 *   ERRORS.md) each start a fresh budget.
 * - `reviewFixCount` resets to 0 on `isPackageStart` and increments on
 *   `isFeedback` — review-fix rounds since the package start.
 * - `healthFixCount` resets to 0 on `isPackageStart` and `removedErrors`,
 *   and increments on `isHealthCheck` — health-fix rounds since the last reset.
 */
// fallow-ignore-next-line complexity
export const foldCounters = (events: readonly GtdEvent[]): Counters => {
  let testFixCount = 0
  let reviewFixCount = 0
  let healthFixCount = 0
  for (const event of events) {
    if (event.type !== "COMMIT") continue
    if (event.isPackageStart || event.isFeedback || event.removedErrors) testFixCount = 0
    if (event.isErrors) testFixCount += 1
    if (event.isPackageStart) reviewFixCount = 0
    if (event.isFeedback) reviewFixCount += 1
    if (event.isPackageStart || event.removedErrors) healthFixCount = 0
    if (event.isHealthCheck) healthFixCount += 1
  }
  return { testFixCount, reviewFixCount, healthFixCount }
}

/** A boundary commit: a non-`gtd:` subject, or exactly `gtd: done`. Marks a cold start. */
const isBoundary = (subject: string): boolean =>
  !subject.startsWith("gtd: ") || subject === "gtd: done"

/**
 * The payload a degenerate `RESOLVE`-less stream resolves against — also the
 * canonical field-default table tests spread-override instead of hand-writing
 * every `ResolvePayload` field.
 */
export const DEFAULT_PAYLOAD: ResolvePayload = {
  todoExists: false,
  todoCommitted: false,
  gtdDirExists: false,
  reviewPresent: false,
  feedbackPresent: false,
  errorsPresent: false,
  gtdModified: false,
  codeDirty: false,
  todoMarkerPresent: false,
  feedbackCommitted: false,
  feedbackEmpty: false,
  feedbackContent: "",
  reviewCommitted: false,
  reviewDirty: false,
  reviewCheckboxOnly: false,
  pendingErrorsDeletion: false,
  lastCommitSubject: "",
  workingTreeClean: true,
  packages: [],
  hasCommitsAfterLastDone: true,
  agenticReviewEnabled: true,
  fixAttemptCap: 3,
  reviewThreshold: 3,
  squashEnabled: false,
  squashMsgPresent: false,
  squashMsgContent: "",
  healthPresent: false,
  healthContent: "",
  healthCommitted: false,
}

/** Build the prompt context from the payload passthrough + the folded counters. */
const buildContext = (
  p: ResolvePayload,
  counters: Counters,
  grillingCase?: "stop" | "iterate",
): ResolveContext => ({
  testFixCount: counters.testFixCount,
  reviewFixCount: counters.reviewFixCount,
  packages: p.packages,
  ...(p.refDiff !== undefined ? { refDiff: p.refDiff } : {}),
  ...(p.reviewBase !== undefined ? { reviewBase: p.reviewBase } : {}),
  ...(p.squashBase !== undefined ? { squashBase: p.squashBase } : {}),
  ...(p.squashDiff !== undefined ? { squashDiff: p.squashDiff } : {}),
  feedbackContent: p.feedbackContent !== "" ? p.feedbackContent : p.healthContent,
  ...(grillingCase !== undefined ? { grillingCase } : {}),
})

/**
 * Throw on the STATES.md § Illegal-combinations set. These never arise in normal
 * flow; if seen, gtd hard-errors rather than guessing. Enforced before the ladder.
 */
// fallow-ignore-next-line complexity
const assertLegal = (p: ResolvePayload): void => {
  const fail = (msg: string): never => {
    throw new GtdStateError("illegal-combination", msg)
  }
  if (p.reviewPresent && p.gtdDirExists) fail("illegal combination: REVIEW.md + .gtd")
  // An uncommitted TODO.md under a *committed* REVIEW.md is legal — plan-level
  // notes written during a review are global feedback; the reviewDirty path
  // captures them (Accept Review). Everything else stays illegal.
  if (p.reviewPresent && p.todoCommitted) fail("illegal combination: REVIEW.md + committed TODO.md")
  if (p.reviewPresent && !(p.reviewCommitted || p.reviewDirty) && p.todoExists)
    fail("illegal combination: uncommitted REVIEW.md + TODO.md")
  if (p.feedbackPresent && p.reviewPresent) fail("illegal combination: FEEDBACK.md + REVIEW.md")
  if (p.feedbackPresent && !p.gtdDirExists) fail("illegal combination: FEEDBACK.md without .gtd")
  if (p.errorsPresent && p.feedbackPresent) fail("illegal combination: ERRORS.md + FEEDBACK.md")
  // ERRORS.md without .gtd is legal after a health-check cap escalation (HEAD is
  // `gtd: health-check` and the health cycle wrote ERRORS.md as the cap marker).
  const isHealthCapEscalation =
    p.lastCommitSubject === "gtd: health-check" || p.lastCommitSubject === "gtd: health-fix"
  if (p.errorsPresent && !p.gtdDirExists && !isHealthCapEscalation)
    fail("illegal combination: ERRORS.md without .gtd")
  if (p.healthPresent && p.gtdDirExists) fail("illegal combination: HEALTH.md + .gtd")
  if (p.healthPresent && p.reviewPresent) fail("illegal combination: HEALTH.md + REVIEW.md")
  if (p.healthPresent && p.feedbackPresent) fail("illegal combination: HEALTH.md + FEEDBACK.md")
  if (p.healthPresent && p.errorsPresent) fail("illegal combination: HEALTH.md + ERRORS.md")
}

// ── Rule 1b: HEALTH.md → Health Fixing ───────────────────────────────────────
// Sits BELOW ERRORS (rule 1) so escalation wins. HEALTH.md coexisting with
// ERRORS.md is illegal and caught by assertLegal before the ladder.
//
// edgeAction fires only when there are pending changes to commit:
//   - `!healthCommitted`: HEALTH.md is new (uncommitted) → commit it as the
//     health-check marker. HEALTH.md is removed so the next detect route
//     goes to `resolveCleanOrIdle` (health-check → re-test) rather than
//     looping back to health-fixing. The health-fixing prompt receives the
//     failure content from `context.feedbackContent` (captured before perform).
//   - `healthCommitted && !workingTreeClean`: fix agent's boundary commit
//     left HEALTH.md on disk; fold its removal into a `gtd: health-fix` commit.
// When the tree is clean and HEALTH.md is already committed, the fix agent
// hasn't run yet — emit the prompt without a pre-commit.
const resolveHealth = (p: ResolvePayload, counters: Counters): Result => {
  const hasPendingWork = !p.healthCommitted || !p.workingTreeClean
  const prefix = p.healthCommitted ? "gtd: health-fix" : "gtd: health-check"
  return {
    state: "health-fixing",
    autoAdvance: true,
    ...(hasPendingWork
      ? {
          edgeAction: {
            kind: "commitPending",
            prefix,
            // Always remove HEALTH.md: on gtd: health-check this clears it so
            // the next run re-enters resolveCleanOrIdle; on gtd: health-fix it
            // clears the marker left by a prior health-check run.
            removeHealth: true,
          } as const,
        }
      : {}),
    context: buildContext(p, counters),
  }
}

// ── Rule 2: FEEDBACK.md → Fixing or Close package ────────────────────────────
const resolveFeedback = (p: ResolvePayload, counters: Counters): Result => {
  if (p.feedbackEmpty) {
    return {
      state: "close-package",
      autoAdvance: true,
      edgeAction: { kind: "closePackage" },
      context: buildContext(p, counters),
    }
  }
  return {
    state: "fixing",
    autoAdvance: true,
    edgeAction: {
      kind: "commitPending",
      prefix: p.feedbackCommitted ? "gtd: fixing" : "gtd: feedback",
      // Delete FEEDBACK.md so its removal lands in this commit; without it the
      // next run re-detects FEEDBACK (precedence 2) and Fixing never returns to
      // Testing (STATES.md § Fixing: "FEEDBACK.md is removed either way").
      removeFeedback: true,
    },
    context: buildContext(p, counters),
  }
}

// ── Rule 3: .gtd present → build lifecycle (exhaustive: returns or throws) ───
// fallow-ignore-next-line complexity
const resolveGtdLifecycle = (
  p: ResolvePayload,
  counters: Counters,
  head: string,
  corrupt: () => never,
): Result => {
  if (p.gtdModified) {
    return {
      state: "planning",
      autoAdvance: true,
      edgeAction: { kind: "commitPending", prefix: "gtd: planning" },
      context: buildContext(p, counters),
    }
  }
  const noOpFixer = p.workingTreeClean && head === "gtd: fixing"
  if (p.codeDirty || p.pendingErrorsDeletion || noOpFixer) {
    // Human resume (pending ERRORS.md deletion) grants a fresh budget: the
    // testing edge action commits the deletion (`gtd: building`, removedErrors)
    // before re-counting, so the runTest action carries the post-reset budget.
    const resume = p.pendingErrorsDeletion
    return {
      state: "testing",
      autoAdvance: true,
      edgeAction: {
        kind: "runTest",
        errorCount: resume ? 0 : counters.testFixCount,
        capReached: (resume ? 0 : counters.testFixCount) >= p.fixAttemptCap,
      },
      context: buildContext(p, counters),
    }
  }
  if (p.workingTreeClean) {
    if (head === "gtd: planning" || head === "gtd: package done") {
      // Once-only TODO.md deletion: when transitioning planning→building for the
      // first time (TODO.md still present), delete it in the same commit so the
      // planning commit is self-contained. On re-entry (package done, or planning
      // without TODO.md) no action is needed.
      if (head === "gtd: planning" && p.todoExists) {
        return {
          state: "building",
          autoAdvance: true,
          edgeAction: { kind: "commitPending", prefix: "gtd: planning", removeTodo: true },
          context: buildContext(p, counters),
        }
      }
      return { state: "building", autoAdvance: true, context: buildContext(p, counters) }
    }
    if (head === "gtd: building") {
      // Agentic Review, unless force-approved (kill-switch off or threshold hit):
      // skip the review and close the package directly (closePackage tolerates the
      // absent FEEDBACK.md). Otherwise prompt the review agent.
      const forceApprove = !p.agenticReviewEnabled || counters.reviewFixCount >= p.reviewThreshold
      if (forceApprove) {
        return {
          state: "close-package",
          autoAdvance: true,
          edgeAction: { kind: "closePackage" },
          context: buildContext(p, counters),
        }
      }
      return { state: "agentic-review", autoAdvance: true, context: buildContext(p, counters) }
    }
  }
  return corrupt()
}

// ── Rule 4: REVIEW.md present → review lifecycle (exhaustive) ────────────────
const resolveReviewLifecycle = (p: ResolvePayload, counters: Counters, head: string): Result => {
  // Regen carve-out: HEAD is the accept-review capture commit and REVIEW.md
  // is present again (its annotated copy is IN that commit) — a checkout/pull
  // or crash lost the uncommitted seed. Without this, `reviewCommitted` +
  // clean tree would route to Done and silently approve the annotations.
  // Re-run the seed instead; the perform discards any partial revert/seed
  // state and re-derives everything from the capture commit.
  if (head === "gtd: review feedback") {
    return {
      state: "accept-review",
      autoAdvance: true,
      edgeAction: { kind: "seedAcceptReview" },
      context: buildContext(p, counters),
    }
  }
  if (p.reviewCommitted || (p.reviewDirty && p.reviewCheckboxOnly)) {
    return {
      state: "done",
      autoAdvance: true,
      edgeAction: { kind: "done" },
      context: buildContext(p, counters),
    }
  }
  if (p.reviewDirty) {
    return {
      state: "accept-review",
      autoAdvance: true,
      edgeAction: { kind: "seedAcceptReview" },
      context: buildContext(p, counters),
    }
  }
  // Uncommitted REVIEW.md (freshly written by Clean).
  return {
    state: "await-review",
    autoAdvance: true,
    edgeAction: { kind: "commitReview" },
    context: buildContext(p, counters),
  }
}

// ── Rule 6: Grilling / Grilled ────────────────────────────────────────────────
const resolveGrilling = (p: ResolvePayload, counters: Counters, head: string): Result => {
  // Later grilling rounds (committed plan) with pending code changes capture
  // the code into TODO.md as a suggestion block and revert it; the seed round
  // (uncommitted TODO.md) must instead commit the pending seed revert
  // verbatim. Applies to BOTH the STOP and iterate paths so code cannot leak
  // through the answer-questions round.
  const grillCommit: EdgeAction =
    p.todoCommitted && p.codeDirty
      ? { kind: "captureGrillingEdits" }
      : { kind: "commitPending", prefix: "gtd: grilling" }
  if (p.todoMarkerPresent) {
    // Open question marker → STOP for the human to answer inline.
    // If tree is already clean and HEAD is already `gtd: grilling`, this is a
    // re-run at the STOP gate — skip the commit so it's a no-op.
    const alreadyAtGrillingStop = p.workingTreeClean && head === "gtd: grilling"
    return {
      state: "grilling",
      autoAdvance: false,
      ...(alreadyAtGrillingStop ? {} : { edgeAction: grillCommit }),
      context: buildContext(p, counters, "stop"),
    }
  }
  if (!p.workingTreeClean) {
    return {
      state: "grilling",
      autoAdvance: true,
      edgeAction: grillCommit,
      context: buildContext(p, counters, "iterate"),
    }
  }
  return {
    state: "grilled",
    autoAdvance: true,
    edgeAction: { kind: "commitPending", prefix: "gtd: grilled" },
    context: buildContext(p, counters),
  }
}

// ── Rule 7: Clean / Idle / Health-check ──────────────────────────────────────
// This path is only reached when no gtd process is active (no steering files).
// Outside a process, no review base is selected for any branch — the
// whole-branch review path does not fire here. A clean/idle tree either reviews
// committed work (Clean) when a process-scoped review base and non-empty diff
// are present, or runs the health check, or settles Idle.
// fallow-ignore-next-line complexity
const resolveCleanOrIdle = (p: ResolvePayload, counters: Counters, head: string): Result | null => {
  const isHealthHead = head === "gtd: health-check" || head === "gtd: health-fix"
  // Allow `pendingErrorsDeletion` without .gtd to fall through: the
  // `runHealthCheck` edge action carries `commitErrorsReset: true` so perform
  // commits the deletion first (resetting healthFixCount via removedErrors),
  // then runs the test. This is handled below in the normal health-check path.

  // Post-fix health cycle: the fixer left its edits uncommitted under a
  // `gtd: health-check` / `gtd: health-fix` HEAD (HEALTH.md already removed by
  // the prior gtd: health-check commit). Commit those edits as gtd: health-fix
  // and re-enter the loop; the next resolve sees a clean health HEAD and re-runs
  // the health check. Guard on !pendingErrorsDeletion so the budget-reset path
  // (handled below via commitErrorsReset) is not shadowed.
  if (!p.workingTreeClean && !p.pendingErrorsDeletion && isHealthHead) {
    return {
      state: "health-check",
      autoAdvance: true,
      edgeAction: { kind: "commitPending", prefix: "gtd: health-fix" },
      context: buildContext(p, counters),
    }
  }

  if (!p.workingTreeClean && !p.pendingErrorsDeletion) return null
  if (!p.workingTreeClean && p.pendingErrorsDeletion && p.gtdDirExists) return null // gtd lifecycle handles it
  if (
    !p.workingTreeClean &&
    p.pendingErrorsDeletion &&
    !isBoundary(head) &&
    head !== "gtd: package done" &&
    !isHealthHead
  )
    return null
  if (p.workingTreeClean && !isBoundary(head) && head !== "gtd: package done" && !isHealthHead)
    return null
  if (head === "gtd: done" && p.squashEnabled && p.squashBase !== undefined) {
    if (p.squashMsgPresent) {
      return {
        state: "squashing",
        autoAdvance: false,
        edgeAction: {
          kind: "squashCommit",
          squashBase: p.squashBase,
          commitMessage: p.squashMsgContent,
        },
        context: buildContext(p, counters),
      }
    }
    return { state: "squashing", autoAdvance: true, context: buildContext(p, counters) }
  }
  const reviewable =
    p.hasCommitsAfterLastDone && p.reviewBase !== undefined && (p.refDiff ?? "").trim().length > 0
  if (reviewable) {
    return { state: "clean", autoAdvance: false, context: buildContext(p, counters) }
  }
  const squashHealth =
    p.squashEnabled && counters.healthFixCount > 0 && p.healthFixBase !== undefined
  return {
    state: "health-check",
    autoAdvance: true,
    edgeAction: {
      kind: "runHealthCheck",
      errorCount: counters.healthFixCount,
      capReached: counters.healthFixCount >= p.fixAttemptCap,
      ...(squashHealth ? { healthFixBase: p.healthFixBase } : {}),
      ...(p.pendingErrorsDeletion ? { commitErrorsReset: true } : {}),
    },
    context: buildContext(p, counters),
  }
}

/**
 * Resolve the event stream to a single decision. Folds `COMMIT[]` into the two
 * counters, then runs the STATES.md § Precedence ladder (first match wins) on the
 * terminal `RESOLVE` payload.
 *
 * Throws `GtdStateError` for an illegal steering-file combination (before the
 * ladder) or for corruption (no rule matched). Every other input — including
 * `resolve([])` — returns a `Result` without throwing.
 */
// fallow-ignore-next-line complexity
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

  // ── 0. Transport ──────────────────────────────────────────────────────────
  if (head === "gtd: transport") {
    return {
      state: "transport",
      autoAdvance: true,
      edgeAction: { kind: "transportReset" },
      context: buildContext(p, counters),
    }
  }
  // ── 1. ERRORS.md → Escalate ───────────────────────────────────────────────
  if (p.errorsPresent)
    return { state: "escalate", autoAdvance: false, context: buildContext(p, counters) }
  // ── 1b. HEALTH.md → Health Fixing ────────────────────────────────────────
  if (p.healthPresent) return resolveHealth(p, counters)
  // ── 2. FEEDBACK.md → Fixing / Close package ───────────────────────────────
  if (p.feedbackPresent) return resolveFeedback(p, counters)
  // ── 3. .gtd → build lifecycle ─────────────────────────────────────────────
  if (p.gtdDirExists) return resolveGtdLifecycle(p, counters, head, corrupt)
  // ── 4. REVIEW.md → review lifecycle ──────────────────────────────────────
  if (p.reviewPresent) return resolveReviewLifecycle(p, counters, head)
  // ── 4b. Squash-perform (dirty tree, squash message only) ──────────────────
  // SQUASH_MSG.md is a steering file, so its presence makes workingTreeClean
  // false while leaving codeDirty false. Without this block, rule 5 (New
  // Feature) would fire next — it sees a boundary HEAD with a dirty tree and
  // seeds a new task from the squash message content. Hoisting the squash-
  // perform here short-circuits that: when SQUASH_MSG.md is the *only* dirt
  // we can safely commit the squash immediately.
  //
  // Guard on !codeDirty intentionally: if the tree also has unrelated code
  // edits, fall through to rule 5 so the user addresses those first rather
  // than having `git add -A` silently fold them into the squash commit.
  if (
    head === "gtd: done" &&
    p.squashEnabled &&
    p.squashBase !== undefined &&
    p.squashMsgPresent &&
    !p.codeDirty
  ) {
    return {
      state: "squashing",
      autoAdvance: false,
      edgeAction: {
        kind: "squashCommit",
        squashBase: p.squashBase,
        commitMessage: p.squashMsgContent,
      },
      context: buildContext(p, counters),
    }
  }
  // ── 4c. Health-squash-perform (dirty tree, SQUASH_MSG.md only, health cycle) ──
  // Parallel to rule 4b but for the health-check cycle: after the agent authors
  // the real squash message over the HEALTH_SQUASH_SENTINEL in SQUASH_MSG.md,
  // this rule fires and executes the squash. Guard on !codeDirty so unrelated
  // edits do not get silently folded in. Guard on squashMsgContent ≠ sentinel so
  // the sentinel write (the green-health signal before the agent has authored the
  // real message) does not trigger a squash commit with placeholder content.
  if (
    p.squashEnabled &&
    p.healthFixBase !== undefined &&
    p.squashMsgPresent &&
    p.squashMsgContent !== HEALTH_SQUASH_SENTINEL &&
    !p.codeDirty
  ) {
    return {
      state: "squashing",
      autoAdvance: false,
      edgeAction: {
        kind: "squashCommit",
        squashBase: p.healthFixBase,
        commitMessage: p.squashMsgContent,
      },
      context: buildContext(p, counters),
    }
  }
  // ── 4d. Health-squash-prompt (sentinel present — green confirmed, no real message yet) ──
  // After runHealthCheck runs green with prior fix commits, it writes SQUASH_MSG.md
  // with HEALTH_SQUASH_SENTINEL (the loop-breaking observable state change). The
  // next gather sees the sentinel and routes here to prompt the agent to author the
  // real conventional-commits squash message (overwriting the sentinel). Once the
  // agent overwrites it with real content, rule 4c fires and squashes.
  //
  // Hoisted to the main ladder (before resolveCleanOrIdle) so it fires regardless
  // of workingTreeClean — the untracked SQUASH_MSG.md makes the tree dirty, but
  // SQUASH_MSG.md is a steering file and does not constitute "code dirty".
  // Rule 4c is guarded against sentinel content so it does not squash immediately.
  if (
    p.squashEnabled &&
    p.healthFixBase !== undefined &&
    p.squashMsgPresent &&
    p.squashMsgContent === HEALTH_SQUASH_SENTINEL
  ) {
    return {
      state: "squashing",
      autoAdvance: true,
      edgeAction: { kind: "removeHealthSentinel" },
      context: buildContext(p, counters),
    }
  }
  // ── 4e. Stray SQUASH_MSG.md under boundary HEAD (no matching squash cycle) ──
  // A SQUASH_MSG.md can be left behind from an aborted or mismatched squash
  // cycle (e.g. squashBase is absent because HEAD is not `gtd: done`, or
  // squashEnabled is false). In that case rules 4b/4c/4d do not fire.
  // Guard on !codeDirty: if there are also real code changes, fall through to
  // rule 5 so the user's work is captured as a new feature (SQUASH_MSG.md is
  // excluded from codeDirty since it is a steering file, so codeDirty true
  // means real edits are present). With only the stray steering file, remove it
  // and let the next gather settle to health-check or idle.
  if (isBoundary(head) && p.squashMsgPresent && !p.codeDirty) {
    return {
      state: "squashing",
      autoAdvance: true,
      edgeAction: { kind: "removeStraySquashMsg" },
      context: buildContext(p, counters),
    }
  }
  // ── 5. New Feature ────────────────────────────────────────────────────────
  // Boundary HEAD + pending changes (code and/or a new uncommitted TODO.md — the
  // only steering file possible here), or HEAD `gtd: new task` + clean tree
  // (a checkout/pull that lost the uncommitted seed — regenerate it).
  // A *committed* TODO.md is a resumed grill: route to rule 6 even when the
  // tree is dirty (grilling captures the code edits) — re-seeding here would
  // clobber the developed plan with a raw seed.
  // Note: squashMsgPresent + codeDirty falls here intentionally — real code
  // edits must be captured as a new feature; seedNewFeature excludes steering
  // files (SQUASH_MSG.md) from the seed content.
  if (
    (isBoundary(head) && !p.workingTreeClean && !p.todoCommitted) ||
    (head === "gtd: new task" && p.workingTreeClean)
  ) {
    return {
      state: "new-feature",
      autoAdvance: true,
      edgeAction: { kind: "seedNewFeature" },
      context: buildContext(p, counters),
    }
  }
  // ── 6. Grilling / Grilled ─────────────────────────────────────────────────
  if (p.todoExists) return resolveGrilling(p, counters, head)
  // ── 7. Clean / Idle ───────────────────────────────────────────────────────
  // Reached only with no steering files. Outside a gtd process no branch
  // review base is chosen — the whole-branch review path is absent here. A
  // clean tree under a boundary or `gtd: package done` HEAD triggers Clean
  // only when a process-scoped review base exists and the filtered diff is
  // non-empty; otherwise the tree runs the health check or settles Idle.
  return resolveCleanOrIdle(p, counters, head) ?? corrupt()
}

/**
 * Build a `Result` in the `clean` state with a pinned `reviewBase`/`refDiff`.
 * Intended for the `review` command, which synthesises a Clean result directly
 * (bypassing `resolve`) after placing the `gtd: reviewing` anchor commit.
 * All other context fields default to `DEFAULT_PAYLOAD` values, matching the
 * context shape the auto-Clean path (`resolveCleanOrIdle`) produces.
 */
export const cleanResult = (args: {
  reviewBase: string
  refDiff: string
  autoAdvance: boolean
}): Result => ({
  state: "clean",
  autoAdvance: args.autoAdvance,
  context: {
    ...buildContext(
      {
        ...DEFAULT_PAYLOAD,
        reviewBase: args.reviewBase,
        refDiff: args.refDiff,
      },
      { testFixCount: 0, reviewFixCount: 0, healthFixCount: 0 },
    ),
  },
})
