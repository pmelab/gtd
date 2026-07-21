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
    isTestsGreen?: boolean
  } = {},
): GtdEvent => ({
  // Defaults first, caller overrides spread on top — call sites pass literal
  // objects holding only the keys they mean to set, never explicit undefined.
  type: "COMMIT",
  isErrors: false,
  isFeedback: false,
  isPackageStart: false,
  isWorkflowCommit: true,
  removedErrors: false,
  isHealthCheck: false,
  isTestsGreen: false,
  ...flags,
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

  it("resets on isTestsGreen (a green re-test ends the health run)", () => {
    const events = [
      commit({ isHealthCheck: true }),
      commit({ isHealthCheck: true }),
      commit({ isTestsGreen: true }),
    ]
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

  it("is human for await-learning-review", () => {
    expect(awaitedActor("await-learning-review")).toBe("human")
  })

  it("is agent for building, fixing, agentic-review, squashing, health-fixing", () => {
    expect(awaitedActor("building")).toBe("agent")
    expect(awaitedActor("fixing")).toBe("agent")
    expect(awaitedActor("agentic-review")).toBe("agent")
    expect(awaitedActor("squashing")).toBe("agent")
    expect(awaitedActor("health-fixing")).toBe("agent")
  })

  it("is agent for learning, learning-apply, learning-applied", () => {
    expect(awaitedActor("learning")).toBe("agent")
    expect(awaitedActor("learning-apply")).toBe("agent")
    expect(awaitedActor("learning-applied")).toBe("agent")
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

  it("throws illegal-combination for PLAN.md + TODO.md and PLAN.md + ARCHITECTURE.md", () => {
    expect(() => resolve([R({ planExists: true, todoExists: true })])).toThrow(
      "illegal combination: .gtd/PLAN.md + .gtd/TODO.md",
    )
    expect(() => resolve([R({ planExists: true, architectureExists: true })])).toThrow(
      "illegal combination: .gtd/PLAN.md + .gtd/ARCHITECTURE.md",
    )
  })

  it("throws illegal-combination for PLAN.md + packages / REVIEW.md / FEEDBACK.md / ERRORS.md", () => {
    expect(() => resolve([R({ planExists: true, packagesPresent: true })])).toThrow(GtdStateError)
    expect(() => resolve([R({ planExists: true, reviewPresent: true })])).toThrow(GtdStateError)
    expect(() =>
      resolve([R({ planExists: true, feedbackPresent: true, packagesPresent: true })]),
    ).toThrow("illegal combination: .gtd/PLAN.md + packages")
    expect(() => resolve([R({ planExists: true, errorsPresent: true })])).toThrow(GtdStateError)
  })

  it("throws illegal-combination for PLAN.md + SQUASH_MSG.md / LEARNINGS.md (defensive)", () => {
    expect(() => resolve([R({ planExists: true, squashMsgPresent: true })])).toThrow(GtdStateError)
    expect(() => resolve([R({ planExists: true, learningMsgPresent: true })])).toThrow(
      GtdStateError,
    )
  })

  it("throws illegal-combination for HEALTH.md + TODO.md / ARCHITECTURE.md / PLAN.md", () => {
    expect(() => resolve([R({ healthPresent: true, todoExists: true })])).toThrow(
      "illegal combination: .gtd/HEALTH.md + .gtd/TODO.md",
    )
    expect(() => resolve([R({ healthPresent: true, architectureExists: true })])).toThrow(
      GtdStateError,
    )
    expect(() => resolve([R({ healthPresent: true, planExists: true })])).toThrow(
      "illegal combination: .gtd/HEALTH.md + .gtd/PLAN.md",
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

  it("PLAN.md entry: a dirty tree that already contains PLAN.md captures gtd(human): grilled", () => {
    const result = resolve([R({ invoker: "human", workingTreeClean: false, planExists: true })])
    expect(result.state).toBe("grilled")
    expect(result.actor).toBe("human")
    expect(result.edgeAction).toEqual({ kind: "captureTurn", actor: "human", gate: "grilled" })
  })

  it("HEALTH.md entry: a dirty tree with a hand-written HEALTH.md captures gtd(human): health-fixing", () => {
    const result = resolve([
      R({
        invoker: "human",
        workingTreeClean: false,
        healthPresent: true,
        healthContent: "the build script crashes on Node 22",
      }),
    ])
    expect(result.state).toBe("health-fixing")
    expect(result.actor).toBe("human")
    expect(result.edgeAction).toEqual({
      kind: "captureTurn",
      actor: "human",
      gate: "health-fixing",
    })
  })

  it("a committed PLAN.md at a boundary HEAD resumes the entry on a clean human step", () => {
    const result = resolve([
      R({
        invoker: "human",
        workingTreeClean: true,
        planExists: true,
        planCommitted: true,
      }),
    ])
    expect(result.state).toBe("grilled")
    expect(result.edgeAction).toEqual({ kind: "captureTurn", actor: "human", gate: "grilled" })
  })

  it("a committed PLAN.md at a boundary HEAD refuses an agent step (awaits human)", () => {
    const result = resolve([
      R({ invoker: "agent", workingTreeClean: true, planExists: true, planCommitted: true }),
    ])
    expect(result.refusal).toContain("awaits a human turn")
    expect(result.edgeAction).toBeUndefined()
  })
})

// ── PLAN.md entry: the seed hop ────────────────────────────────────────────

describe("gtd(human): grilled seeds ARCHITECTURE.md from PLAN.md", () => {
  it("with PLAN.md present → mid-chains to gtd: grilled with seedArchitectureFromPlan", () => {
    const result = resolve([
      R({
        invoker: "human",
        lastCommitSubject: "gtd(human): grilled",
        planExists: true,
        planCommitted: true,
        workingTreeClean: true,
      }),
    ])
    expect(result.state).toBe("grilled")
    expect(result.edgeAction).toEqual({
      kind: "commitRouting",
      subject: "gtd: grilled",
      seedArchitectureFromPlan: true,
    })
  })

  it("invoker none reports the seed hop as pending", () => {
    const result = resolve([
      R({
        invoker: "none",
        lastCommitSubject: "gtd(human): grilled",
        planExists: true,
        planCommitted: true,
        workingTreeClean: true,
      }),
    ])
    expect(result.pending).toBe(true)
    expect(result.edgeAction).toBeUndefined()
  })

  it("without PLAN.md (hand-crafted or half-seeded history) → never seeds; falls through the ladder", () => {
    // No steering files at all → idle, fabricating nothing.
    const bare = resolve([
      R({ invoker: "none", lastCommitSubject: "gtd(human): grilled", workingTreeClean: true }),
    ])
    expect(bare.state).toBe("idle")
    expect(bare.edgeAction).toBeUndefined()
    // Half-seeded crash (ARCHITECTURE.md written, PLAN.md deleted, commit
    // failed) → recovers through a normal architecting round, preserving the
    // seeded content.
    const halfSeeded = resolve([
      R({
        invoker: "none",
        lastCommitSubject: "gtd(human): grilled",
        architectureExists: true,
        workingTreeClean: false,
      }),
    ])
    expect(halfSeeded.state).toBe("architecting")
  })
})

// ── HEALTH.md entry: empty-agent-turn guard ────────────────────────────────

describe("empty agent turn at the HEALTH.md entry rest", () => {
  it("is inert while HEAD is the human entry turn (the hand-written HEALTH.md survives)", () => {
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd(human): health-fixing",
        healthPresent: true,
        healthCommitted: true,
        healthContent: "the build script crashes on Node 22",
        workingTreeClean: true,
      }),
    ])
    expect(result.state).toBe("health-fixing")
    expect(result.edgeAction).toBeUndefined()
    expect(result.refusal).toBeUndefined()
  })

  it("stays meaningful on the machine-written detour (HEAD = gtd: health-check)", () => {
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd: health-check",
        healthPresent: true,
        healthCommitted: true,
        healthContent: "test output",
        workingTreeClean: true,
      }),
    ])
    expect(result.state).toBe("health-fixing")
    expect(result.edgeAction).toEqual({
      kind: "captureTurn",
      actor: "agent",
      gate: "health-fixing",
    })
  })
})

