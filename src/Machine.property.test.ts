import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  type EdgeAction,
  type GtdEvent,
  type GtdState,
  type ResolvePayload,
  foldCounters,
  GtdStateError,
  resolve,
} from "./Machine.js"

/**
 * Property sweep over edge-consistent payloads: random payloads are generated
 * from primitive facts and then constrained the way `gatherEvents` derives
 * them (e.g. `reviewCommitted` implies a clean tree, `codeDirty` implies a
 * dirty one), so every generated payload is one the edge could actually
 * produce. The invariants pin the machine's public contract:
 *
 *  - `resolve` never throws anything but `GtdStateError`, and an
 *    illegal-combination throw only fires on the documented combos;
 *  - exactly one of the 17 states comes back, with an edge action from that
 *    state's allowed set;
 *  - the `done` action is only ever emitted with REVIEW.md present, and the
 *    accept-review regen carve-out shadows Done under a
 *    `gtd: review feedback` HEAD;
 *  - resolution is deterministic, and the counter folds ignore RESOLVE events.
 */

const HEADS = [
  "",
  "chore: init",
  "feat: shipped",
  "Merge branch side",
  "gtd: transport",
  "gtd: new task",
  "gtd: grilling",
  "gtd: grilled",
  "gtd: planning",
  "gtd: building",
  "gtd: errors",
  "gtd: fixing",
  "gtd: feedback",
  "gtd: package done",
  "gtd: awaiting review",
  "gtd: review feedback",
  "gtd: done",
] as const

/** Raw independent facts, constrained into an edge-consistent payload below. */
const arbPayload: fc.Arbitrary<ResolvePayload> = fc
  .record({
    head: fc.constantFrom(...HEADS),
    clean: fc.boolean(),
    codeDirtyRaw: fc.boolean(),
    gtdModifiedRaw: fc.boolean(),
    pendingErrorsDeletionRaw: fc.boolean(),
    checkboxOnlyRaw: fc.boolean(),
    todoExists: fc.boolean(),
    todoCommittedRaw: fc.boolean(),
    markerRaw: fc.boolean(),
    gtdDirExists: fc.boolean(),
    reviewPresent: fc.boolean(),
    reviewTrackedRaw: fc.boolean(),
    feedbackPresent: fc.boolean(),
    feedbackCommittedRaw: fc.boolean(),
    feedbackEmptyRaw: fc.boolean(),
    errorsPresent: fc.boolean(),
    hasReviewBase: fc.boolean(),
    hasCommitsAfterLastDone: fc.boolean(),
    agenticReviewEnabled: fc.boolean(),
    fixAttemptCap: fc.integer({ min: 0, max: 4 }),
    reviewThreshold: fc.integer({ min: 1, max: 4 }),
  })
  // fallow-ignore-next-line complexity
  .map((raw): ResolvePayload => {
    const workingTreeClean = raw.clean
    const codeDirty = !workingTreeClean && raw.codeDirtyRaw
    const gtdModified = !workingTreeClean && raw.gtdDirExists && raw.gtdModifiedRaw
    const pendingErrorsDeletion = !workingTreeClean && raw.pendingErrorsDeletionRaw
    const reviewTracked = raw.reviewPresent && raw.reviewTrackedRaw
    const reviewCommitted = reviewTracked && workingTreeClean
    const reviewDirty = reviewTracked && !workingTreeClean
    const reviewCheckboxOnly = reviewDirty && !codeDirty && raw.checkboxOnlyRaw
    return {
      todoExists: raw.todoExists,
      todoCommitted: raw.todoExists && raw.todoCommittedRaw,
      gtdDirExists: raw.gtdDirExists,
      reviewPresent: raw.reviewPresent,
      feedbackPresent: raw.feedbackPresent,
      errorsPresent: raw.errorsPresent,
      gtdModified,
      codeDirty,
      todoMarkerPresent: raw.todoExists && raw.markerRaw,
      feedbackCommitted: raw.feedbackPresent && raw.feedbackCommittedRaw,
      feedbackEmpty: raw.feedbackPresent && raw.feedbackEmptyRaw,
      feedbackContent: raw.feedbackPresent && !raw.feedbackEmptyRaw ? "finding" : "",
      reviewCommitted,
      reviewDirty,
      reviewCheckboxOnly,
      pendingErrorsDeletion,
      lastCommitSubject: raw.head,
      workingTreeClean,
      packages: [],
      diff: workingTreeClean ? "" : "diff --git a/x b/x\n+x\n",
      ...(raw.hasReviewBase ? { reviewBase: "abc123", refDiff: "diff --git a/x b/x\n+x\n" } : {}),
      hasCommitsAfterLastDone: raw.hasCommitsAfterLastDone,
      agenticReviewEnabled: raw.agenticReviewEnabled,
      squashEnabled: false,
      squashMsgPresent: false,
      squashMsgContent: "",
      fixAttemptCap: raw.fixAttemptCap,
      reviewThreshold: raw.reviewThreshold,
    }
  })

const arbCommit: fc.Arbitrary<GtdEvent> = fc
  .record({
    isErrors: fc.boolean(),
    isFeedback: fc.boolean(),
    isPackageStart: fc.boolean(),
    removedErrors: fc.boolean(),
  })
  .map((f) => ({ type: "COMMIT", isWorkflowCommit: true, ...f }))

