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
    { kind: "commitRouting", subject: "gtd: tests green" },
    { kind: "runTest", errorCount: 0, capReached: false },
    { kind: "closePackage" },
    { kind: "writeSquashTemplate" },
    { kind: "squashCommit", squashBase: "abc1234" },
    { kind: "runHealthCheck", errorCount: 0, capReached: false, squashAfterGreen: false },
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
        subject: "gtd: package done",
        removeTodo: true,
        removeFeedback: true,
      }),
    ).toBe('commit routing as "gtd: package done" (removing TODO.md, FEEDBACK.md)')
  })

  it("runTest reports the 1-indexed attempt number", () => {
    expect(describeEdgeAction({ kind: "runTest", errorCount: 2, capReached: false })).toBe(
      "run the test suite (attempt 3)",
    )
  })

  it("runTest notes when the cap is reached", () => {
    expect(describeEdgeAction({ kind: "runTest", errorCount: 5, capReached: true })).toBe(
      "run the test suite (attempt 6, cap reached)",
    )
  })

  it("squashCommit names the squash base", () => {
    expect(describeEdgeAction({ kind: "squashCommit", squashBase: "deadbee" })).toBe(
      "squash the cycle onto deadbee",
    )
  })

  it("runHealthCheck reports attempt, cap, and squash-after-green together", () => {
    expect(
      describeEdgeAction({
        kind: "runHealthCheck",
        errorCount: 0,
        capReached: true,
        squashAfterGreen: true,
      }),
    ).toBe("run the health check (attempt 1, cap reached, squash after green)")
  })
})
