import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  DEFAULT_PAYLOAD,
  GtdStateError,
  predictTurn,
  resolve,
  type Counters,
  type GtdEvent,
  type GtdState,
  type ResolvePayload,
} from "./Machine.js"
import { labelCounterStamps, stampLabelCounters } from "./Workflow.js"

/**
 * Property sweep over edge-consistent payloads: random payloads are generated
 * from primitive facts and then constrained the way `gatherEvents` derives
 * them (e.g. `reviewCommitted` implies a clean tree, `codeDirty` implies a
 * dirty one), so every generated payload is one the edge could actually
 * produce.
 *
 * Required invariants (frozen contract):
 *  (a) no agent-driven transition without a captured change — an empty agent
 *      turn at a gate never changes the awaited actor/prompt state;
 *  (b) no double-fire advances any gate — resolving twice (simulating the
 *      second invocation after the first's actions) yields no further
 *      edgeAction at any rest;
 *  (c) resolve never throws except `GtdStateError`;
 *  (d) unrecognized `gtd: *` subjects behave identically to non-gtd
 *      boundaries.
 */

const TURN_SUBJECTS = [
  "gtd(human): grilling",
  "gtd(agent): grilling",
  "gtd(human): architecting",
  "gtd(agent): architecting",
  "gtd(agent): grilled",
  "gtd(agent): building",
  "gtd(agent): fixing",
  "gtd(agent): agentic-review",
  "gtd(agent): review",
  "gtd(human): review",
  "gtd(agent): squashing",
  "gtd(agent): health-fixing",
  "gtd(human): escalate",
  "gtd(agent): learning",
  "gtd(human): learning",
  "gtd(agent): learning-apply",
] as const

const ROUTING_SUBJECTS = [
  "gtd: architecting",
  "gtd: grilled",
  "gtd: building",
  "gtd: tests-green",
  "gtd: test-failed",
  "gtd: close-package",
  "gtd: await-review",
  "gtd: grilling",
  "gtd: done",
  "gtd: squashing",
  "gtd: health-check",
  "gtd: testing",
  "gtd: learning",
  "gtd: await-learning-review",
  "gtd: learning-apply",
  "gtd: learning-applied",
] as const

const BOUNDARY_SUBJECTS = [
  "chore: init",
  "feat: shipped",
  "gtd: new task",
  "gtd: grilling",
  "gtd: transport",
  "gtd: review",
] as const

const HEADS = [...TURN_SUBJECTS, ...ROUTING_SUBJECTS, ...BOUNDARY_SUBJECTS] as const

const arbInvoker = fc.constantFrom<ResolvePayload["invoker"]>("human", "agent", "none")

/** Small non-negative counter vectors, as a trailer read could produce. */
const arbCounters: fc.Arbitrary<Counters> = fc.record({
  testFixCount: fc.integer({ min: 0, max: 5 }),
  reviewFixCount: fc.integer({ min: 0, max: 5 }),
  healthFixCount: fc.integer({ min: 0, max: 5 }),
})