// ── Empty-turn semantics ────────────────────────────────────────────────────

describe("accept-defaults grilling turn chains to gtd: architecting", () => {
  it("gtd(human): grilling-accepted → routes to gtd: architecting, seeding ARCHITECTURE.md", () => {
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd(human): grilling-accepted",
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

describe("accept-defaults architecting turn chains to gtd: grilled", () => {
  it("gtd(human): architecting-accepted → routes to gtd: grilled", () => {
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd(human): architecting-accepted",
        architectureExists: true,
        architectureCommitted: true,
        workingTreeClean: true,
      }),
    ])
    expect(result.edgeAction).toEqual({ kind: "commitRouting", subject: "gtd: grilled" })
  })
})

describe("architecting turn-taking", () => {
  it("a clean-tree agent step at the architecting rest captures nothing (inert)", () => {
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd: architecting",
        architectureExists: true,
        architectureCommitted: true,
        workingTreeClean: true,
      }),
    ])
    expect(result.state).toBe("architecting")
    expect(result.actor).toBe("agent")
    expect(result.edgeAction).toBeUndefined()
  })

  it("an agent architecting draft turn rests at the human answer gate", () => {
    const result = resolve([
      R({
        invoker: "none",
        lastCommitSubject: "gtd(agent): architecting",
        architectureExists: true,
        architectureCommitted: false,
        workingTreeClean: true,
      }),
    ])
    expect(result.state).toBe("architecting")
    expect(result.actor).toBe("human")
  })

  it("a human architecting answer turn rests back at the agent", () => {
    const result = resolve([
      R({
        invoker: "none",
        lastCommitSubject: "gtd(human): architecting",
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

describe("clean-tree agent step at the grilling rest is inert", () => {
  it("captures nothing and re-emits the same prompt (no capture rule matches)", () => {
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd: grilling",
        todoExists: true,
        todoCommitted: true,
        workingTreeClean: true,
      }),
    ])
    expect(result.state).toBe("grilling")
    expect(result.actor).toBe("agent")
    expect(result.edgeAction).toBeUndefined()
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
      R({ invoker: "human", workingTreeClean: true, lastCommitSubject: "gtd: testing" }),
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
        lastCommitSubject: "gtd: await-review",
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
        lastCommitSubject: "gtd: building",
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
        lastCommitSubject: "gtd: building",
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
    expect(result.refusal).toContain("run `gtd step agent`")
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
    expect(result.refusal).toContain("run `gtd step agent`")
    expect(result.edgeAction).toBeUndefined()
  })
})

describe("gtd(agent): grilled mid-chains to gtd: building", () => {
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
      subject: "gtd: building",
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

  it("gtd: squashing → rest squashing prompt for agent", () => {
    const result = resolve([
      R({ invoker: "none", lastCommitSubject: "gtd: squashing", workingTreeClean: true }),
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

  it("gtd: done + squash enabled + learning enabled + squashBase → writeLearningTemplate (learning runs first)", () => {
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd: done",
        squashEnabled: true,
        learningEnabled: true,
        squashBase: "abc123",
        workingTreeClean: true,
      }),
    ])
    expect(result.edgeAction).toEqual({ kind: "writeLearningTemplate" })
  })

  it("gtd: done + learning enabled + squash disabled + squashBase → writeLearningTemplate (orthogonal to squash)", () => {
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd: done",
        squashEnabled: false,
        learningEnabled: true,
        squashBase: "abc123",
        workingTreeClean: true,
      }),
    ])
    expect(result.edgeAction).toEqual({ kind: "writeLearningTemplate" })
  })
})

