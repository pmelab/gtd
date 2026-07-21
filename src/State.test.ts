import { describe, expect, it } from "vitest"
import type { EdgeAction, GtdState, TurnPrediction } from "./Machine.js"
import { describeEdgeAction, describeStatus } from "./State.js"

describe("describeStatus", () => {
  it("projects a TurnPrediction with a predicted commit into a StatusSummary", () => {
    const prediction: TurnPrediction = {
      actor: "human",
      subject: "gtd(human): building",
      state: "building" as GtdState,
    }
    expect(describeStatus(prediction)).toEqual({
      state: "building",
      actor: "human",
      predictedCommit: "gtd(human): building",
      predictedState: "building",
    })
  })

  it("projects a TurnPrediction with no predicted commit (subject: null)", () => {
    const prediction: TurnPrediction = {
      actor: "agent",
      subject: null,
      state: "grilling" as GtdState,
    }
    expect(describeStatus(prediction)).toEqual({
      state: "grilling",
      actor: "agent",
      predictedCommit: null,
      predictedState: "grilling",
    })
  })
})

// `describeEdgeAction` must be total over the v2 `EdgeAction` union — every
// variant needs a phrase, or the driver's `actions` summary silently omits a
// hop. This exhaustiveness check is enforced at both the type level (the
// `EdgeActionHandlers` mapped type in State.ts requires every kind) and here,
// with one representative instance per variant.
describe("describeEdgeAction (exhaustive over EdgeAction)", () => {
  const cases: ReadonlyArray<EdgeAction> = [
    { kind: "captureTurn", actor: "human", gate: "building" },
    { kind: "commitRouting", subject: "gtd: tests-green" },
    { kind: "closePackage" },
    { kind: "writeSquashTemplate" },
    { kind: "squashCommit", squashBase: "abc1234" },
    { kind: "writeLearningTemplate" },
  ]

  it("returns a non-empty phrase for every EdgeAction variant", () => {
    for (const action of cases) {
      expect(describeEdgeAction(action)).toEqual(expect.any(String))
      expect(describeEdgeAction(action).length).toBeGreaterThan(0)
    }
  })

  it("captureTurn names the actor and gate", () => {
    expect(describeEdgeAction({ kind: "captureTurn", actor: "agent", gate: "fixing" })).toBe(
      'capture the agent turn as "gtd(agent): fixing"',
    )
  })

  it("commitRouting names the subject with no removal flags", () => {
    expect(describeEdgeAction({ kind: "commitRouting", subject: "gtd: grilled" })).toBe(
      'commit routing as "gtd: grilled"',
    )
  })

  it("commitRouting lists every removal flag that is set", () => {
    expect(
      describeEdgeAction({
        kind: "commitRouting",
        subject: "gtd: close-package",
        removeArchitecture: true,
        removeFeedback: true,
      }),
    ).toBe(
      'commit routing as "gtd: close-package" (removing .gtd/ARCHITECTURE.md, .gtd/FEEDBACK.md)',
    )
  })

  it("commitRouting notes the seedArchitectureFromTodo hand-off", () => {
    expect(
      describeEdgeAction({
        kind: "commitRouting",
        subject: "gtd: architecting",
        seedArchitectureFromTodo: true,
      }),
    ).toBe('commit routing as "gtd: architecting" (seeding .gtd/ARCHITECTURE.md from .gtd/TODO.md)')
  })

  it("commitRouting notes the seedArchitectureFromPlan hand-off", () => {
    expect(
      describeEdgeAction({
        kind: "commitRouting",
        subject: "gtd: grilled",
        seedArchitectureFromPlan: true,
      }),
    ).toBe('commit routing as "gtd: grilled" (seeding .gtd/ARCHITECTURE.md from .gtd/PLAN.md)')
  })

  it("commitRouting lists removeLearning", () => {
    expect(
      describeEdgeAction({
        kind: "commitRouting",
        subject: "gtd: learning-applied",
        removeLearning: true,
      }),
    ).toBe('commit routing as "gtd: learning-applied" (removing .gtd/LEARNINGS.md)')
  })

  it("commitRouting notes the check-output promotion to ERRORS.md", () => {
    expect(
      describeEdgeAction({
        kind: "commitRouting",
        subject: "gtd: escalated",
        promoteCheckOutputToErrors: true,
      }),
    ).toBe('commit routing as "gtd: escalated" (promoting the check output to .gtd/ERRORS.md)')
  })

  it("squashCommit names the squash base", () => {
    expect(describeEdgeAction({ kind: "squashCommit", squashBase: "deadbee" })).toBe(
      "squash the cycle onto deadbee",
    )
  })

  it("writeLearningTemplate returns a fixed phrase", () => {
    expect(describeEdgeAction({ kind: "writeLearningTemplate" })).toBe(
      "write the learnings template",
    )
  })
})
