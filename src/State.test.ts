import { describe, expect, it } from "vitest"
import type { GtdState, ResolveContext } from "./Machine.js"
import { EDGE_ONLY_STATES, describeStatus, isEdgeOnly } from "./State.js"

// The driver's auto-advance-vs-prompt decision hinges entirely on this set: it
// must stay identical to `Prompt.ts`'s (private) `EDGE_ONLY_STATES`, i.e. the
// states `buildPrompt` refuses to render. A drift either crashes the driver
// (buildPrompt throws on an edge-only state) or spins the loop (a prompt-bearing
// state is treated as edge-only). These pure assertions pin it.

const ALL_STATES: ReadonlyArray<GtdState> = [
  "transport",
  "new-feature",
  "grilling",
  "grilled",
  "planning",
  "building",
  "testing",
  "fixing",
  "escalate",
  "agentic-review",
  "close-package",
  "clean",
  "await-review",
  "accept-review",
  "done",
  "idle",
  "squashing",
  "health-check",
  "health-fixing",
]

const EXPECTED_EDGE_ONLY: ReadonlyArray<GtdState> = [
  "transport",
  "new-feature",
  "testing",
  "await-review",
  "accept-review",
  "close-package",
  "done",
  "health-check",
]

describe("edge-only state classification", () => {
  it("EDGE_ONLY_STATES is exactly the eight edge-only states", () => {
    expect([...EDGE_ONLY_STATES].sort()).toEqual([...EXPECTED_EDGE_ONLY].sort())
  })

  it("isEdgeOnly is true for every edge-only state", () => {
    for (const state of EXPECTED_EDGE_ONLY) {
      expect(isEdgeOnly(state)).toBe(true)
    }
  })

  it("isEdgeOnly is false for every prompt-bearing state", () => {
    const promptBearing = ALL_STATES.filter((s) => !EXPECTED_EDGE_ONLY.includes(s))
    // sanity: the eleven remaining states are all prompt-bearing
    expect(promptBearing).toHaveLength(11)
    for (const state of promptBearing) {
      expect(isEdgeOnly(state)).toBe(false)
    }
  })
})

const minContext: ResolveContext = {
  testFixCount: 0,
  reviewFixCount: 0,
  packages: [],
  diff: "",
  lastCommitSubject: "",
  workingTreeClean: true,
  feedbackContent: "",
}

describe("describeStatus", () => {
  it("prompt-bearing result: state=building, no edgeAction", () => {
    const result = {
      state: "building" as GtdState,
      autoAdvance: false,
      context: minContext,
    }
    expect(describeStatus(result)).toEqual({
      state: "building",
      nextState: "building",
      willAutoAdvance: false,
      edgeActions: [],
    })
  })

  it("edge-only result: state=testing, runTest edgeAction", () => {
    const result = {
      state: "testing" as GtdState,
      autoAdvance: true,
      edgeAction: { kind: "runTest" as const, errorCount: 0, capReached: false },
      context: minContext,
    }
    const summary = describeStatus(result)
    expect(summary.nextState).toBeNull()
    expect(summary.willAutoAdvance).toBe(true)
    expect(summary.edgeActions[0]).toBe("run the test suite (attempt 1)")
  })

  it("commitPending with removeTodo=true", () => {
    const result = {
      state: "planning" as GtdState,
      autoAdvance: false,
      edgeAction: { kind: "commitPending" as const, prefix: "gtd: planning", removeTodo: true },
      context: minContext,
    }
    expect(describeStatus(result).edgeActions[0]).toBe(
      'commit pending changes as "gtd: planning" (removing TODO.md)',
    )
  })
})