const arbEvents: fc.Arbitrary<GtdEvent[]> = fc
  .tuple(fc.array(arbCommit, { maxLength: 12 }), arbPayload)
  .map(([commits, payload]) => [...commits, { type: "RESOLVE", payload }])

/** The documented illegal steering-file combinations (STATES.md). */
// fallow-ignore-next-line complexity
const isIllegal = (p: ResolvePayload): boolean =>
  (p.reviewPresent && p.gtdDirExists) ||
  (p.reviewPresent && p.todoCommitted) ||
  (p.reviewPresent && !(p.reviewCommitted || p.reviewDirty) && p.todoExists) ||
  (p.feedbackPresent && p.reviewPresent) ||
  (p.feedbackPresent && !p.gtdDirExists) ||
  (p.errorsPresent && p.feedbackPresent) ||
  (p.errorsPresent && !p.gtdDirExists)

/** Which edge-action kinds each state may carry ("none" = no action). */
const ALLOWED: Record<GtdState, ReadonlyArray<EdgeAction["kind"] | "none">> = {
  transport: ["transportReset"],
  "new-feature": ["seedNewFeature"],
  grilling: ["commitPending", "captureGrillingEdits", "none"],
  grilled: ["none"],
  "grilled-review": ["commitPending"],
  planning: ["commitPending"],
  building: ["commitPending", "none"],
  testing: ["runTest"],
  fixing: ["commitPending"],
  escalate: ["none"],
  "agentic-review": ["none"],
  "close-package": ["closePackage"],
  clean: ["none"],
  "await-review": ["commitReview"],
  "accept-review": ["seedAcceptReview"],
  done: ["done"],
  idle: ["none"],
  squashing: ["none"],
}

// Derived from ALLOWED (whose Record<GtdState, …> typing is exhaustive) so the
// two can never drift.
const STATES: ReadonlySet<GtdState> = new Set(Object.keys(ALLOWED) as GtdState[])

const COMMIT_PREFIXES = new Set([
  "gtd: grilling",
  "gtd: grilled",
  "gtd: planning",
  "gtd: fixing",
  "gtd: feedback",
])

describe("resolve — property sweep over edge-consistent payloads", () => {
  it("never throws anything but GtdStateError; illegal throws match the documented combos", () => {
    fc.assert(
      fc.property(arbEvents, (events) => {
        const payload = (events[events.length - 1] as { payload: ResolvePayload }).payload
        try {
          resolve(events)
          expect(isIllegal(payload)).toBe(false)
        } catch (e) {
          expect(e).toBeInstanceOf(GtdStateError)
          const err = e as GtdStateError
          expect(["illegal-combination", "corruption"]).toContain(err.kind)
          if (err.kind === "illegal-combination") expect(isIllegal(payload)).toBe(true)
        }
      }),
      { numRuns: 2000 },
    )
  })

  it("returns exactly one known state with an edge action from its allowed set", () => {
    fc.assert(
      fc.property(arbEvents, (events) => {
        let result
        try {
          result = resolve(events)
        } catch {
          return // throw-paths covered above
        }
        expect(STATES.has(result.state)).toBe(true)
        const kind = result.edgeAction?.kind ?? "none"
        expect(ALLOWED[result.state]).toContain(kind)
        if (result.edgeAction?.kind === "commitPending") {
          expect(COMMIT_PREFIXES.has(result.edgeAction.prefix)).toBe(true)
        }
      }),
      { numRuns: 2000 },
    )
  })

  it("the done action requires REVIEW.md, and the regen carve-out shadows Done", () => {
    fc.assert(
      fc.property(arbEvents, (events) => {
        const payload = (events[events.length - 1] as { payload: ResolvePayload }).payload
        let result
        try {
          result = resolve(events)
        } catch {
          return
        }
        if (result.edgeAction?.kind === "done") expect(payload.reviewPresent).toBe(true)
        if (result.state === "done") expect(payload.reviewPresent).toBe(true)
        // The feedback path can never approve: under the capture HEAD, REVIEW.md
        // present always regenerates the seed instead of resolving Done.
        if (payload.reviewPresent && payload.lastCommitSubject === "gtd: review feedback") {
          expect(result.state).toBe("accept-review")
        }
      }),
      { numRuns: 2000 },
    )
  })

  it("resolution is deterministic", () => {
    fc.assert(
      fc.property(arbEvents, (events) => {
        const run = () => {
          try {
            return JSON.stringify(resolve(events))
          } catch (e) {
            return `throw:${(e as GtdStateError).kind}:${(e as Error).message}`
          }
        }
        expect(run()).toBe(run())
      }),
      { numRuns: 500 },
    )
  })
})

describe("foldCounters — property invariants", () => {
  it("counters are non-negative and unaffected by RESOLVE events", () => {
    fc.assert(
      fc.property(fc.array(arbCommit, { maxLength: 30 }), arbPayload, (commits, payload) => {
        const bare = foldCounters(commits)
        expect(bare.testFixCount).toBeGreaterThanOrEqual(0)
        expect(bare.reviewFixCount).toBeGreaterThanOrEqual(0)
        const withResolve = foldCounters([...commits, { type: "RESOLVE", payload }])
        expect(withResolve).toEqual(bare)
      }),
      { numRuns: 1000 },
    )
  })
})
