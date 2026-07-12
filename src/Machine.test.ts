import { describe, expect, it } from "vitest"
import {
  awaitedActor,
  DEFAULT_PAYLOAD,
  foldCounters,
  GtdStateError,
  predictTurn,
  resolve,
  type GtdEvent,
  type ResolvePayload,
} from "./Machine.js"

// ── Builders ──────────────────────────────────────────────────────────────

const commit = (
  flags: {
    turnActor?: "human" | "agent"
    turnGate?: string
    isErrors?: boolean
    isFeedback?: boolean
    isPackageStart?: boolean
    isWorkflowCommit?: boolean
    removedErrors?: boolean
    isHealthCheck?: boolean
  } = {},
): GtdEvent => ({
  type: "COMMIT",
  ...(flags.turnActor !== undefined ? { turnActor: flags.turnActor } : {}),
  ...(flags.turnGate !== undefined ? { turnGate: flags.turnGate } : {}),
  isErrors: flags.isErrors ?? false,
  isFeedback: flags.isFeedback ?? false,
  isPackageStart: flags.isPackageStart ?? false,
  isWorkflowCommit: flags.isWorkflowCommit ?? true,
  removedErrors: flags.removedErrors ?? false,
  isHealthCheck: flags.isHealthCheck ?? false,
})

const basePayload = (overrides: Partial<ResolvePayload> = {}): ResolvePayload => ({
  ...DEFAULT_PAYLOAD,
  lastCommitSubject: "chore: init",
  ...overrides,
})

const R = (overrides: Partial<ResolvePayload> = {}): GtdEvent => ({
  type: "RESOLVE",
  payload: basePayload(overrides),
})

// ── Counter folds ─────────────────────────────────────────────────────────

describe("foldCounters — testFixCount", () => {
  it("empty stream → 0", () => {
    expect(foldCounters([]).testFixCount).toBe(0)
    expect(resolve([]).context.testFixCount).toBe(0)
  })

  it("N trailing isErrors → N", () => {
    const events = [
      commit({ isErrors: true }),
      commit({ isErrors: true }),
      commit({ isErrors: true }),
    ]
    expect(foldCounters(events).testFixCount).toBe(3)
  })

  it("walks through non-error workflow commits without resetting", () => {
    const events = [commit({ isErrors: true }), commit(), commit({ isErrors: true })]
    expect(foldCounters(events).testFixCount).toBe(2)
  })

  it("resets on isPackageStart", () => {
    const events = [
      commit({ isErrors: true }),
      commit({ isPackageStart: true }),
      commit({ isErrors: true }),
    ]
    expect(foldCounters(events).testFixCount).toBe(1)
  })

  it("resets on isFeedback", () => {
    const events = [
      commit({ isErrors: true }),
      commit({ isFeedback: true }),
      commit({ isErrors: true }),
    ]
    expect(foldCounters(events).testFixCount).toBe(1)
  })

  it("resets on removedErrors", () => {
    const events = [
      commit({ isErrors: true }),
      commit({ removedErrors: true }),
      commit({ isErrors: true }),
    ]
    expect(foldCounters(events).testFixCount).toBe(1)
  })
})

describe("foldCounters — reviewFixCount", () => {
  it("increments on isFeedback, resets on isPackageStart", () => {
    const events = [
      commit({ isFeedback: true }),
      commit({ isFeedback: true }),
      commit({ isPackageStart: true }),
      commit({ isFeedback: true }),
    ]
    expect(foldCounters(events).reviewFixCount).toBe(1)
  })

  it("is unaffected by isErrors/removedErrors", () => {
    const events = [
      commit({ isFeedback: true }),
      commit({ isErrors: true }),
      commit({ removedErrors: true }),
    ]
    expect(foldCounters(events).reviewFixCount).toBe(1)
  })
})

describe("foldCounters — healthFixCount", () => {
  it("increments on isHealthCheck, resets on isPackageStart and removedErrors", () => {
    const events = [
      commit({ isHealthCheck: true }),
      commit({ isHealthCheck: true }),
      commit({ removedErrors: true }),
      commit({ isHealthCheck: true }),
    ]
    expect(foldCounters(events).healthFixCount).toBe(1)
  })

  it("resets on isPackageStart", () => {
    const events = [commit({ isHealthCheck: true }), commit({ isPackageStart: true })]
    expect(foldCounters(events).healthFixCount).toBe(0)
  })
})