/** Raw independent facts, constrained into an edge-consistent payload below. */
const arbPayload: fc.Arbitrary<ResolvePayload> = fc
  .record({
    invoker: arbInvoker,
    counters: arbCounters,
    head: fc.constantFrom(...HEADS),
    clean: fc.boolean(),
    codeDirtyRaw: fc.boolean(),
    gtdModifiedRaw: fc.boolean(),
    pendingErrorsDeletionRaw: fc.boolean(),
    checkboxOnlyRaw: fc.boolean(),
    todoExists: fc.boolean(),
    todoCommittedRaw: fc.boolean(),
    architectureExists: fc.boolean(),
    architectureCommittedRaw: fc.boolean(),
    planExists: fc.boolean(),
    planCommittedRaw: fc.boolean(),
    packagesPresent: fc.boolean(),
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
    healthPresent: fc.boolean(),
    healthCommittedRaw: fc.boolean(),
    squashEnabled: fc.boolean(),
    hasSquashBase: fc.boolean(),
    learningEnabled: fc.boolean(),
  })
  // fallow-ignore-next-line complexity
  .map((raw): ResolvePayload => {
    const workingTreeClean = raw.clean
    const codeDirty = !workingTreeClean && raw.codeDirtyRaw
    const gtdModified = !workingTreeClean && raw.packagesPresent && raw.gtdModifiedRaw
    const pendingErrorsDeletion = !workingTreeClean && raw.pendingErrorsDeletionRaw
    const reviewTracked = raw.reviewPresent && raw.reviewTrackedRaw
    const reviewCommitted = reviewTracked && workingTreeClean
    const reviewDirty = reviewTracked && !workingTreeClean
    const reviewCheckboxOnly = reviewDirty && !codeDirty && raw.checkboxOnlyRaw
    const isTurnHead = (TURN_SUBJECTS as readonly string[]).includes(raw.head)
    return {
      invoker: raw.invoker,
      counters: raw.counters,
      headTurnDiff: isTurnHead ? "diff --git a/x b/x\n+x\n" : "",
      todoExists: raw.todoExists,
      todoCommitted: raw.todoExists && raw.todoCommittedRaw,
      architectureExists: raw.architectureExists,
      architectureCommitted: raw.architectureExists && raw.architectureCommittedRaw,
      planExists: raw.planExists,
      planCommitted: raw.planExists && raw.planCommittedRaw,
      packagesPresent: raw.packagesPresent,
      reviewPresent: raw.reviewPresent,
      feedbackPresent: raw.feedbackPresent,
      errorsPresent: raw.errorsPresent,
      gtdModified,
      codeDirty,
      feedbackCommitted: raw.feedbackPresent && raw.feedbackCommittedRaw,
      feedbackEmpty: raw.feedbackPresent && raw.feedbackEmptyRaw,
      feedbackContent: raw.feedbackPresent && !raw.feedbackEmptyRaw ? "finding" : "",
      reviewCommitted,
      reviewDirty,
      reviewCheckboxOnly,
      reviewDeletedOnly: false,
      pendingErrorsDeletion,
      pendingFeedbackDeletion: false,
      lastCommitSubject: raw.head,
      workingTreeClean,
      packages: [],
      ...(raw.hasReviewBase ? { reviewBase: "abc123", refDiff: "diff --git a/x b/x\n+x\n" } : {}),
      hasCommitsAfterLastDone: raw.hasCommitsAfterLastDone,
      agenticReviewEnabled: raw.agenticReviewEnabled,
      squashEnabled: raw.squashEnabled,
      squashMsgPresent: false,
      squashMsgDirty: false,
      fixAttemptCap: raw.fixAttemptCap,
      reviewThreshold: raw.reviewThreshold,
      healthPresent: raw.healthPresent,
      healthContent: raw.healthPresent ? "health finding" : "",
      healthCommitted: raw.healthPresent && raw.healthCommittedRaw,
      ...(raw.hasSquashBase ? { squashBase: "def456", squashDiff: "diff" } : {}),
      learningEnabled: raw.learningEnabled,
      learningMsgPresent: false,
      learningMsgDirty: false,
      decisionLog: "",
    }
  })

const arbCommit: fc.Arbitrary<GtdEvent> = fc
  .record({
    isWorkflowCommit: fc.boolean(),
  })
  .map((f) => ({ type: "COMMIT" as const, ...f }))

const arbEvents: fc.Arbitrary<GtdEvent[]> = fc
  .tuple(fc.array(arbCommit, { maxLength: 12 }), arbPayload)
  .map(([commits, payload]) => [...commits, { type: "RESOLVE" as const, payload }])

