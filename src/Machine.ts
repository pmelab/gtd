/**
 * Pure, event-sourced resolver for the gtd v2 turn-taking state machine.
 *
 * This module is the **canonical public contract** for the runtime: edge code
 * (`Events.ts`) parses the working tree + first-parent commit history into the
 * events below, then `resolve(events)` folds them into a single resolved
 * decision, the counters the prompts need, and an optional `EdgeAction` the
 * driver must perform before re-gathering and re-resolving.
 *
 * v2 replaces v1's single mutating `gtd` command with a turn-taking model:
 * `gtd step` (human mutator), `gtd step-agent` (agent mutator), and `gtd next`
 * (pure prompt emitter, `invoker: "none"`) all compile against `resolve`. The
 * commit-subject grammar (`./Subjects.ts`) is the sole channel the machine
 * reads: who authored the last turn, whether it is the rest of a chain or
 * mid-chain bookkeeping, and which workflow phase it belongs to. File
 * **content** never steers, with exactly two machine-verified exceptions:
 * FEEDBACK.md emptiness and REVIEW.md checkbox-only diffs.
 *
 * It is intentionally free of IO: no git, no filesystem, no Effect. State is
 * folded from **first-parent** history only (single writer, linear branch). A
 * merge commit at HEAD is unsupported — documented, not handled.
 */

import type { Actor, TurnGate } from "./Subjects.js"
import { parseSubject } from "./Subjects.js"

/** The 16 resolved states (frozen contract). `Result.state` is one of these. */
export type GtdState =
  | "grilling"
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
  | "squashing"
  | "idle"
  | "health-check"
  | "health-fixing"

/**
 * One first-parent commit, reduced to the flags the folds + ladder consume.
 * The edge derives every flag from the commit subject (via `parseSubject`)
 * and, for `removedErrors`, the commit's name-status diff.
 */
export interface CommitEvent {
  readonly type: "COMMIT"
  /** Set when the subject is a turn commit (`gtd(<actor>): <gate>`). */
  readonly turnActor?: Actor
  /** The `<gate>` of a turn commit. */
  readonly turnGate?: string
  /** Routing `gtd: errors`. */
  readonly isErrors: boolean
  /** Agentic-review turn whose diff touched FEEDBACK.md (a findings round). */
  readonly isFeedback: boolean
  /** Routing `gtd: planning` | `gtd: package done`. */
  readonly isPackageStart: boolean
  /** Recognized v2 turn or routing subject (kind !== "boundary"). */
  readonly isWorkflowCommit: boolean
  /** That commit's diff deleted `ERRORS.md`. */
  readonly removedErrors: boolean
  /** Routing `gtd: health-check`. */
  readonly isHealthCheck: boolean
}

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
  /** Diff of HEAD when HEAD is a turn commit (workflow files excluded), else "". */
  readonly headTurnDiff: string
  /** HEAD is a turn commit with an empty diff. */
  readonly headTurnIsEmpty: boolean
  /**
   * Set only when HEAD is a `gtd(human): review` turn commit: whether THAT
   * turn commit's own diff is substantive (anything beyond a pure REVIEW.md
   * checkbox flip). Derived from the turn commit's diff, not live working-tree
   * dirtiness — by the time this mid-chain HEAD is classified, the turn commit
   * has already landed and the tree is clean again.
   */
  readonly headTurnReviewSubstantive?: boolean
  /** Base hash from the newest `gtd: reviewing <hash>` in the current cycle. */
  readonly reviewAnchor?: string
  /** `TODO.md` exists (committed or pending). */
  readonly todoExists: boolean
  /** The present `TODO.md` is tracked at HEAD. */
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
  /** The working tree deletes a committed `ERRORS.md` (human resume → fresh budget). */
  readonly pendingErrorsDeletion: boolean
  /** Subject of HEAD (first-parent). */
  readonly lastCommitSubject: string
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
  /** `HEALTH.md` exists (committed or pending). */
  readonly healthPresent: boolean
  /** Full text of the present `HEALTH.md` ("" when absent). */
  readonly healthContent: string
  /** `HEALTH.md` is tracked at HEAD (committed health check) vs pending. */
  readonly healthCommitted: boolean
  /** Parent commit of the first persisting health-fix cycle commit. */
  readonly healthFixBase?: string
}