// ── awaitedActor ──────────────────────────────────────────────────────────

describe("awaitedActor", () => {
  it("is human for idle, escalate, await-review", () => {
    expect(awaitedActor("idle")).toBe("human")
    expect(awaitedActor("escalate")).toBe("human")
    expect(awaitedActor("await-review")).toBe("human")
  })

  it("is agent for building, fixing, agentic-review, squashing, health-fixing", () => {
    expect(awaitedActor("building")).toBe("agent")
    expect(awaitedActor("fixing")).toBe("agent")
    expect(awaitedActor("agentic-review")).toBe("agent")
    expect(awaitedActor("squashing")).toBe("agent")
    expect(awaitedActor("health-fixing")).toBe("agent")
  })
})

// ── Illegal combinations ──────────────────────────────────────────────────

describe("assertLegal / GtdStateError", () => {
  it("throws illegal-combination for REVIEW.md + .gtd", () => {
    expect(() => resolve([R({ reviewPresent: true, packagesPresent: true })])).toThrow(
      GtdStateError,
    )
    try {
      resolve([R({ reviewPresent: true, packagesPresent: true })])
      expect.fail("expected throw")
    } catch (e) {
      expect(e).toBeInstanceOf(GtdStateError)
      expect((e as GtdStateError).kind).toBe("illegal-combination")
    }
  })

  it("throws illegal-combination for HEALTH.md + ERRORS.md", () => {
    expect(() => resolve([R({ healthPresent: true, errorsPresent: true })])).toThrow(GtdStateError)
  })

  it("throws illegal-combination for FEEDBACK.md without .gtd", () => {
    expect(() => resolve([R({ feedbackPresent: true, packagesPresent: false })])).toThrow(
      GtdStateError,
    )
  })

  it("throws illegal-combination for REVIEW.md + committed ARCHITECTURE.md", () => {
    expect(() =>
      resolve([R({ reviewPresent: true, architectureExists: true, architectureCommitted: true })]),
    ).toThrow(GtdStateError)
  })

  it("throws illegal-combination for uncommitted REVIEW.md + ARCHITECTURE.md", () => {
    expect(() =>
      resolve([
        R({
          reviewPresent: true,
          reviewCommitted: false,
          reviewDirty: false,
          architectureExists: true,
          architectureCommitted: false,
        }),
      ]),
    ).toThrow(GtdStateError)
  })

  it("throws illegal-combination for TODO.md + ARCHITECTURE.md coexisting", () => {
    expect(() => resolve([R({ todoExists: true, architectureExists: true })])).toThrow(
      GtdStateError,
    )
  })
})

// ── Boundary entry: dirty tree + human invoker → grilling capture ─────────

describe("dirty boundary entry", () => {
  it("human step on a dirty boundary tree captures gtd(human): grilling", () => {
    const result = resolve([R({ invoker: "human", workingTreeClean: false })])
    expect(result.state).toBe("grilling")
    expect(result.actor).toBe("human")
    expect(result.edgeAction).toEqual({ kind: "captureTurn", actor: "human", gate: "grilling" })
  })

  it("escape hatch: a dirty tree that already contains ARCHITECTURE.md captures gtd(human): architecting instead", () => {
    const result = resolve([
      R({ invoker: "human", workingTreeClean: false, architectureExists: true }),
    ])
    expect(result.state).toBe("architecting")
    expect(result.actor).toBe("human")
    expect(result.edgeAction).toEqual({
      kind: "captureTurn",
      actor: "human",
      gate: "architecting",
    })
  })

  it("agent step-agent on a dirty boundary tree is refused (awaits human)", () => {
    const result = resolve([R({ invoker: "agent", workingTreeClean: false })])
    expect(result.refusal).toContain("awaits a human turn")
    expect(result.edgeAction).toBeUndefined()
  })

  it("next (invoker none) reports the state without mutating", () => {
    const result = resolve([R({ invoker: "none", workingTreeClean: false })])
    expect(result.edgeAction).toBeUndefined()
  })
})

