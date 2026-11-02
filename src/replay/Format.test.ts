import { describe, expect, it } from "vitest"
import { formatCommitMessage, formatFault, parseCommitMessage } from "./index.js"

describe("the history format", () => {
  it("accepts a history in the current format and in the one before it", () => {
    expect(formatFault([{ hash: "a".repeat(40), format: 4 }])).toBeUndefined()
    expect(
      formatFault([
        { hash: "a".repeat(40), format: 1 },
        { hash: "b".repeat(40), format: 2 },
        { hash: "c".repeat(40), format: 3 },
        { hash: "d".repeat(40), format: 4 },
      ]),
    ).toBeUndefined()
    expect(formatFault([])).toBeUndefined()
  })

  it("names the first foreign commit, the found and readable formats, and what to do", () => {
    const fault = formatFault([
      { hash: "a".repeat(40), format: 1 },
      { hash: "b".repeat(40), format: 5 },
      { hash: "c".repeat(40), format: 6 },
    ])
    expect(fault).toBe(
      "gtd: commit bbbbbbb is written in history format 5, but this gtd reads formats 1 to 4 — run a gtd release that reads format 5 to continue this process",
    )
  })
})

describe("Gtd-Approved and the history format", () => {
  it("writes the current format on a message carrying it", () => {
    const message = formatCommitMessage({
      actor: "human",
      to: "b",
      approved: { step: { name: "seam", occurrence: 1 }, name: "Test", email: "test@test.com" },
    })
    expect(message).toContain(
      'Gtd-Approved: {"step":"seam#1","name":"Test","email":"test@test.com"}',
    )
    expect(message).toContain("Gtd-Format: 4")
    expect(parseCommitMessage(message).format).toBe(4)
  })
})

describe("Gtd-Pin", () => {
  it("round-trips add and remove, after Gtd-Mark and before Gtd-Branch", () => {
    const message = formatCommitMessage({
      actor: "check",
      from: "gtd:unpin",
      to: "idle",
      pin: "remove",
      branch: "main",
    })
    expect(message).toBe(
      "gtd(check): gtd:unpin → idle\n\nGtd-Pin: remove\nGtd-Branch: main\nGtd-Format: 4",
    )
    expect(parseCommitMessage(message).pin).toBe("remove")
    expect(parseCommitMessage("gtd(check): gtd:pin → a\n\nGtd-Pin: add").pin).toBe("add")
  })

  it("reads an unknown value as no pin", () => {
    expect(parseCommitMessage("gtd(check): gtd:pin → a\n\nGtd-Pin: frozen").pin).toBeUndefined()
  })
})

describe("Gtd-Anchor", () => {
  it("round-trips after Gtd-Pin, and reads a non-hash value as no anchor", () => {
    const anchor = "a".repeat(40)
    const message = formatCommitMessage({
      actor: "check",
      from: "gtd:pin",
      to: "b",
      pin: "add",
      anchor,
    })
    expect(message).toBe(
      `gtd(check): gtd:pin → b\n\nGtd-Pin: add\nGtd-Anchor: ${anchor}\nGtd-Format: 4`,
    )
    expect(parseCommitMessage(message).anchor).toBe(anchor)
    expect(
      parseCommitMessage("gtd(check): gtd:pin → b\n\nGtd-Anchor: HEAD~2").anchor,
    ).toBeUndefined()
  })
})
