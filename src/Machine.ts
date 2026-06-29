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

/** The 16 resolved states (STATES.md § States). `Result.state` is one of these. */
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
  | "idle"

/**
 * One first-parent commit, reduced to the flags the folds consume. The edge
 * derives every flag from the commit subject (and, for `removedErrors`, the
 * commit's name-status diff):
 *   - `isErrors`        — subject is `gtd: errors`
 *   - `isFeedback`      — subject is `gtd: feedback`
 *   - `isPackageStart`  — subject is `gtd: planning` OR `gtd: package done`
 *   - `isWorkflowCommit`— subject starts `gtd: ` (any phase commit)
 *   - `removedErrors`   — that commit's diff deleted `ERRORS.md`
 */
export interface CommitEvent {
  readonly type: "COMMIT"
  readonly isErrors: boolean
  readonly isFeedback: boolean
  readonly isPackageStart: boolean
  readonly isWorkflowCommit: boolean
  readonly removedErrors: boolean
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
  /** The working tree deletes a committed `ERRORS.md` (human resume → fresh budget). */
  readonly pendingErrorsDeletion: boolean
  /** Subject of HEAD (first-parent). */
  readonly lastCommitSubject: string
  /** The whole working tree is clean. */
  readonly workingTreeClean: boolean
  /** `.gtd/` packages, lowest-numbered first; `packages[0]` is the active one. */
  readonly packages: readonly GtdPackageFact[]
  /** `git diff HEAD` including untracked — prompt context. */
  readonly diff: string
  /** The base commit for a Clean review, if one is available. */
  readonly reviewBase?: string
  /** `git diff <reviewBase> HEAD` — non-empty distinguishes Clean from Idle. */
  readonly refDiff?: string
  /** Agentic review enabled (config kill-switch; false → Agentic Review force-approves). */
  readonly agenticReviewEnabled: boolean
  /** Fix-attempt cap (config, default 3). `capReached` = `testFixCount >= fixAttemptCap`. */
  readonly fixAttemptCap: number
  /** Review-fix threshold (config, default 3). `reviewFixCount >= reviewThreshold` → force-approve. */
  readonly reviewThreshold: number
}

/**
 * A side effect the driver performs, then re-gathers + re-resolves until a
 * prompt-bearing or STOP state. The machine only decides which action; the
 * semantics live in the Events/driver tasks.
 *   - `transportReset`   — mixed-reset the `gtd: transport` HEAD, re-derive.
 *   - `seedNewFeature`   — capture raw input `gtd: new task`, revert it, seed TODO.md.
 *   - `seedAcceptReview` — seed TODO.md from the review changeset, checkout, rm REVIEW.md.
 *   - `runTest`          — commit pending `gtd: building`, run tests; on red write
 *                          FEEDBACK (below cap) or ERRORS (`capReached`), commit `gtd: errors`.
 *                          A green re-test of a no-op fixer (clean tree, HEAD
 *                          `gtd: fixing`) commits an empty `gtd: building` to advance HEAD.
 *   - `commitPending`    — commit the pending tree with a fixed `prefix`
 *                          (grilling / grilled / planning / fixing). `removeFeedback`
 *                          deletes FEEDBACK.md first so Fixing lands its removal in the
 *                          `gtd: fixing` / `gtd: feedback` commit (else Fixing re-fires forever).
 *   - `closePackage`     — rm the (maybe-empty / maybe-absent) FEEDBACK.md, rm the
 *                          first package dir (+ empty `.gtd/`), commit `gtd: package done`.
 *   - `commitReview`     — commit REVIEW.md `gtd: awaiting review`.
 *   - `done`             — rm REVIEW.md, commit `gtd: done`.
 */