// ── Empty-turn semantics ────────────────────────────────────────────────────

describe("empty human grilling turn chains to gtd: architecting", () => {
  it("clean tree under gtd(human): grilling → routes to gtd: architecting, seeding ARCHITECTURE.md", () => {
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd(human): grilling",
        headTurnIsEmpty: true,
        todoExists: true,
        todoCommitted: true,
        workingTreeClean: true,
      }),
    ])
    expect(result.edgeAction).toEqual({
      kind: "commitRouting",
      subject: "gtd: architecting",
      seedArchitectureFromTodo: true,
    })
  })
})

describe("empty human architecting turn chains to gtd: grilled", () => {
  it("clean tree under gtd(human): architecting → routes to gtd: grilled", () => {
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd(human): architecting",
        headTurnIsEmpty: true,
        architectureExists: true,
        architectureCommitted: true,
        workingTreeClean: true,
      }),
    ])
    expect(result.edgeAction).toEqual({ kind: "commitRouting", subject: "gtd: grilled" })
  })
})

describe("architecting turn-taking", () => {
  it("empty agent turn at architecting is inert (rest, re-emit)", () => {
    const result = resolve([
      R({
        invoker: "none",
        lastCommitSubject: "gtd(agent): architecting",
        headTurnIsEmpty: true,
        architectureExists: true,
        architectureCommitted: true,
        workingTreeClean: true,
      }),
    ])
    expect(result.state).toBe("architecting")
    expect(result.actor).toBe("agent")
  })

  it("non-empty agent turn at architecting rests at the human answer gate", () => {
    const result = resolve([
      R({
        invoker: "none",
        lastCommitSubject: "gtd(agent): architecting",
        headTurnIsEmpty: false,
        architectureExists: true,
        architectureCommitted: false,
        workingTreeClean: true,
      }),
    ])
    expect(result.state).toBe("architecting")
    expect(result.actor).toBe("human")
  })

  it("non-empty human turn at architecting rests back at the agent", () => {
    const result = resolve([
      R({
        invoker: "none",
        lastCommitSubject: "gtd(human): architecting",
        headTurnIsEmpty: false,
        architectureExists: true,
        architectureCommitted: false,
        workingTreeClean: true,
      }),
    ])
    expect(result.state).toBe("architecting")
    expect(result.actor).toBe("agent")
  })

  it("gtd: architecting routing subject rests at architecting, agent", () => {
    const result = resolve([
      R({
        invoker: "none",
        lastCommitSubject: "gtd: architecting",
        architectureExists: true,
        workingTreeClean: true,
      }),
    ])
    expect(result.state).toBe("architecting")
    expect(result.actor).toBe("agent")
  })
})

describe("empty agent turn is inert", () => {
  it("re-emits the same agent grilling prompt rather than transitioning", () => {
    const result = resolve([
      R({
        invoker: "none",
        lastCommitSubject: "gtd(agent): grilling",
        headTurnIsEmpty: true,
        todoExists: true,
        todoCommitted: true,
        workingTreeClean: true,
      }),
    ])
    expect(result.state).toBe("grilling")
    expect(result.actor).toBe("agent")
  })
})

describe("idle human step never captures an empty turn", () => {
  it("runs the health check instead", () => {
    const result = resolve([
      R({ invoker: "human", workingTreeClean: true, lastCommitSubject: "chore: x" }),
    ])
    expect(result.state).toBe("idle")
    expect(result.edgeAction?.kind).toBe("runHealthCheck")
  })

  it("repeated human step at idle still runs the health check (no captureTurn)", () => {
    const result = resolve([
      R({ invoker: "human", workingTreeClean: true, lastCommitSubject: "gtd: health-fix" }),
    ])
    expect(result.state).toBe("idle")
    expect(result.edgeAction?.kind).toBe("runHealthCheck")
  })
})

// ── Out-of-turn behavior ──────────────────────────────────────────────────

