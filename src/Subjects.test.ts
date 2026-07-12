import { describe, expect, it } from "vitest"
import {
  ROUTING_SUBJECT,
  isWorkflowSubject,
  parseSubject,
  reviewingSubject,
  turnSubject,
} from "./Subjects.js"
import type { Actor, RoutingPhase, TurnGate } from "./Subjects.js"

describe("turn subject round-trip", () => {
  it("parses gtd(human): grilling back to a turn ParsedSubject", () => {
    expect(parseSubject(turnSubject("human", "grilling"))).toEqual({
      kind: "turn",
      actor: "human",
      gate: "grilling",
    })
  })

  const actors: ReadonlyArray<Actor> = ["human", "agent"]
  const gates: ReadonlyArray<TurnGate> = [
    "grilling",
    "architecting",
    "grilled",
    "building",
    "fixing",
    "agentic-review",
    "review",
    "squashing",
    "health-fixing",
    "escalate",
  ]

  it("round-trips every actor x gate combination", () => {
    for (const actor of actors) {
      for (const gate of gates) {
        expect(parseSubject(turnSubject(actor, gate))).toEqual({
          kind: "turn",
          actor,
          gate,
        })
      }
    }
  })

  it("treats an unknown gate label as a boundary commit", () => {
    expect(parseSubject("gtd(agent): dancing")).toEqual({ kind: "boundary" })
  })

  it("treats an unknown actor as a boundary commit", () => {
    expect(parseSubject("gtd(robot): grilling")).toEqual({ kind: "boundary" })
  })
})

describe("routing subjects", () => {
  it("parses every ROUTING_SUBJECT literal to its phase", () => {
    for (const [phase, subject] of Object.entries(ROUTING_SUBJECT) as ReadonlyArray<
      [Exclude<RoutingPhase, "reviewing">, string]
    >) {
      expect(parseSubject(subject)).toEqual({ kind: "routing", phase })
    }
  })

  it("round-trips reviewingSubject with the hash as param", () => {
    const hash = "a".repeat(40)
    expect(parseSubject(reviewingSubject(hash))).toEqual({
      kind: "routing",
      phase: "reviewing",
      param: hash,
    })
  })
})

describe("boundary commits", () => {
  it("treats non-gtd subjects as boundary", () => {
    expect(parseSubject("feat: whatever")).toEqual({ kind: "boundary" })
    expect(parseSubject("")).toEqual({ kind: "boundary" })
  })

  const legacyV1Subjects = [
    "gtd: new task",
    "gtd: grilling",
    "gtd: building",
    "gtd: fixing",
    "gtd: feedback",
    "gtd: transport",
    "gtd: reviewing",
  ]

  it.each(legacyV1Subjects)(
    "treats legacy v1 subject %s as boundary (inert, not error)",
    (subject) => {
      expect(parseSubject(subject)).toEqual({ kind: "boundary" })
    },
  )

  it("treats gtd: reviewing with a malformed (short) hash as boundary", () => {
    expect(parseSubject("gtd: reviewing abc123")).toEqual({ kind: "boundary" })
  })

  it("tolerates leading/trailing whitespace", () => {
    expect(parseSubject("  gtd: planning  ")).toEqual({ kind: "routing", phase: "planning" })
    expect(parseSubject(`  ${turnSubject("agent", "building")}  `)).toEqual({
      kind: "turn",
      actor: "agent",
      gate: "building",
    })
  })
})

describe("isWorkflowSubject", () => {
  it("is true for turn and routing subjects", () => {
    expect(isWorkflowSubject(turnSubject("human", "grilling"))).toBe(true)
    expect(isWorkflowSubject(ROUTING_SUBJECT.planning)).toBe(true)
    expect(isWorkflowSubject(reviewingSubject("a".repeat(40)))).toBe(true)
  })

  it("is false for boundary subjects", () => {
    expect(isWorkflowSubject("gtd: new task")).toBe(false)
    expect(isWorkflowSubject("feat: whatever")).toBe(false)
    expect(isWorkflowSubject("gtd: reviewing")).toBe(false)
  })
})