// ── Learning chain ────────────────────────────────────────────────────────

describe("learning chain", () => {
  it("gtd: learning → rest learning prompt for agent", () => {
    const result = resolve([
      R({ invoker: "none", lastCommitSubject: "gtd: learning", workingTreeClean: true }),
    ])
    expect(result.state).toBe("learning")
    expect(result.actor).toBe("agent")
    expect(result.edgeAction).toBeUndefined()
  })

  it("a step that never touched LEARNINGS.md captures nothing at the learning rest", () => {
    // The template protection moved to capture: only a pending LEARNINGS.md
    // edit matches the learning capture rule, so the unmodified template can
    // never be captured as a draft turn.
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd: learning",
        squashBase: "abc123",
        learningMsgPresent: true,
        workingTreeClean: false,
        codeDirty: true,
      }),
    ])
    expect(result.state).toBe("learning")
    expect(result.actor).toBe("agent")
    expect(result.edgeAction).toBeUndefined()
  })

  it("gtd(agent): learning (capture-guaranteed real draft) → commitRouting gtd: await-learning-review", () => {
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd(agent): learning",
        squashBase: "abc123",
        workingTreeClean: true,
      }),
    ])
    expect(result.edgeAction).toEqual({
      kind: "commitRouting",
      subject: "gtd: await-learning-review",
    })
  })

  it("gtd: await-learning-review → rest await-learning-review prompt for human", () => {
    const result = resolve([
      R({
        invoker: "none",
        lastCommitSubject: "gtd: await-learning-review",
        workingTreeClean: true,
      }),
    ])
    expect(result.state).toBe("await-learning-review")
    expect(result.actor).toBe("human")
    expect(result.edgeAction).toBeUndefined()
  })

  it("gtd(human): learning (even empty — accept as-is) → commitRouting gtd: learning-apply", () => {
    const result = resolve([
      R({
        invoker: "human",
        lastCommitSubject: "gtd(human): learning",
        workingTreeClean: true,
      }),
    ])
    expect(result.edgeAction).toEqual({
      kind: "commitRouting",
      subject: "gtd: learning-apply",
    })
  })

  it("gtd: learning-apply → rest learning-apply prompt for agent", () => {
    const result = resolve([
      R({ invoker: "none", lastCommitSubject: "gtd: learning-apply", workingTreeClean: true }),
    ])
    expect(result.state).toBe("learning-apply")
    expect(result.actor).toBe("agent")
    expect(result.edgeAction).toBeUndefined()
  })

  it("a clean tree at learning-apply is inert (no doc edits to capture)", () => {
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd: learning-apply",
        workingTreeClean: true,
      }),
    ])
    expect(result.state).toBe("learning-apply")
    expect(result.actor).toBe("agent")
    expect(result.edgeAction).toBeUndefined()
  })

  it("gtd(agent): learning-apply → commitRouting gtd: learning-applied, removeLearning", () => {
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd(agent): learning-apply",
        workingTreeClean: true,
      }),
    ])
    expect(result.edgeAction).toEqual({
      kind: "commitRouting",
      subject: "gtd: learning-applied",
      removeLearning: true,
    })
  })

  it("gtd: learning-applied + squash enabled + squashBase → writeSquashTemplate", () => {
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd: learning-applied",
        squashEnabled: true,
        squashBase: "abc123",
        workingTreeClean: true,
      }),
    ])
    expect(result.edgeAction).toEqual({ kind: "writeSquashTemplate" })
  })

  it("gtd: learning-applied + squash disabled → rest idle for human", () => {
    const result = resolve([
      R({
        invoker: "none",
        lastCommitSubject: "gtd: learning-applied",
        squashEnabled: false,
        workingTreeClean: true,
      }),
    ])
    expect(result.state).toBe("idle")
    expect(result.actor).toBe("human")
    expect(result.edgeAction).toBeUndefined()
  })

  it('human turn authored at await-learning-review captures under gate "learning", not "review"', () => {
    const result = resolve([
      R({
        invoker: "human",
        lastCommitSubject: "gtd: await-learning-review",
        workingTreeClean: false,
        codeDirty: true,
      }),
    ])
    expect(result.edgeAction).toEqual({
      kind: "captureTurn",
      actor: "human",
      gate: "learning",
    })
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
        lastCommitSubject: "gtd(human): grilling-accepted",
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

  it("PLAN.md entry: predicts the human grilled capture when PLAN.md is in the dirty tree", () => {
    const prediction = predictTurn([R({ workingTreeClean: false, planExists: true })])
    expect(prediction.actor).toBe("human")
    expect(prediction.subject).toBe("gtd(human): grilled")
    expect(prediction.state).toBe("grilled")
  })

  it("HEALTH.md entry: predicts the human health-fixing capture when a hand-written HEALTH.md is in the dirty tree", () => {
    const prediction = predictTurn([R({ workingTreeClean: false, healthPresent: true })])
    expect(prediction.actor).toBe("human")
    expect(prediction.subject).toBe("gtd(human): health-fixing")
    expect(prediction.state).toBe("health-fixing")
  })

  it("predicts null at the HEALTH.md entry rest (clean tree, HEAD is the human entry turn)", () => {
    const prediction = predictTurn([
      R({
        lastCommitSubject: "gtd(human): health-fixing",
        healthPresent: true,
        healthCommitted: true,
        workingTreeClean: true,
      }),
    ])
    expect(prediction.state).toBe("health-fixing")
    expect(prediction.subject).toBeNull()
  })

  it("predicts the seed routing commit at the PLAN.md entry turn HEAD", () => {
    const prediction = predictTurn([
      R({
        lastCommitSubject: "gtd(human): grilled",
        planExists: true,
        planCommitted: true,
        workingTreeClean: true,
      }),
    ])
    expect(prediction.subject).toBe("gtd: grilled")
    expect(prediction.state).toBe("grilled")
  })

  it("predicts null at a settled rest (idle, health check is not a commit-predicting action)", () => {
    const prediction = predictTurn([
      R({ workingTreeClean: true, lastCommitSubject: "gtd: testing" }),
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

  it("gtd(agent): health-fixing mid-chain → commits gtd: testing, removes HEALTH.md", () => {
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
      subject: "gtd: testing",
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

  it("gtd: testing re-test chains after green on healthFixBase alone (green-first-try entry run has zero health-check commits)", () => {
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd: testing",
        workingTreeClean: true,
        squashEnabled: true,
        healthFixBase: "abc123",
      }),
    ])
    expect(result.edgeAction).toEqual({
      kind: "runHealthCheck",
      errorCount: 0,
      capReached: false,
      chainAfterGreen: true,
    })
  })

  it("gtd: testing re-test does not chain when no healthFixBase is anchored", () => {
    const result = resolve([
      R({
        invoker: "agent",
        lastCommitSubject: "gtd: testing",
        workingTreeClean: true,
        squashEnabled: true,
      }),
    ])
    expect(result.edgeAction).toEqual({
      kind: "runHealthCheck",
      errorCount: 0,
      capReached: false,
      chainAfterGreen: false,
    })
  })

  it("idle human step does not chain after green once the run's anchor is gone (no healthFixBase)", () => {
    const events = [
      commit({ isHealthCheck: true }),
      commit({ isTestsGreen: true }),
      R({ invoker: "human", workingTreeClean: true, squashEnabled: true }),
    ]
    const result = resolve(events)
    expect(result.state).toBe("idle")
    expect(result.edgeAction).toEqual({
      kind: "runHealthCheck",
      errorCount: 0,
      capReached: false,
      chainAfterGreen: false,
    })
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
        lastCommitSubject: "gtd: tests-green",
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
        lastCommitSubject: "gtd: tests-green",
        agenticReviewEnabled: true,
      }),
    ])
    expect(result.state).toBe("agentic-review")
  })
})