describe("out-of-turn: step-agent while human awaited", () => {
  it("refuses at await-review", () => {
    const result = resolve([
      R({
        invoker: "agent",
        reviewPresent: true,
        lastCommitSubject: "gtd: awaiting review",
        workingTreeClean: true,
      }),
    ])
    expect(result.refusal).toContain("awaits a human turn")
    expect(result.edgeAction).toBeUndefined()
  })

  it("refuses at escalate", () => {
    const result = resolve([R({ invoker: "agent", errorsPresent: true, packagesPresent: true })])
    expect(result.refusal).toContain("awaits a human turn")
  })
})

describe("out-of-turn: human step while agent awaited", () => {
  it("refuses at building even on a dirty tree — human edits ride along in the agent's next turn", () => {
    const result = resolve([
      R({
        invoker: "human",
        packagesPresent: true,
        workingTreeClean: false,
        codeDirty: true,
        lastCommitSubject: "gtd: planning",
      }),
    ])
    expect(result.state).toBe("building")
    expect(result.refusal).toContain("awaits an agent turn")
    expect(result.edgeAction).toBeUndefined()
  })

  it("refuses at building on a clean tree (no silent no-op)", () => {
    const result = resolve([
      R({
        invoker: "human",
        packagesPresent: true,
        workingTreeClean: true,
        lastCommitSubject: "gtd: planning",
      }),
    ])
    expect(result.state).toBe("building")
    expect(result.refusal).toContain("awaits an agent turn")
    expect(result.edgeAction).toBeUndefined()
  })

  it("refuses at grilled — a dirty tree there is the decompose agent's output, not human feedback", () => {
    const result = resolve([
      R({
        invoker: "human",
        lastCommitSubject: "gtd: grilled",
        architectureExists: true,
        architectureCommitted: true,
        packagesPresent: true,
        gtdModified: true,
        workingTreeClean: false,
      }),
    ])
    expect(result.state).toBe("grilled")
    expect(result.refusal).toContain("run `gtd step-agent`")
    expect(result.edgeAction).toBeUndefined()
  })

  it("refuses at grilled on a clean tree too", () => {
    const result = resolve([
      R({
        invoker: "human",
        lastCommitSubject: "gtd: grilled",
        architectureExists: true,
        architectureCommitted: true,
        workingTreeClean: true,
      }),
    ])
    expect(result.state).toBe("grilled")
    expect(result.refusal).toContain("run `gtd step-agent`")
    expect(result.edgeAction).toBeUndefined()
  })
})

describe("gtd(agent): grilled mid-chains to gtd: planning", () => {
  it("with packages present, routes to planning and removes ARCHITECTURE.md", () => {
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd(agent): grilled",
        architectureExists: true,
        architectureCommitted: false,
        packagesPresent: true,
        workingTreeClean: true,
      }),
    ])
    expect(result.edgeAction).toEqual({
      kind: "commitRouting",
      subject: "gtd: planning",
      removeArchitecture: true,
    })
  })

  it("with no packages yet, rests so gtd next re-emits the decompose prompt", () => {
    const result = resolve([
      R({
        invoker: "none",
        lastCommitSubject: "gtd(agent): grilled",
        architectureExists: true,
        architectureCommitted: false,
        packagesPresent: false,
        workingTreeClean: true,
      }),
    ])
    expect(result.state).toBe("grilled")
    expect(result.actor).toBe("agent")
    expect(result.edgeAction).toBeUndefined()
  })
})

// ── Squash chain ──────────────────────────────────────────────────────────

describe("squash chain", () => {
  it("gtd: done + squash enabled + squashBase → writeSquashTemplate", () => {
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd: done",
        squashEnabled: true,
        squashBase: "abc123",
        workingTreeClean: true,
      }),
    ])
    expect(result.edgeAction).toEqual({ kind: "writeSquashTemplate" })
  })

  it("gtd: squash template → rest squashing prompt for agent", () => {
    const result = resolve([
      R({ invoker: "none", lastCommitSubject: "gtd: squash template", workingTreeClean: true }),
    ])
    expect(result.state).toBe("squashing")
    expect(result.actor).toBe("agent")
    expect(result.edgeAction).toBeUndefined()
  })

  it("gtd(agent): squashing → squashCommit", () => {
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd(agent): squashing",
        squashBase: "abc123",
        workingTreeClean: true,
      }),
    ])
    expect(result.edgeAction).toEqual({ kind: "squashCommit", squashBase: "abc123" })
  })
})

