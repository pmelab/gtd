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
    "learning",
    "learning-apply",
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

describe("machine-label subjects", () => {
  it("parses every ROUTING_SUBJECT literal to its phase", () => {
    for (const [phase, subject] of Object.entries(ROUTING_SUBJECT) as ReadonlyArray<
      [Exclude<RoutingPhase, "review">, string]
    >) {
      expect(parseSubject(subject)).toEqual({ kind: "routing", phase })
    }
  })

  it("round-trips the review anchor with the hash as param", () => {
    const hash = "a".repeat(40)
    expect(parseSubject(reviewingSubject(hash))).toEqual({
      kind: "routing",
      phase: "review",
      param: hash,
    })
  })
})

describe("boundary commits", () => {
  it("treats non-gtd subjects as boundary", () => {
    expect(parseSubject("feat: whatever")).toEqual({ kind: "boundary" })
    expect(parseSubject("")).toEqual({ kind: "boundary" })
  })

  // v1 taxonomy subjects that do NOT collide with the label grammar stay
  // inert. (`gtd: grilling` / `gtd: building` DO collide — see the label
  // round-trip above and docs/upgrading-from-v1.md: a mid-cycle v1 HEAD
  // carrying one of those now parses as a live label, so upgrade at a
  // settled boundary.)
  const legacyV1Subjects = [
    "gtd: new task",
    "gtd: fixing",
    "gtd: feedback",
    "gtd: transport",
    "gtd: review",
  ]

  it.each(legacyV1Subjects)(
    "treats legacy v1 subject %s as boundary (inert, not error)",
    (subject) => {
      expect(parseSubject(subject)).toEqual({ kind: "boundary" })
    },
  )

  // The pre-label v2 routing subjects fall outside the label grammar the same
  // way v1 subjects fell outside v2's — old histories parse as inert
  // boundary commits rather than errors.
  const legacyV2RoutingSubjects = [
    "gtd: planning",
    "gtd: tests green",
    "gtd: errors",
    "gtd: package done",
    "gtd: awaiting review",
    "gtd: review feedback",
    "gtd: squash template",
    `gtd: reviewing ${"a".repeat(40)}`,
    "gtd: health-fix",
    "gtd: learning template",
    "gtd: learning drafted",
    "gtd: learning approved",
    "gtd: learning applied",
  ]

  it.each(legacyV2RoutingSubjects)(
    "treats pre-label v2 subject %s as boundary (inert, not error)",
    (subject) => {
      expect(parseSubject(subject)).toEqual({ kind: "boundary" })
    },
  )

  it("treats gtd: review with a malformed (short) hash as boundary", () => {
    expect(parseSubject("gtd: review abc123")).toEqual({ kind: "boundary" })
  })

  it("tolerates leading/trailing whitespace", () => {
    expect(parseSubject("  gtd: building  ")).toEqual({ kind: "routing", phase: "building" })
    expect(parseSubject(`  ${turnSubject("agent", "building")}  `)).toEqual({
      kind: "turn",
      actor: "agent",
      gate: "building",
    })
  })
})

describe("isWorkflowSubject", () => {
  it("is true for turn and machine-label subjects", () => {
    expect(isWorkflowSubject(turnSubject("human", "grilling"))).toBe(true)
    expect(isWorkflowSubject(ROUTING_SUBJECT.building)).toBe(true)
    expect(isWorkflowSubject(reviewingSubject("a".repeat(40)))).toBe(true)
  })

  it("is false for boundary subjects", () => {
    expect(isWorkflowSubject("gtd: new task")).toBe(false)
    expect(isWorkflowSubject("feat: whatever")).toBe(false)
    expect(isWorkflowSubject("gtd: review")).toBe(false)
  })
})