export type EdgeAction =
  | { readonly kind: "transportReset" }
  | { readonly kind: "seedNewFeature" }
  | { readonly kind: "seedAcceptReview" }
  | { readonly kind: "runTest"; readonly errorCount: number; readonly capReached: boolean }
  | { readonly kind: "commitPending"; readonly prefix: string; readonly removeFeedback?: boolean }
  | { readonly kind: "closePackage" }
  | { readonly kind: "commitReview" }
  | { readonly kind: "done" }

/** The folded prompt context carried on every `Result`. */
export interface ResolveContext {
  /** `gtd: errors` commits since the most recent of {package-start, `gtd: feedback`, ERRORS.md removal}. */
  readonly testFixCount: number
  /** `gtd: feedback` commits since the most recent package-start. */
  readonly reviewFixCount: number
  /** `.gtd/` packages (passthrough); `packages[0]` is active. */
  readonly packages: readonly GtdPackageFact[]
  /** `git diff HEAD` including untracked (passthrough). */
  readonly diff: string
  /** `git diff <reviewBase> HEAD` (passthrough), when present. */
  readonly refDiff?: string
  /** Review base commit (passthrough), when present. */
  readonly reviewBase?: string
  /** HEAD subject (passthrough). */
  readonly lastCommitSubject: string
  /** Whole-tree cleanliness (passthrough). */
  readonly workingTreeClean: boolean
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

/** The two derived counters folded from the `COMMIT[]` stream. */
export interface Counters {
  readonly testFixCount: number
  readonly reviewFixCount: number
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
 */
export const foldCounters = (events: readonly GtdEvent[]): Counters => {
  let testFixCount = 0
  let reviewFixCount = 0
  for (const event of events) {
    if (event.type !== "COMMIT") continue
    if (event.isPackageStart || event.isFeedback || event.removedErrors) testFixCount = 0
    if (event.isErrors) testFixCount += 1
    if (event.isPackageStart) reviewFixCount = 0
    if (event.isFeedback) reviewFixCount += 1
  }
  return { testFixCount, reviewFixCount }
}

/** A boundary commit: a non-`gtd:` subject, or exactly `gtd: done`. Marks a cold start. */
const isBoundary = (subject: string): boolean =>
  !subject.startsWith("gtd: ") || subject === "gtd: done"

const DEFAULT_PAYLOAD: ResolvePayload = {
  todoExists: false,
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
  pendingErrorsDeletion: false,
  lastCommitSubject: "",
  workingTreeClean: true,
  packages: [],
  diff: "",
  agenticReviewEnabled: true,
  fixAttemptCap: 3,
  reviewThreshold: 3,
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
  diff: p.diff,
  ...(p.refDiff !== undefined ? { refDiff: p.refDiff } : {}),
  ...(p.reviewBase !== undefined ? { reviewBase: p.reviewBase } : {}),
  lastCommitSubject: p.lastCommitSubject,
  workingTreeClean: p.workingTreeClean,
  feedbackContent: p.feedbackContent,
  ...(grillingCase !== undefined ? { grillingCase } : {}),
})

/**
 * Throw on the STATES.md § Illegal-combinations set. These never arise in normal
 * flow; if seen, gtd hard-errors rather than guessing. Enforced before the ladder.
 */
const assertLegal = (p: ResolvePayload): void => {
  const fail = (msg: string): never => {
    throw new GtdStateError("illegal-combination", msg)
  }
  if (p.reviewPresent && p.gtdDirExists) fail("illegal combination: REVIEW.md + .gtd")
  if (p.reviewPresent && p.todoExists) fail("illegal combination: REVIEW.md + TODO.md")
  if (p.feedbackPresent && p.reviewPresent) fail("illegal combination: FEEDBACK.md + REVIEW.md")
  if (p.feedbackPresent && !p.gtdDirExists) fail("illegal combination: FEEDBACK.md without .gtd")
  if (p.errorsPresent && p.feedbackPresent) fail("illegal combination: ERRORS.md + FEEDBACK.md")
  if (p.errorsPresent && !p.gtdDirExists) fail("illegal combination: ERRORS.md without .gtd")
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
export const resolve = (events: readonly GtdEvent[]): Result => {
  const counters = foldCounters(events)

  // Use the last RESOLVE payload in the stream; default for a degenerate input.
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

  // ── 1. ERRORS.md present → Escalate (STOP, no action) ─────────────────────
  if (p.errorsPresent) {
    return { state: "escalate", autoAdvance: false, context: buildContext(p, counters) }
  }

  // ── 2. FEEDBACK.md present → Fixing / Close package ───────────────────────
  if (p.feedbackPresent) {
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

  // ── 3. .gtd present → build lifecycle (exhaustive: returns or corrupts) ────
  if (p.gtdDirExists) {
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
          capReached: resume ? false : counters.testFixCount >= p.fixAttemptCap,
        },
        context: buildContext(p, counters),
      }
    }
    if (p.workingTreeClean) {
      if (head === "gtd: planning" || head === "gtd: package done") {
        return { state: "building", autoAdvance: true, context: buildContext(p, counters) }
      }
      if (head === "gtd: building") {
        // Agentic Review, unless force-approved (kill-switch off or threshold hit):
        // skip the review and close the package directly (closePackage tolerates the
        // absent FEEDBACK.md). Otherwise prompt the review agent.
        const forceApprove =
          !p.agenticReviewEnabled || counters.reviewFixCount >= p.reviewThreshold
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

  // ── 4. REVIEW.md present → review lifecycle (exhaustive) ──────────────────
  if (p.reviewPresent) {
    if (p.reviewCommitted) {
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
      autoAdvance: false,
      edgeAction: { kind: "commitReview" },
      context: buildContext(p, counters),
    }
  }

  // ── 5. New Feature ────────────────────────────────────────────────────────
  // Boundary HEAD + pending changes (code and/or a new uncommitted TODO.md — the
  // only steering file possible here), or HEAD `gtd: new task` + clean tree
  // (a checkout/pull that lost the uncommitted seed — regenerate it).
  if ((isBoundary(head) && !p.workingTreeClean) || (head === "gtd: new task" && p.workingTreeClean)) {
    return {
      state: "new-feature",
      autoAdvance: true,
      edgeAction: { kind: "seedNewFeature" },
      context: buildContext(p, counters),
    }
  }

  // ── 6. Grilling / Grilled ─────────────────────────────────────────────────
  if (p.todoExists) {
    if (p.todoMarkerPresent) {
      // Open question marker → STOP for the human to answer inline.
      return {
        state: "grilling",
        autoAdvance: false,
        edgeAction: { kind: "commitPending", prefix: "gtd: grilling" },
        context: buildContext(p, counters, "stop"),
      }
    }
    if (!p.workingTreeClean) {
      // No marker but pending edits → the grilling agent iterates on them.
      return {
        state: "grilling",
        autoAdvance: true,
        edgeAction: { kind: "commitPending", prefix: "gtd: grilling" },
        context: buildContext(p, counters, "iterate"),
      }
    }
    // No marker, clean tree → converged.
    return {
      state: "grilled",
      autoAdvance: true,
      edgeAction: { kind: "commitPending", prefix: "gtd: grilled" },
      context: buildContext(p, counters),
    }
  }

  // ── 7. Clean / Idle ───────────────────────────────────────────────────────
  // Reached only with no steering files. A clean tree under a boundary or
  // `gtd: package done` HEAD reviews the work (Clean) when the review base yields
  // a non-empty diff, else there is nothing to review (Idle).
  if (p.workingTreeClean && (isBoundary(head) || head === "gtd: package done")) {
    const reviewable = p.reviewBase !== undefined && (p.refDiff ?? "").trim().length > 0
    return {
      state: reviewable ? "clean" : "idle",
      autoAdvance: false,
      context: buildContext(p, counters),
    }
  }

  return corrupt()
}
