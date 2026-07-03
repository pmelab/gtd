import { describe, expect, it } from "vitest"
import type { GtdState } from "./Machine.js"
import { EDGE_ONLY_STATES, isEdgeOnly } from "./State.js"

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
]

const EXPECTED_EDGE_ONLY: ReadonlyArray<GtdState> = [
  "transport",
  "new-feature",
  "testing",
  "await-review",
  "accept-review",
  "close-package",
  "done",
]

describe("edge-only state classification", () => {
  it("EDGE_ONLY_STATES is exactly the seven edge-only states", () => {
    expect([...EDGE_ONLY_STATES].sort()).toEqual([...EXPECTED_EDGE_ONLY].sort())
  })

  it("isEdgeOnly is true for every edge-only state", () => {
    for (const state of EXPECTED_EDGE_ONLY) {
      expect(isEdgeOnly(state)).toBe(true)
    }
  })

  it("isEdgeOnly is false for every prompt-bearing state", () => {
    const promptBearing = ALL_STATES.filter((s) => !EXPECTED_EDGE_ONLY.includes(s))
    // sanity: the ten remaining states are all prompt-bearing
    expect(promptBearing).toHaveLength(10)
    for (const state of promptBearing) {
      expect(isEdgeOnly(state)).toBe(false)
    }
  })
})