/**
 * A side effect the driver performs, then re-gathers + re-resolves until a
 * prompt-bearing rest or a pending mid-chain checkpoint.
 *   - `captureTurn`      — author the first commit of a turn chain:
 *                          `git add -A` + `git commit --allow-empty` with
 *                          subject `gtd(<actor>): <gate>`.
 *   - `commitRouting`    — machine bookkeeping commit with a fixed `subject`
 *                          (one of the routing subjects). `removeTodo` /
 *                          `removeReview` / `removeFeedback` / `removeHealth`
 *                          delete the named steering file first so its
 *                          removal lands in this commit.
 *   - `runTest`          — run the configured test command; on red write
 *                          FEEDBACK (below cap) or ERRORS (`capReached`),
 *                          commit `gtd: errors`; on green commit
 *                          `gtd: tests green`.
 *   - `closePackage`     — rm the (maybe-empty / maybe-absent) FEEDBACK.md, rm
 *                          the first package dir (+ empty `.gtd/`), commit
 *                          `gtd: package done`.
 *   - `writeSquashTemplate` — write + commit SQUASH_MSG.md `gtd: squash template`.
 *   - `squashCommit`     — soft-reset to `squashBase`, then `gtd(agent): squashing`
 *                          reads SQUASH_MSG.md at perform time for the message.
 *   - `runHealthCheck`   — run the configured test command; on red write
 *                          HEALTH.md (below cap) or ERRORS.md (`capReached`),
 *                          commit `gtd: health-check`; on green with prior
 *                          fixes and `squashAfterGreen`, commit
 *                          `gtd: tests green` to chain into the squash
 *                          template; otherwise stop idle with zero commits.
 */
export type EdgeAction =
  | { readonly kind: "captureTurn"; readonly actor: Actor; readonly gate: TurnGate }
  | {
      readonly kind: "commitRouting"
      readonly subject: string
      readonly removeTodo?: boolean
      readonly removeReview?: boolean
      readonly removeFeedback?: boolean
      readonly removeHealth?: boolean
    }
  | { readonly kind: "runTest"; readonly errorCount: number; readonly capReached: boolean }
  | { readonly kind: "closePackage" }
  | { readonly kind: "writeSquashTemplate" }
  | { readonly kind: "squashCommit"; readonly squashBase: string }
  | {
      readonly kind: "runHealthCheck"
      readonly errorCount: number
      readonly capReached: boolean
      readonly squashAfterGreen: boolean
    }

/** The folded prompt context carried on every `Result`. */
export interface ResolveContext {
  /** `gtd: errors` commits since the most recent of {package-start, feedback round, ERRORS.md removal}. */
  readonly testFixCount: number
  /** Feedback rounds (`isFeedback`) since the most recent package-start. */
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
  /** `headTurnDiff` passthrough, for prompts that inline the turn diff (e.g. re-grilling from review feedback). */
  readonly turnDiff?: string
}

