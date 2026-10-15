import { describe, expect, it } from "vitest"
import { formatCommitMessage, formatFault, parseCommitMessage } from "./index.js"

describe("the history format", () => {
  it("accepts a history entirely in the current format", () => {
    expect(formatFault([{ hash: "a".repeat(40), format: 1 }])).toBeUndefined()
    expect(formatFault([])).toBeUndefined()
  })

  it("names the first foreign commit, the found and readable formats, and what to do", () => {
    const fault = formatFault([
      { hash: "a".repeat(40), format: 1 },
      { hash: "b".repeat(40), format: 2 },
      { hash: "c".repeat(40), format: 3 },
    ])
    expect(fault).toBe(
      "gtd: commit bbbbbbb is written in history format 2, but this gtd reads format 1 — run a gtd release that reads format 2 to continue this process",
    )
  })
})

describe("Gtd-Approved and the history format", () => {
  it("leaves Gtd-Format at 1 on a message carrying it", () => {
    const message = formatCommitMessage({
      actor: "human",
      to: "b",
      approved: { step: { name: "seam", occurrence: 1 }, name: "Test", email: "test@test.com" },
    })
    expect(message).toContain("Gtd-Approved: seam#1 Test <test@test.com>")
    expect(message).toContain("Gtd-Format: 1")
    expect(parseCommitMessage(message).format).toBe(1)
  })
})
