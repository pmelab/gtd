import { describe, expect, it } from "vitest"
import { formatCommitMessage, parseCommitMessage, parseSubject } from "./Trailers.js"

describe("the commit-message codec", () => {
  it("round-trips a step commit's subject and trailers", () => {
    const message = formatCommitMessage({
      actor: "judge",
      from: "health.judge",
      to: "health.escalate",
      step: { name: "health.judge", occurrence: 2 },
      cost: { cost: 1450, model: "smart" },
      judge: [{ id: "verdict", answer: "identical", p: 0.9 }],
    })
    expect(message.split("\n")[0]).toBe("gtd(judge): health.judge → health.escalate")
    const parsed = parseCommitMessage(message)
    expect(parsed.parsed).toEqual({ actor: "judge", from: "health.judge", to: "health.escalate" })
    expect(parsed.step).toEqual({ name: "health.judge", occurrence: 2 })
    expect(parsed.cost).toEqual([{ cost: 1450, model: "smart" }])
    expect(parsed.judge).toEqual([{ id: "verdict", answer: "identical", p: 0.9 }])
  })

  it("collapses a self-loop to the bare subject and keeps entry trailers", () => {
    const message = formatCommitMessage({
      actor: "human",
      to: "review-gate.check",
      reviewBase: "abc",
      vars: { reviewBase: "main=x" },
    })
    const parsed = parseCommitMessage(message)
    expect(parsed.subject).toBe("gtd(human): review-gate.check")
    expect(parsed.step).toBeUndefined()
    expect(parsed.reviewBase).toBe("abc")
    expect(parsed.vars).toEqual({ reviewBase: "main=x" })
  })

  it("round-trips the workflow trailer, written after Gtd-Step and before Gtd-Review-Base", () => {
    const message = formatCommitMessage({
      actor: "human",
      to: "fix-precheck",
      workflow: "fix",
      reviewBase: "abc",
    })
    expect(message).toBe(
      "gtd(human): fix-precheck\n\nGtd-Workflow: fix\nGtd-Review-Base: abc\nGtd-Format: 1",
    )
    expect(parseCommitMessage(message).workflow).toBe("fix")
    expect(parseCommitMessage("gtd(human): fix-precheck").workflow).toBeUndefined()
  })

  it("writes Gtd-Var trailers sorted by name, whatever the insertion order", () => {
    const one = formatCommitMessage({ actor: "human", to: "x", vars: { b: "2", a: "1", c: "" } })
    const two = formatCommitMessage({ actor: "human", to: "x", vars: { c: "", a: "1", b: "2" } })
    expect(one).toBe(two)
    expect(one).toBe("gtd(human): x\n\nGtd-Var: a=1\nGtd-Var: b=2\nGtd-Var: c=\nGtd-Format: 1")
    expect(parseCommitMessage(one).vars).toEqual({ a: "1", b: "2", c: "" })
  })

  it("writes Gtd-Format last on every message, even one with no other trailer", () => {
    const message = formatCommitMessage({ actor: "agent", to: "building" })
    expect(message).toBe("gtd(agent): building\n\nGtd-Format: 1")
    expect(parseCommitMessage(message).format).toBe(1)
  })

  it("reads a message without Gtd-Format as format 1, and an explicit one as written", () => {
    expect(parseCommitMessage("gtd(agent): a → b\n\nGtd-Step: a#1").format).toBe(1)
    expect(parseCommitMessage("gtd(agent): a → b\n\nGtd-Format: 2").format).toBe(2)
    expect(parseCommitMessage("gtd(agent): a → b\n\nGtd-Format: two").format).toBe(1)
  })

  it("skips a malformed trailer instead of failing", () => {
    const parsed = parseCommitMessage("gtd(judge): a → b\n\nGtd-Judge: {not json\nGtd-Step: nope")
    expect(parsed.judge).toEqual([])
    expect(parsed.step).toBeUndefined()
  })

  it("parses only gtd subjects", () => {
    expect(parseSubject("feat: add calculator")).toBeUndefined()
    expect(parseSubject("gtd(agent): fix")).toEqual({ actor: "agent", to: "fix" })
  })
})