/** The documented illegal steering-file combinations. */
// fallow-ignore-next-line complexity
const isIllegal = (p: ResolvePayload): boolean =>
  (p.reviewPresent && p.packagesPresent) ||
  (p.reviewPresent && p.todoCommitted) ||
  (p.reviewPresent && !(p.reviewCommitted || p.reviewDirty) && p.todoExists) ||
  (p.reviewPresent && p.architectureCommitted) ||
  (p.reviewPresent && !(p.reviewCommitted || p.reviewDirty) && p.architectureExists) ||
  (p.todoExists && p.architectureExists) ||
  (p.feedbackPresent && p.reviewPresent) ||
  (p.feedbackPresent && !p.packagesPresent) ||
  (p.errorsPresent && p.feedbackPresent) ||
  (p.errorsPresent &&
    !p.packagesPresent &&
    p.lastCommitSubject !== "gtd: health-check" &&
    p.lastCommitSubject !== "gtd: testing") ||
  (p.healthPresent && p.packagesPresent) ||
  (p.healthPresent && p.reviewPresent) ||
  (p.healthPresent && p.feedbackPresent) ||
  (p.healthPresent && p.errorsPresent) ||
  (p.healthPresent && p.todoExists) ||
  (p.healthPresent && p.architectureExists) ||
  (p.healthPresent && p.planExists) ||
  (p.planExists && p.todoExists) ||
  (p.planExists && p.architectureExists) ||
  (p.planExists && p.packagesPresent) ||
  (p.planExists && p.reviewPresent) ||
  (p.planExists && p.feedbackPresent) ||
  (p.planExists && p.errorsPresent) ||
  (p.planExists && p.squashMsgPresent) ||
  (p.planExists && p.learningMsgPresent)

/**
 * (a)'s scope: a landed agent DRAFT turn at HEAD with a clean tree and no
 * higher-precedence steering file shadowing it. Capture rules forbid ever
 * COMMITTING an empty draft, so `headTurnIsEmpty` no longer exists — the
 * draft head unconditionally awaits the HUMAN answer gate, the agent's
 * re-invocation is refused out-of-turn (never a capture), and the human's
 * clean step is the accept-defaults capture.
 */
const DRAFT_HEADS = ["gtd(agent): grilling", "gtd(agent): architecting"] as const

const isInScopeForDraftTurnInvariant = (payload: ResolvePayload): boolean => {
  if (!(DRAFT_HEADS as readonly string[]).includes(payload.lastCommitSubject)) return false
  if (!payload.workingTreeClean) return false
  return !(
    payload.errorsPresent ||
    payload.healthPresent ||
    payload.feedbackPresent ||
    payload.packagesPresent ||
    payload.reviewPresent
  )
}

const ALL_STATES: ReadonlySet<GtdState> = new Set<GtdState>([
  "grilling",
  "architecting",
  "grilled",
  "planning",
  "building",
  "testing",
  "fixing",
  "escalate",
  "agentic-review",
  "close-package",
  "review",
  "await-review",
  "done",
  "learning",
  "await-learning-review",
  "learning-apply",
  "learning-applied",
  "squashing",
  "idle",
  "health-check",
  "health-fixing",
])