// ── Turn prediction (gtd status) ──────────────────────────────────────────

describe("predictTurn", () => {
  it("predicts the human grilling capture on a dirty boundary tree", () => {
    const prediction = predictTurn([R({ workingTreeClean: false })])
    expect(prediction.actor).toBe("human")
    expect(prediction.subject).toBe("gtd(human): grilling")
  })

  it("predicts a routing commit at a mid-chain HEAD", () => {
    const prediction = predictTurn([
      R({
        lastCommitSubject: "gtd(human): grilling",
        headTurnIsEmpty: true,
        todoExists: true,
        todoCommitted: true,
        workingTreeClean: true,
      }),
    ])
    expect(prediction.subject).toBe("gtd: architecting")
  })

  it("escape hatch: predicts the human architecting capture when ARCHITECTURE.md is already in the dirty tree", () => {
    const prediction = predictTurn([R({ workingTreeClean: false, architectureExists: true })])
    expect(prediction.actor).toBe("human")
    expect(prediction.subject).toBe("gtd(human): architecting")
    expect(prediction.state).toBe("architecting")
  })

  it("predicts null at a settled rest (idle, health check is not a commit-predicting action)", () => {
    const prediction = predictTurn([
      R({ workingTreeClean: true, lastCommitSubject: "gtd: health-fix" }),
    ])
    expect(prediction.state).toBe("idle")
  })

  it("never mutates: querying twice yields the same prediction", () => {
    const events: GtdEvent[] = [R({ workingTreeClean: false })]
    expect(predictTurn(events)).toEqual(predictTurn(events))
  })
})

// ── Health lifecycle ───────────────────────────────────────────────────────

describe("health lifecycle", () => {
  it("gtd: health-check rest, agent step (dirty, fixed) → captures gtd(agent): health-fixing", () => {
    const result = resolve([
      R({
        invoker: "agent",
        healthPresent: true,
        healthCommitted: true,
        workingTreeClean: false,
        lastCommitSubject: "gtd: health-check",
      }),
    ])
    expect(result.state).toBe("health-fixing")
    expect(result.edgeAction).toEqual({
      kind: "captureTurn",
      actor: "agent",
      gate: "health-fixing",
    })
  })

  it("gtd(agent): health-fixing mid-chain → commits gtd: health-fix, removes HEALTH.md", () => {
    const result = resolve([
      R({
        invoker: "none",
        lastCommitSubject: "gtd(agent): health-fixing",
        workingTreeClean: true,
      }),
    ])
    expect(result.pending).toBe(true)
  })

  it("gtd(agent): health-fixing mid-chain, invoker agent → performs the commit", () => {
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd(agent): health-fixing",
        workingTreeClean: true,
      }),
    ])
    expect(result.edgeAction).toEqual({
      kind: "commitRouting",
      subject: "gtd: health-fix",
      removeHealth: true,
    })
  })

  it("gtd: health-check rest with ERRORS.md present (cap reached) → escalate", () => {
    const result = resolve([
      R({
        invoker: "none",
        errorsPresent: true,
        lastCommitSubject: "gtd: health-check",
        workingTreeClean: true,
      }),
    ])
    expect(result.state).toBe("escalate")
    expect(result.actor).toBe("human")
  })
})

// ── Feedback / testing lifecycle ───────────────────────────────────────────

describe("feedback lifecycle", () => {
  it("non-empty FEEDBACK.md → fixing", () => {
    const result = resolve([
      R({ packagesPresent: true, feedbackPresent: true, feedbackEmpty: false }),
    ])
    expect(result.state).toBe("fixing")
  })

  it("empty FEEDBACK.md → close-package (mid-chain, invoker agent performs it)", () => {
    const result = resolve([
      R({ invoker: "agent", packagesPresent: true, feedbackPresent: true, feedbackEmpty: true }),
    ])
    expect(result.state).toBe("close-package")
    expect(result.edgeAction).toEqual({ kind: "closePackage" })
  })

  it("empty FEEDBACK.md, invoker none → reported pending, no mutation", () => {
    const result = resolve([
      R({ invoker: "none", packagesPresent: true, feedbackPresent: true, feedbackEmpty: true }),
    ])
    expect(result.state).toBe("close-package")
    expect(result.pending).toBe(true)
    expect(result.edgeAction).toBeUndefined()
  })
})