// ── Review lifecycle ───────────────────────────────────────────────────────

describe("review lifecycle", () => {
  it("gtd(agent): review mid-chain → commits gtd: await-review", () => {
    const result = resolve([
      R({
        invoker: "agent",
        reviewPresent: true,
        lastCommitSubject: "gtd(agent): review",
        workingTreeClean: true,
      }),
    ])
    expect(result.edgeAction).toEqual({ kind: "commitRouting", subject: "gtd: await-review" })
  })

  it("gtd: await-review is a rest → await-review (human)", () => {
    const result = resolve([
      R({
        invoker: "none",
        reviewPresent: true,
        reviewCommitted: true,
        lastCommitSubject: "gtd: await-review",
        workingTreeClean: true,
      }),
    ])
    expect(result.state).toBe("await-review")
    expect(result.actor).toBe("human")
  })

  it("gtd(human): review-approved (decided at capture) → commits gtd: done", () => {
    const result = resolve([
      R({
        invoker: "human",
        reviewPresent: true,
        reviewCommitted: true,
        lastCommitSubject: "gtd(human): review-approved",
        workingTreeClean: true,
      }),
    ])
    expect(result.edgeAction).toEqual({
      kind: "commitRouting",
      subject: "gtd: done",
      removeReview: true,
    })
  })

  it("a checkbox-only pending edit at await-review captures as review-approved", () => {
    const result = resolve([
      R({
        invoker: "human",
        reviewPresent: true,
        reviewDirty: true,
        reviewCheckboxOnly: true,
        lastCommitSubject: "gtd: await-review",
        workingTreeClean: false,
      }),
    ])
    expect(result.edgeAction).toEqual({
      kind: "captureTurn",
      actor: "human",
      gate: "review-approved",
    })
  })

  it("a substantive pending edit at await-review captures as review-feedback", () => {
    const result = resolve([
      R({
        invoker: "human",
        reviewPresent: true,
        reviewDirty: true,
        reviewCheckboxOnly: false,
        lastCommitSubject: "gtd: await-review",
        workingTreeClean: false,
      }),
    ])
    expect(result.edgeAction).toEqual({
      kind: "captureTurn",
      actor: "human",
      gate: "review-feedback",
    })
  })

  it("gtd(human): review-feedback (decided at capture) → commits gtd: grilling", () => {
    const result = resolve([
      R({
        invoker: "human",
        reviewPresent: true,
        reviewCommitted: true,
        lastCommitSubject: "gtd(human): review-feedback",
        workingTreeClean: true,
      }),
    ])
    expect(result.edgeAction).toEqual({
      kind: "commitRouting",
      subject: "gtd: grilling",
      removeReview: true,
    })
  })

  it("gtd: grilling is a rest → grilling (agent)", () => {
    const result = resolve([
      R({ invoker: "none", lastCommitSubject: "gtd: grilling", workingTreeClean: true }),
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