describe("resolve — property sweep over edge-consistent payloads", () => {
  it("(c) never throws anything but GtdStateError; illegal throws match the documented combos", () => {
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

  it("returns exactly one known state, with actor human or agent", () => {
    fc.assert(
      fc.property(arbEvents, (events) => {
        let result
        try {
          result = resolve(events)
        } catch {
          return
        }
        expect(ALL_STATES.has(result.state)).toBe(true)
        expect(["human", "agent"]).toContain(result.actor)
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

  it("invoker 'none' never emits captureTurn and never sets a refusal", () => {
    fc.assert(
      fc.property(arbEvents, (events) => {
        const last = events[events.length - 1] as { payload: ResolvePayload }
        if (last.payload.invoker !== "none") return
        let result
        try {
          result = resolve(events)
        } catch {
          return
        }
        expect(result.edgeAction?.kind).not.toBe("captureTurn")
        expect(result.refusal).toBeUndefined()
      }),
      { numRuns: 2000 },
    )
  })

  it("(a) an empty agent turn at a gate never changes the awaited actor/prompt state (inert)", () => {
    fc.assert(
      fc.property(arbPayload, (payload) => {
        if (!isInScopeForDraftTurnInvariant(payload)) return

        const asHuman: ResolvePayload = { ...payload, invoker: "human" }
        const asAgent: ResolvePayload = { ...payload, invoker: "agent" }
        const asNone: ResolvePayload = { ...payload, invoker: "none" }
        let none
        try {
          none = resolve([{ type: "RESOLVE", payload: asNone }])
        } catch {
          return // illegal/corrupt combos are out of scope for this invariant
        }
        const human = resolve([{ type: "RESOLVE", payload: asHuman }])
        const agent = resolve([{ type: "RESOLVE", payload: asAgent }])
        const expectedState =
          payload.lastCommitSubject === "gtd(agent): architecting" ? "architecting" : "grilling"
        expect(none.state).toBe(expectedState)
        expect(human.state).toBe(expectedState)
        expect(agent.state).toBe(expectedState)
        // A landed draft awaits the HUMAN: the agent re-invoking is refused
        // out-of-turn and never captures; the human's clean step is the
        // accept-defaults capture, decided at capture time.
        expect(agent.edgeAction?.kind).not.toBe("captureTurn")
        expect(agent.refusal).toBeDefined()
        expect(human.edgeAction).toEqual({
          kind: "captureTurn",
          actor: "human",
          gate: expectedState === "grilling" ? "grilling-accepted" : "architecting-accepted",
          // Accept-defaults captures have no stamp — the vector is carried.
          counters: payload.counters,
        })
      }),
      { numRuns: 500 },
    )
  })

  it("(b) no double-fire: resolving twice at a rest never captures the same turn twice", () => {
    fc.assert(
      fc.property(arbPayload, (payload) => {
        if (payload.invoker === "none") return
        let first
        try {
          first = resolve([{ type: "RESOLVE", payload }])
        } catch {
          return
        }
        if (first.edgeAction === undefined || first.refusal !== undefined) return
        // Simulate the fixpoint: if the action was a captureTurn, HEAD now
        // carries that exact turn with an empty diff (clean tree, second call
        // finds nothing new to capture at that turn). Mid-chain bookkeeping
        // legitimately continues from there (it is chain progression, not a
        // repeated capture) — so the invariant is scoped to "no second
        // captureTurn for the same gate", not "no edgeAction at all".
        if (first.edgeAction.kind === "captureTurn") {
          const action = first.edgeAction
          const secondPayload: ResolvePayload = {
            ...payload,
            lastCommitSubject: `gtd(${action.actor}): ${action.gate}`,
            workingTreeClean: true,
            codeDirty: false,
          }
          let second
          try {
            second = resolve([{ type: "RESOLVE", payload: secondPayload }])
          } catch {
            return
          }
          if (second.edgeAction?.kind === "captureTurn") {
            expect(second.edgeAction).not.toEqual(action)
          }
        }
      }),
      { numRuns: 1000 },
    )
  })

  it("(d) unrecognized gtd:* subjects behave identically to non-gtd boundaries", () => {
    fc.assert(
      fc.property(
        fc.record({
          invoker: arbInvoker,
          clean: fc.boolean(),
          hasReviewBase: fc.boolean(),
        }),
        ({ invoker, clean, hasReviewBase }) => {
          const base: ResolvePayload = {
            ...DEFAULT_PAYLOAD,
            invoker,
            workingTreeClean: clean,
            codeDirty: !clean,
            ...(hasReviewBase ? { reviewBase: "abc123", refDiff: "diff --git a/x b/x\n+x\n" } : {}),
          }
          // v1 leftovers plus a pre-label v2 routing subject — all outside
          // the label grammar. (v1's `gtd: grilling`/`gtd: building` now
          // collide with live labels and are deliberately absent here.)
          const legacySubjects = [
            "gtd: new task",
            "gtd: tests green",
            "gtd: transport",
            "gtd: review",
          ]
          const nonGtd = resolve([
            { type: "RESOLVE", payload: { ...base, lastCommitSubject: "feat: shipped" } },
          ])
          for (const subject of legacySubjects) {
            const legacy = resolve([
              { type: "RESOLVE", payload: { ...base, lastCommitSubject: subject } },
            ])
            expect(legacy).toEqual(nonGtd)
          }
        },
      ),
      { numRuns: 500 },
    )
  })
})

// ── δ conformance ───────────────────────────────────────────────────────────
// The purity claim, stated as a property: `resolve` (and `predictTurn`) output
// is a function of the NEAREST workflow commit plus the RESOLVE payload (which
// carries the nearest label as `lastCommitSubject`, its trailer vector as
// `counters`, and the pending diff facts). Any event-stream mutation that
// preserves those two — replacing everything older than the nearest workflow
// commit, injecting boundary commits before or after it — yields identical
// output, including thrown corruption errors.

const arbTurnCommit: fc.Arbitrary<GtdEvent> = fc
  .record({
    actor: fc.constantFrom("human" as const, "agent" as const),
    gate: fc.constantFrom(
      "grilling" as const,
      "building" as const,
      "fixing" as const,
      "health-fixing" as const,
      "escalate" as const,
      "learning" as const,
    ),
  })
  .map(({ actor, gate }) => ({
    type: "COMMIT" as const,
    isWorkflowCommit: true,
    turnActor: actor,
    turnGate: gate,
  }))

const routingCommit: GtdEvent = { type: "COMMIT", isWorkflowCommit: true }
const boundaryCommit: GtdEvent = { type: "COMMIT", isWorkflowCommit: false }

const arbAnyCommit: fc.Arbitrary<GtdEvent> = fc.oneof(
  arbTurnCommit,
  fc.constant(routingCommit),
  fc.constant(boundaryCommit),
)

/** Resolve to a comparable outcome: the Result, or the thrown error's message. */
const outcomeOf = <T>(run: () => T): { ok: T } | { err: string } => {
  try {
    return { ok: run() }
  } catch (e) {
    return { err: e instanceof Error ? e.message : String(e) }
  }
}

describe("δ conformance — resolve is a function of (nearest workflow commit, payload)", () => {
  it("replacing older history and injecting boundary commits never changes the output", () => {
    fc.assert(
      fc.property(
        fc.array(arbAnyCommit, { maxLength: 10 }),
        fc.array(arbAnyCommit, { maxLength: 10 }),
        fc.option(fc.oneof(arbTurnCommit, fc.constant(routingCommit)), { nil: undefined }),
        fc.integer({ min: 0, max: 4 }),
        arbPayload,
        (prefixA, prefixB, nearest, trailingBoundaries, payload) => {
          // With no nearest workflow commit at all, the prefixes must not
          // smuggle one in (it would BE the nearest) — keep boundaries only.
          const scrub = (events: GtdEvent[]): GtdEvent[] =>
            nearest !== undefined
              ? events
              : events.filter((e) => e.type === "COMMIT" && !e.isWorkflowCommit)
          const trailing = Array.from({ length: trailingBoundaries }, () => boundaryCommit)
          const resolveEvent: GtdEvent = { type: "RESOLVE", payload }
          const streamA: GtdEvent[] = [
            ...scrub(prefixA),
            ...(nearest !== undefined ? [nearest] : []),
            ...trailing,
            resolveEvent,
          ]
          const streamB: GtdEvent[] = [
            ...scrub(prefixB),
            ...(nearest !== undefined ? [nearest] : []),
            resolveEvent,
          ]
          expect(outcomeOf(() => resolve(streamA))).toEqual(outcomeOf(() => resolve(streamB)))
          expect(outcomeOf(() => predictTurn(streamA))).toEqual(
            outcomeOf(() => predictTurn(streamB)),
          )
        },
      ),
      { numRuns: 1000 },
    )
  })
})

describe("stampLabelCounters — property invariants", () => {
  it("stamped vectors stay non-negative; unstamped labels carry the vector unchanged", () => {
    fc.assert(
      fc.property(
        arbCounters,
        fc.constantFrom(
          "building" as const,
          "close-package" as const,
          "test-failed" as const,
          "health-check" as const,
          "tests-green" as const,
          "escalated" as const,
          "done" as const,
          undefined,
        ),
        (prev, phase) => {
          const next = stampLabelCounters(phase, prev)
          expect(next.testFixCount).toBeGreaterThanOrEqual(0)
          expect(next.reviewFixCount).toBeGreaterThanOrEqual(0)
          expect(next.healthFixCount).toBeGreaterThanOrEqual(0)
          if (phase === undefined || labelCounterStamps[phase] === undefined) {
            expect(next).toEqual(prev)
          }
        },
      ),
      { numRuns: 1000 },
    )
  })
})