describe("tests green force-approve", () => {
  it("agenticReviewEnabled false → close-package directly", () => {
    const result = resolve([
      R({
        packagesPresent: true,
        workingTreeClean: true,
        lastCommitSubject: "gtd: tests green",
        agenticReviewEnabled: false,
      }),
    ])
    expect(result.state).toBe("close-package")
  })

  it("agenticReviewEnabled true → agentic-review prompt", () => {
    const result = resolve([
      R({
        packagesPresent: true,
        workingTreeClean: true,
        lastCommitSubject: "gtd: tests green",
        agenticReviewEnabled: true,
      }),
    ])
    expect(result.state).toBe("agentic-review")
  })
})

// ── Review lifecycle ───────────────────────────────────────────────────────

describe("review lifecycle", () => {
  it("gtd(agent): review mid-chain → commits gtd: awaiting review", () => {
    const result = resolve([
      R({
        invoker: "agent",
        reviewPresent: true,
        lastCommitSubject: "gtd(agent): review",
        workingTreeClean: true,
      }),
    ])
    expect(result.edgeAction).toEqual({ kind: "commitRouting", subject: "gtd: awaiting review" })
  })

  it("gtd: awaiting review is a rest → await-review (human)", () => {
    const result = resolve([
      R({
        invoker: "none",
        reviewPresent: true,
        reviewCommitted: true,
        lastCommitSubject: "gtd: awaiting review",
        workingTreeClean: true,
      }),
    ])
    expect(result.state).toBe("await-review")
    expect(result.actor).toBe("human")
  })

  it("empty gtd(human): review turn (approval) → commits gtd: done", () => {
    const result = resolve([
      R({
        invoker: "human",
        reviewPresent: true,
        reviewCommitted: true,
        lastCommitSubject: "gtd(human): review",
        headTurnIsEmpty: true,
        workingTreeClean: true,
      }),
    ])
    expect(result.edgeAction).toEqual({
      kind: "commitRouting",
      subject: "gtd: done",
      removeReview: true,
    })
  })

  it("checkbox-only gtd(human): review turn → commits gtd: done (approval)", () => {
    const result = resolve([
      R({
        invoker: "human",
        reviewPresent: true,
        reviewCommitted: true,
        reviewDirty: true,
        reviewCheckboxOnly: true,
        lastCommitSubject: "gtd(human): review",
        headTurnIsEmpty: false,
        workingTreeClean: true,
      }),
    ])
    expect(result.edgeAction).toEqual({
      kind: "commitRouting",
      subject: "gtd: done",
      removeReview: true,
    })
  })

  it("substantive gtd(human): review turn → commits gtd: review feedback", () => {
    const result = resolve([
      R({
        invoker: "human",
        reviewPresent: true,
        reviewCommitted: true,
        reviewDirty: true,
        reviewCheckboxOnly: false,
        lastCommitSubject: "gtd(human): review",
        headTurnIsEmpty: false,
        workingTreeClean: true,
      }),
    ])
    expect(result.edgeAction).toEqual({
      kind: "commitRouting",
      subject: "gtd: review feedback",
      removeReview: true,
    })
  })

  it("gtd: review feedback is a rest → grilling (agent)", () => {
    const result = resolve([
      R({ invoker: "none", lastCommitSubject: "gtd: review feedback", workingTreeClean: true }),
    ])
    expect(result.state).toBe("grilling")
    expect(result.actor).toBe("agent")
  })
})

// ── Corruption ─────────────────────────────────────────────────────────────

describe("corruption", () => {
  it("throws corruption for an unrecognized clean .gtd HEAD", () => {
    expect(() =>
      resolve([
        R({ packagesPresent: true, workingTreeClean: true, lastCommitSubject: "chore: weird" }),
      ]),
    ).toThrow(GtdStateError)
  })
})
