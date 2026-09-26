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
      truncated: true,
    })
    expect(message.split("\n")[0]).toBe("gtd(judge): health.judge → health.escalate")
    const parsed = parseCommitMessage(message)
    expect(parsed.parsed).toEqual({ actor: "judge", from: "health.judge", to: "health.escalate" })
    expect(parsed.step).toEqual({ name: "health.judge", occurrence: 2 })
    expect(parsed.cost).toEqual([{ cost: 1450, model: "smart" }])
    expect(parsed.judge).toEqual([{ id: "verdict", answer: "identical", p: 0.9 }])
    expect(parsed.truncated).toBe(true)
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