/** The resolved decision: the state, the awaited actor, an optional edge action, and context. */
export interface Result {
  readonly state: GtdState
  /** The actor awaited at this rest (or, for a mid-chain HEAD, the actor the chain is driven by). */
  readonly actor: Actor
  /** Clean tree, mid-chain HEAD — meaningful for invoker "none" (`gtd next`/`gtd status`). */
  readonly pending: boolean
  /** Set when an out-of-turn `step-agent` is refused. The CLI prints this to stderr and exits non-zero; zero commits happen. */
  readonly refusal?: string
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
 * Counter folds over the event stream (oldest→newest), in the machine — the
 * edge stays thin. Only `COMMIT` events contribute; `RESOLVE` events are
 * ignored here.
 *
 * - `testFixCount` resets to 0 on any of {`isPackageStart`, `isFeedback`,
 *   `removedErrors`} and increments on `isErrors`.
 * - `reviewFixCount` resets to 0 on `isPackageStart` and increments on
 *   `isFeedback`.
 * - `healthFixCount` resets to 0 on `isPackageStart` and `removedErrors`, and
 *   increments on `isHealthCheck`.
 */
/**
 * One counter's reset/increment rule, read off a `CommitEvent`: `resetsOn`
 * zeroes the running count, `incrementsOn` bumps it by one. Reset is checked
 * before increment for every counter (mirrors the doc comment's per-counter
 * rules above), so a commit that both resets and increments (none currently
 * do) would net to 1, not 0.
 */
interface CounterRule {
  readonly resetsOn: (event: CommitEvent) => boolean
  readonly incrementsOn: (event: CommitEvent) => boolean
}

const counterRules: Record<keyof Counters, CounterRule> = {
  testFixCount: {
    resetsOn: (e) => e.isPackageStart || e.isFeedback || e.removedErrors,
    incrementsOn: (e) => e.isErrors,
  },
  reviewFixCount: {
    resetsOn: (e) => e.isPackageStart,
    incrementsOn: (e) => e.isFeedback,
  },
  healthFixCount: {
    resetsOn: (e) => e.isPackageStart || e.removedErrors,
    incrementsOn: (e) => e.isHealthCheck,
  },
}

export const foldCounters = (events: readonly GtdEvent[]): Counters => {
  const counts: Record<keyof Counters, number> = {
    testFixCount: 0,
    reviewFixCount: 0,
    healthFixCount: 0,
  }
  for (const event of events) {
    if (event.type !== "COMMIT") continue
    for (const [name, rule] of Object.entries(counterRules) as [keyof Counters, CounterRule][]) {
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
  headTurnIsEmpty: false,
  todoExists: false,
  todoCommitted: false,
  gtdDirExists: false,
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
  healthPresent: false,
  healthContent: "",
  healthCommitted: false,
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
})

/**
 * One illegal steering-file combination: a predicate over `ResolvePayload`
 * paired with the exact diagnosis `assertLegal` throws when it matches.
 */
interface IllegalCombinationRule {
  readonly isViolated: (p: ResolvePayload) => boolean
  readonly message: string
}

// HEALTH.md-specific combinations are listed before the generic "<file>
// without .gtd" rules below: HEALTH.md + FEEDBACK.md (or + ERRORS.md) with no
// `.gtd/` present would otherwise also match the generic "FEEDBACK.md without
// .gtd" / "ERRORS.md without .gtd" rules, whose message names only one file
// and doesn't mention HEALTH.md at all — the more specific two-file diagnosis
// must win, so it must be checked first.
const healthFileConflictRules: readonly IllegalCombinationRule[] = [
  { isViolated: (p) => p.healthPresent && p.gtdDirExists, message: "HEALTH.md + .gtd" },
  { isViolated: (p) => p.healthPresent && p.reviewPresent, message: "HEALTH.md + REVIEW.md" },
  { isViolated: (p) => p.healthPresent && p.feedbackPresent, message: "HEALTH.md + FEEDBACK.md" },
  { isViolated: (p) => p.healthPresent && p.errorsPresent, message: "HEALTH.md + ERRORS.md" },
]

const isReviewGtdConflict = (p: ResolvePayload): boolean => p.reviewPresent && p.gtdDirExists

const isReviewCommittedTodoConflict = (p: ResolvePayload): boolean =>
  p.reviewPresent && p.todoCommitted

const isUncommittedReviewWithTodoConflict = (p: ResolvePayload): boolean =>
  p.reviewPresent && !(p.reviewCommitted || p.reviewDirty) && p.todoExists

const isFeedbackReviewConflict = (p: ResolvePayload): boolean =>
  p.feedbackPresent && p.reviewPresent

const isFeedbackWithoutGtdDir = (p: ResolvePayload): boolean => p.feedbackPresent && !p.gtdDirExists

const isErrorsFeedbackConflict = (p: ResolvePayload): boolean =>
  p.errorsPresent && p.feedbackPresent

/** ERRORS.md briefly outlives `.gtd/` during the health-check cap escalation. */
const isHealthCapEscalation = (p: ResolvePayload): boolean =>
  p.lastCommitSubject === "gtd: health-check" || p.lastCommitSubject === "gtd: health-fix"

const isErrorsWithoutGtdDir = (p: ResolvePayload): boolean =>
  p.errorsPresent && !p.gtdDirExists && !isHealthCapEscalation(p)

const reviewAndFeedbackRules: readonly IllegalCombinationRule[] = [
  { isViolated: isReviewGtdConflict, message: "REVIEW.md + .gtd" },
  { isViolated: isReviewCommittedTodoConflict, message: "REVIEW.md + committed TODO.md" },
  { isViolated: isUncommittedReviewWithTodoConflict, message: "uncommitted REVIEW.md + TODO.md" },
  { isViolated: isFeedbackReviewConflict, message: "FEEDBACK.md + REVIEW.md" },
  { isViolated: isFeedbackWithoutGtdDir, message: "FEEDBACK.md without .gtd" },
  { isViolated: isErrorsFeedbackConflict, message: "ERRORS.md + FEEDBACK.md" },
  { isViolated: isErrorsWithoutGtdDir, message: "ERRORS.md without .gtd" },
]

/**
 * Throw on the documented illegal-combination set. These never arise in
 * normal flow; if seen, gtd hard-errors rather than guessing. Enforced before
 * the ladder. HEALTH.md's rules are checked as their own pass ahead of the
 * REVIEW.md/FEEDBACK.md/ERRORS.md rules (see comment above
 * `healthFileConflictRules`), then each remaining rule is checked in the
 * documented precedence order.
 */
const assertLegal = (p: ResolvePayload): void => {
  for (const rule of [...healthFileConflictRules, ...reviewAndFeedbackRules]) {
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
// payload facts (file presence, package/diff state) beyond the subject
// itself, are resolved by the ladder in `resolveBaseline` — `classifyHead`
// covers exactly the rows that are a pure function of the subject plus the
// small config-dependent flag set below.

/** One row of the classification table. */
type HeadClass =
  | { readonly kind: "rest"; readonly state: GtdState; readonly actor: Actor }
  | {
      readonly kind: "mid-chain"
      readonly state: GtdState
      readonly actor: Actor
      readonly action: EdgeAction
    }

/** The small set of config/content-dependent facts a subject-only classification still needs. */
interface ClassifyFlags {
  readonly headTurnIsEmpty: boolean
  readonly hasGtdDir: boolean
  readonly agenticReviewForceApproved: boolean
  readonly squashEnabled: boolean
  readonly hasSquashBase: boolean
  readonly squashAfterGreen: boolean
  readonly reviewSubstantive: boolean
  readonly errorsPresent: boolean
}

/**
 * Classify HEAD per the wire-format table (turn commits and routing commits
 * only — boundary subjects and the payload-dependent rows return `null` for
 * the caller's ladder to resolve). Shared internally by both `resolve` and
 * `predictTurn` so they use one classification.
 */
// fallow-ignore-next-line complexity
const classifyHead = (subject: string, flags: ClassifyFlags): HeadClass | null => {
  const parsed = parseSubject(subject)

  if (parsed.kind === "turn") {
    const { actor, gate } = parsed

    if (gate === "grilling") {
      if (actor === "agent") {
        // Non-empty → human answer gate. Empty → inert re-emit of the same prompt.
        return flags.headTurnIsEmpty
          ? { kind: "rest", state: "grilling", actor: "agent" }
          : { kind: "rest", state: "grilling", actor: "human" }
      }
      // actor === "human"
      return flags.headTurnIsEmpty
        ? {
            kind: "mid-chain",
            state: "grilling",
            actor: "agent",
            action: { kind: "commitRouting", subject: "gtd: grilled" },
          }
        : { kind: "rest", state: "grilling", actor: "agent" }
    }

    if (actor === "agent" && gate === "grilled") {
      return {
        kind: "mid-chain",
        state: "grilled",
        actor: "agent",
        action: { kind: "commitRouting", subject: "gtd: planning", removeTodo: true },
      }
    }

    if (actor === "agent" && gate === "building") {
      return {
        kind: "mid-chain",
        state: "building",
        actor: "agent",
        action: { kind: "runTest", errorCount: 0, capReached: false },
      }
    }

    if (actor === "agent" && gate === "fixing") {
      // Non-empty diff → the fixer actually changed something → mid-chain:
      // strip FEEDBACK.md and re-test in this same invocation. Empty diff →
      // the fixer produced no change at all → inert, same as an empty
      // grilling/agentic-review turn: rest so `gtd next` re-emits the same
      // fixing prompt rather than spuriously re-running tests.
      return flags.headTurnIsEmpty
        ? { kind: "rest", state: "fixing", actor: "agent" }
        : {
            kind: "mid-chain",
            state: "fixing",
            actor: "agent",
            action: { kind: "runTest", errorCount: 0, capReached: false },
          }
    }

    if (actor === "agent" && gate === "agentic-review") {
      // The FEEDBACK.md-present cases (both "empty file written" = approve,
      // and "non-empty findings" = rest at fixing) are handled by the
      // steering-file precedence check above classifyHead, which runs before
      // this branch — so reaching here means FEEDBACK.md was never written at
      // all. That is a plain empty agent turn: inert, never an implicit
      // approval (the two are NOT the same signal — see module doc). Rest at
      // agentic-review so `gtd next` re-emits the same review prompt.
      return { kind: "rest", state: "agentic-review", actor: "agent" }
    }

    if (actor === "agent" && gate === "review") {
      return {
        kind: "mid-chain",
        state: "review",
        actor: "agent",
        action: { kind: "commitRouting", subject: "gtd: awaiting review" },
      }
    }

    if (actor === "human" && gate === "review") {
      return flags.reviewSubstantive
        ? {
            kind: "mid-chain",
            state: "review",
            actor: "human",
            action: { kind: "commitRouting", subject: "gtd: review feedback", removeReview: true },
          }
        : {
            kind: "mid-chain",
            state: "review",
            actor: "human",
            action: { kind: "commitRouting", subject: "gtd: done", removeReview: true },
          }
    }

    if (actor === "agent" && gate === "squashing") {
      return flags.hasSquashBase
        ? {
            kind: "mid-chain",
            state: "squashing",
            actor: "agent",
            action: { kind: "squashCommit", squashBase: "" }, // squashBase filled in by the caller
          }
        : { kind: "rest", state: "squashing", actor: "agent" }
    }

    if (actor === "agent" && gate === "health-fixing") {
      return {
        kind: "mid-chain",
        state: "health-fixing",
        actor: "agent",
        action: { kind: "commitRouting", subject: "gtd: health-fix", removeHealth: true },
      }
    }

    if (actor === "human" && gate === "escalate") {
      return {
        kind: "mid-chain",
        state: "escalate",
        actor: "human",
        action: { kind: "runTest", errorCount: 0, capReached: false },
      }
    }

    return null
  }

  if (parsed.kind === "routing") {
    switch (parsed.phase) {
      case "grilled":
        return { kind: "rest", state: "grilled", actor: "agent" }
      case "planning":
        return { kind: "rest", state: "building", actor: "agent" }
      case "tests-green":
        if (flags.hasGtdDir) {
          return flags.agenticReviewForceApproved
            ? {
                kind: "mid-chain",
                state: "close-package",
                actor: "agent",
                action: { kind: "closePackage" },
              }
            : { kind: "rest", state: "agentic-review", actor: "agent" }
        }
        return flags.squashEnabled && flags.squashAfterGreen
          ? {
              kind: "mid-chain",
              state: "testing",
              actor: "agent",
              action: { kind: "writeSquashTemplate" },
            }
          : { kind: "rest", state: "idle", actor: "human" }
      case "errors":
        return flags.errorsPresent
          ? { kind: "rest", state: "escalate", actor: "human" }
          : { kind: "rest", state: "fixing", actor: "agent" }
      case "package-done":
        // Depends on remaining packages / reviewable diff — caller's ladder.
        return null
      case "awaiting-review":
        return { kind: "rest", state: "await-review", actor: "human" }
      case "review-feedback":
        return { kind: "rest", state: "grilling", actor: "agent" }
      case "done":
        return flags.squashEnabled && flags.hasSquashBase
          ? {
              kind: "mid-chain",
              state: "done",
              actor: "agent",
              action: { kind: "writeSquashTemplate" },
            }
          : { kind: "rest", state: "idle", actor: "human" }
      case "squash-template":
        return { kind: "rest", state: "squashing", actor: "agent" }
      case "reviewing":
        return { kind: "rest", state: "review", actor: "agent" }
      case "health-check":
        return flags.errorsPresent
          ? { kind: "rest", state: "escalate", actor: "human" }
          : { kind: "rest", state: "health-fixing", actor: "agent" }
      case "health-fix":
        // A plain REST for classification purposes (`gtd next`/pure queries
        // report idle/human here, since a clean tree "self-heals" — the very
        // next invocation's health check simply re-runs). But an actual
        // mutating invocation (step/step-agent) landing HERE mid-chain (i.e.
        // the SAME invocation that just captured the health-fixer's turn)
        // must re-test in that same chain rather than stopping — handled as a
        // special case in `applyTurnTaking`, not here.
        return { kind: "rest", state: "idle", actor: "human" }
    }
  }

  return null
}

/**
 * States that author a turn under their own same-named gate. Every other
 * `GtdState` (planning, testing, close-package, await-review, done, idle,
 * health-check — none of which are themselves turn gates) falls through to
 * "review", `gateForState`'s documented default.
 */
const STATE_IS_OWN_GATE: ReadonlySet<GtdState> = new Set<GtdState>([
  "grilling",
  "grilled",
  "building",
  "fixing",
  "agentic-review",
  "review",
  "squashing",
  "health-fixing",
  "escalate",
])

/** Map a state to the turn gate an invocation at that state's rest would author. */
const gateForState = (state: GtdState): TurnGate =>
  STATE_IS_OWN_GATE.has(state) ? (state as TurnGate) : "review"

/**
 * The baseline decision: classify HEAD, falling through to the payload-driven
 * ladder for the rows `classifyHead` cannot resolve alone (boundary subjects,
 * `package-done`'s package/diff-dependent split). Ignorant of turn-taking —
 * `resolve` layers that on afterward via `applyTurnTaking`.
 */
// fallow-ignore-next-line complexity
const resolveBaseline = (
  p: ResolvePayload,
  counters: Counters,
  head: string,
  corrupt: () => never,
  lastTurn?: { readonly actor: Actor; readonly gate: string },
): HeadClass => {
  // Steering-file precedence sits above HEAD classification: these fire
  // regardless of what HEAD says, because the file presence is itself more
  // current than the last commit (e.g. a fresh red test run's FEEDBACK.md).
  //
  // Exception: HEAD === `gtd(agent): fixing` is the fixer's own turn commit
  // consuming that very FEEDBACK.md — classifyHead's mid-chain `runTest`
  // handles stripping it and re-testing, so this precedence check must not
  // pre-empt that classification with a rest.
  const headIsFixerTurn = (() => {
    const parsed = parseSubject(head)
    return parsed.kind === "turn" && parsed.actor === "agent" && parsed.gate === "fixing"
  })()
  // Already inside the fix loop (the Testing loop wrote FEEDBACK.md as
  // `gtd: errors`, or the fixer's own turn is HEAD) — an uncommitted
  // FEEDBACK.md edit here is the fixer disputing/emptying an
  // already-on-the-record finding, not a fresh reviewer write. Distinguishes
  // this from the Agentic Review agent's OWN uncommitted FEEDBACK.md write
  // (see below), which must be captured as a turn before anything else.
  const alreadyInFixLoop = headIsFixerTurn || head === "gtd: errors"
  // Computed early (also reused below, past the classifyHead call) because
  // the FEEDBACK.md precedence check right below needs it: once the
  // review-fix threshold is reached (or agenticReview is off), a lingering
  // FEEDBACK.md from a PRIOR (already-counted) findings round must not block
  // the force-approve close — the threshold overrides stale findings content.
  const forceApprove = !p.agenticReviewEnabled || counters.reviewFixCount >= p.reviewThreshold
  // Exception (mirrors headIsFixerTurn above): HEAD === `gtd(agent):
  // health-fixing` is the health-fixer's own turn commit consuming that very
  // HEALTH.md — classifyHead's mid-chain `commitRouting` (removeHealth) handles
  // it, so this precedence check must not pre-empt that classification with a
  // rest.
  const headIsHealthFixerTurn = (() => {
    const parsed = parseSubject(head)
    return parsed.kind === "turn" && parsed.actor === "agent" && parsed.gate === "health-fixing"
  })()
  if (p.errorsPresent) return { kind: "rest", state: "escalate", actor: "human" }
  if (p.healthPresent && !headIsHealthFixerTurn) {
    return { kind: "rest", state: "health-fixing", actor: "agent" }
  }
  if (p.feedbackPresent && !headIsFixerTurn && !(forceApprove && !alreadyInFixLoop)) {
    // FEEDBACK.md written live by the Agentic Review agent (HEAD is still
    // `gtd: tests green`, the rest that shows the agentic-review prompt) is
    // initially uncommitted — that write must be captured as the agent's
    // `gtd(agent): agentic-review` turn FIRST (rest here so a `captureTurn`
    // happens), rather than mid-chaining straight to close/fixing with no
    // record of the reviewer's own turn. Once captured (HEAD is now that
    // turn commit), this precedence check fires again on the next hop and
    // proceeds to close/fixing as normal.
    if (head === "gtd: tests green") {
      return { kind: "rest", state: "agentic-review", actor: "agent" }
    }
    // An empty FEEDBACK.md is "approve, close the package" ONLY as a fresh
    // Agentic Review verdict. Inside the fix loop, an empty FEEDBACK.md is
    // the FIXER disputing/emptying an already-on-the-record finding — that's
    // "the finding is gone," not "the reviewer approved," so it must still
    // rest at fixing (captureTurn, then classifyHead's `agent, fixing`
    // mid-chain re-tests once the emptying is captured as a non-empty diff).
    return p.feedbackEmpty && !alreadyInFixLoop
      ? {
          kind: "mid-chain",
          state: "close-package",
          actor: "agent",
          action: { kind: "closePackage" },
        }
      : { kind: "rest", state: "fixing", actor: "agent" }
  }

  const squashAfterGreen =
    p.squashEnabled && counters.healthFixCount > 0 && p.healthFixBase !== undefined
  // Prefer the turn commit's own diff (set only when HEAD is the
  // `gtd(human): review` turn commit being classified right now) over live
  // working-tree dirtiness, which is already clean by the time this mid-chain
  // HEAD is reached.
  const reviewSubstantive =
    p.headTurnReviewSubstantive !== undefined
      ? p.headTurnReviewSubstantive
      : p.reviewDirty && !p.reviewCheckboxOnly

  const flags: ClassifyFlags = {
    headTurnIsEmpty: p.headTurnIsEmpty,
    hasGtdDir: p.gtdDirExists,
    agenticReviewForceApproved: forceApprove,
    squashEnabled: p.squashEnabled,
    hasSquashBase: p.squashBase !== undefined,
    squashAfterGreen,
    reviewSubstantive,
    // A pending (uncommitted) deletion of ERRORS.md still counts as "ERRORS.md
    // was committed at this HEAD" for classification purposes: `fs.exists`
    // (which `p.errorsPresent` reads) already sees the file as gone once the
    // working tree deletes it, but the `gtd: errors` commit at HEAD was still
    // the cap-reached escalation round — the human resuming by deleting
    // ERRORS.md must land at the escalate turn (mid-chain re-test), not
    // fixing.
    errorsPresent: p.errorsPresent || p.pendingErrorsDeletion,
  }

  const classified = classifyHead(head, flags)
  if (classified !== null) {
    // Fill in the real squashBase (classifyHead doesn't have direct payload access).
    if (classified.kind === "mid-chain" && classified.action.kind === "squashCommit") {
      return {
        ...classified,
        action: { kind: "squashCommit", squashBase: p.squashBase ?? "" },
      }
    }
    // Fill in the real fix-attempt budget (classifyHead builds a `runTest`
    // action with placeholder `errorCount: 0, capReached: false` — it has no
    // direct access to the folded counters/config). Without this, the
    // building/fixing/escalate mid-chain re-test paths never escalate: a red
    // result past the cap would still write a fresh FEEDBACK.md forever
    // instead of ERRORS.md (only the separate `runHealthCheck` idle carve-out
    // computed this correctly).
    if (classified.kind === "mid-chain" && classified.action.kind === "runTest") {
      return {
        ...classified,
        action: {
          kind: "runTest",
          errorCount: counters.testFixCount,
          capReached: counters.testFixCount >= p.fixAttemptCap,
        },
      }
    }
    // Same fill-in as squashCommit/runTest above, for the health-fix mid-chain
    // re-test (classifyHead's "health-fix" routing case has no access to the
    // folded healthFixCount/config either).
    if (classified.kind === "mid-chain" && classified.action.kind === "runHealthCheck") {
      return {
        ...classified,
        action: {
          kind: "runHealthCheck",
          errorCount: counters.healthFixCount,
          capReached: counters.healthFixCount >= p.fixAttemptCap,
          squashAfterGreen: classified.action.squashAfterGreen,
        },
      }
    }
    return classified
  }

  // .gtd modified (package files added/edited) → Planning, regardless of HEAD.
  if (p.gtdDirExists && p.gtdModified) {
    return { kind: "rest", state: "planning", actor: "agent" }
  }

  // `gtd: package done` — depends on remaining packages / reviewable diff.
  if (head === "gtd: package done") {
    if (p.packages.length > 0) {
      return { kind: "rest", state: "building", actor: "agent" }
    }
    const reviewable =
      p.hasCommitsAfterLastDone && p.reviewBase !== undefined && (p.refDiff ?? "").trim().length > 0
    if (reviewable) return { kind: "rest", state: "review", actor: "agent" }
    return resolveIdleOrHealth(p)
  }

  // TODO.md present, boundary/other HEAD (e.g. right after `gtd: review
  // feedback`'s rest, or a fresh dirty-boundary entry already captured) —
  // grilling continues.
  if (p.todoExists) {
    return { kind: "rest", state: "grilling", actor: "agent" }
  }

  // `.gtd/` exists with a pending package, and the nearest workflow commit
  // (skipping any boundary commits on top of it) is still the
  // `gtd(agent): building` checkpoint — an operational recovery commit (e.g. a
  // config fix) landed on top of it after a mid-chain failure, so HEAD itself
  // no longer names the checkpoint even though it's still the active one.
  // Deliberately narrow (not "any `.gtd/` + any boundary HEAD"): an
  // unrecognized boundary HEAD with no such checkpoint in its history must
  // still hard-error (steering-misuse contract).
  if (
    p.gtdDirExists &&
    p.packages.length > 0 &&
    lastTurn?.actor === "agent" &&
    lastTurn.gate === "building"
  ) {
    return { kind: "rest", state: "building", actor: "agent" }
  }

  // No steering files, no recognized workflow HEAD: boundary/idle lifecycle.
  if (
    !p.gtdDirExists &&
    !p.reviewPresent &&
    !p.feedbackPresent &&
    !p.errorsPresent &&
    !p.healthPresent &&
    !p.todoExists
  ) {
    return resolveIdleOrHealth(p)
  }

  return corrupt()
}

/** Boundary/idle lifecycle: no steering files, unrecognized or absent workflow HEAD. */
const resolveIdleOrHealth = (p: ResolvePayload): HeadClass => {
  const reviewable =
    p.hasCommitsAfterLastDone && p.reviewBase !== undefined && (p.refDiff ?? "").trim().length > 0
  if (reviewable) return { kind: "rest", state: "review", actor: "agent" }
  return { kind: "rest", state: "idle", actor: "human" }
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

  // Dirty boundary + invoker human, no steering files, no COMMITTED TODO, HEAD
  // is not itself a turn commit — the v2 entry turn. Checks `todoCommitted`
  // rather than `todoExists`: a TODO.md the human just wrote as part of THIS
  // dirty tree (uncommitted) is exactly what gets captured by this turn (a
  // pre-existing coincidentally-named file must not be mistaken for an
  // already-in-progress grilling process — only a TODO.md already tracked at
  // HEAD indicates that). `gtd: done` counts as a boundary HEAD here too (a
  // settled cycle is exactly where the next feature's dirty tree lands), even
  // though it parses as a `"routing"` subject in the general taxonomy.
  const isDirtyBoundaryEntry =
    invoker === "human" &&
    !p.workingTreeClean &&
    !p.todoCommitted &&
    !p.gtdDirExists &&
    !p.reviewPresent &&
    !p.feedbackPresent &&
    !p.errorsPresent &&
    !p.healthPresent &&
    (parseSubject(head).kind === "boundary" || head === "gtd: done")

  if (isDirtyBoundaryEntry) {
    return {
      state: "grilling",
      actor: "human",
      pending: false,
      edgeAction: { kind: "captureTurn", actor: "human", gate: "grilling" },
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

  // `gtd: health-fix` re-tests in the SAME chain regardless of which actor is
  // driving this invocation (the health-fixer's own `step-agent` call must
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
    (head === "gtd: health-fix" && baseline.state === "idle") ||
    (healthCheckCapReached && baseline.state === "health-fixing")
  ) {
    const squashAfterGreenAtHealthFix =
      p.squashEnabled && counters.healthFixCount > 0 && p.healthFixBase !== undefined
    return {
      state: "idle",
      actor: "agent",
      pending: false,
      edgeAction: {
        kind: "runHealthCheck",
        errorCount: counters.healthFixCount,
        capReached: counters.healthFixCount >= p.fixAttemptCap,
        squashAfterGreen: squashAfterGreenAtHealthFix,
      },
      context,
    }
  }

  // Out-of-turn: agent invokes while a human turn is awaited → refuse.
  if (invoker === "agent" && awaited === "human") {
    return {
      state: baseline.state,
      actor: awaited,
      pending: false,
      refusal: `${baseline.state} awaits a human turn`,
      context,
    }
  }

  // Human invokes while an agent turn is awaited: dirty tree captures
  // feedback-with-authority under the current gate, authored as the
  // INVOKING human's own turn (not the agent's) — `gtd(human): <gate>`,
  // not `gtd(agent): <gate>` — since the human is the one who actually made
  // the edit. Clean tree no-ops.
  if (invoker === "human" && awaited === "agent") {
    if (!p.workingTreeClean) {
      return {
        state: baseline.state,
        actor: awaited,
        pending: false,
        edgeAction: { kind: "captureTurn", actor: invoker, gate: gateForState(baseline.state) },
        context,
      }
    }
    return { state: baseline.state, actor: awaited, pending: false, context }
  }

  // Idle carve-out: a human step at idle always re-runs the health check —
  // never an empty turn commit, and never a plain fixpoint no-op.
  if (baseline.state === "idle" && invoker === "human") {
    const squashAfterGreen =
      p.squashEnabled && counters.healthFixCount > 0 && p.healthFixBase !== undefined
    return {
      state: "idle",
      actor: "human",
      pending: false,
      edgeAction: {
        kind: "runHealthCheck",
        errorCount: counters.healthFixCount,
        capReached: counters.healthFixCount >= p.fixAttemptCap,
        squashAfterGreen,
      },
      context,
    }
  }

  // Invoker matches the awaited actor: capture a fresh turn commit, unless
  // HEAD already carries that exact turn AND the tree is clean (fixpoint —
  // idempotent re-run). A DIRTY tree at the same gate is a genuinely NEW
  // capture (e.g. a fixer whose first attempt landed an empty turn — nothing
  // to fix yet — now has real edits once `gate.sh`/the code is actually
  // fixed in a later invocation): the fixpoint short-circuit must not treat
  // that as "nothing to do" just because HEAD happens to share the gate.
  const gate = gateForState(baseline.state)
  const parsedHead = parseSubject(head)
  const alreadyAtThisTurn =
    parsedHead.kind === "turn" &&
    parsedHead.actor === invoker &&
    parsedHead.gate === gate &&
    p.workingTreeClean

  if (alreadyAtThisTurn) {
    return { state: baseline.state, actor: awaited, pending: false, context }
  }

  return {
    state: baseline.state,
    actor: awaited,
    pending: false,
    edgeAction: { kind: "captureTurn", actor: invoker, gate },
    context,
  }
}

/**
 * Resolve the event stream to a single decision. Folds `COMMIT[]` into the
 * three counters, classifies HEAD (rest vs mid-chain) per the wire-format
 * table, then layers turn-taking semantics on top.
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

/** Prediction of the first commit `step`/`step-agent` would author, for `gtd status`. */
export interface TurnPrediction {
  readonly actor: Actor
  readonly subject: string | null
  readonly state: GtdState
}

/**
 * Fold the same events `resolve` would, and report what `step`/`step-agent`
 * would commit first for the awaited actor (turn subject, or null when
 * nothing would be committed) and the predicted resulting state. Backs
 * `gtd status` — a pure query, so it forces `invoker: "none"` on the last
 * RESOLVE payload before re-deriving the mid-chain/rest classification, then
 * reports the subject the actual mutating action (`captureTurn` or
 * `commitRouting`) would write.
 */
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
    !payload.gtdDirExists &&
    !payload.reviewPresent &&
    !payload.feedbackPresent &&
    !payload.errorsPresent &&
    !payload.healthPresent &&
    (parseSubject(head).kind === "boundary" || head === "gtd: done")
  if (isDirtyBoundaryEntry) {
    return { actor: "human", subject: "gtd(human): grilling", state: "grilling" }
  }

  if (baseline.state === "idle") {
    return { actor: "human", subject: null, state: "idle" }
  }

  const gate = gateForState(baseline.state)
  const parsedHead = parseSubject(head)
  const alreadyAtThisTurn =
    parsedHead.kind === "turn" && parsedHead.actor === baseline.actor && parsedHead.gate === gate
  if (alreadyAtThisTurn) {
    return { actor: baseline.actor, subject: null, state: baseline.state }
  }
  return {
    actor: baseline.actor,
    subject: `gtd(${baseline.actor}): ${gate}`,
    state: baseline.state,
  }
}

/** Awaited actor for a given state — the actor `resolve` reports at that state's rest. */
export const awaitedActor = (state: GtdState): Actor => {
  switch (state) {
    case "idle":
    case "escalate":
    case "await-review":
      return "human"
    default:
      return "agent"
  }
}
