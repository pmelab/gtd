import { describe, expect, it } from "vitest"
import {
  formatCommitMessage,
  isRecordableApproval,
  parseCommitMessage,
  parseSubject,
} from "./Trailers.js"

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

  it("writes Gtd-Config trailers sorted by path, after Gtd-Var, and reads paths with spaces back", () => {
    const message = formatCommitMessage({
      actor: "human",
      to: "x",
      vars: { a: "1" },
      config: { "lib/my flow.ts": "0123456789abcdef", "gtd.config.ts": "deadbeefdeadbeef" },
    })
    expect(message).toBe(
      "gtd(human): x\n\nGtd-Var: a=1\nGtd-Config: deadbeefdeadbeef gtd.config.ts\nGtd-Config: 0123456789abcdef lib/my flow.ts\nGtd-Format: 1",
    )
    expect(parseCommitMessage(message).config).toEqual({
      "gtd.config.ts": "deadbeefdeadbeef",
      "lib/my flow.ts": "0123456789abcdef",
    })
  })

  it("round-trips a Gtd-Config path that git or the trailer syntax would alter", () => {
    const config = {
      " lead.ts": "0123456789abcdef",
      "trail.ts ": "0123456789abcdef",
      '"q.ts': "0123456789abcdef",
    }
    const message = formatCommitMessage({ actor: "human", to: "x", config })
    expect(message).toContain('Gtd-Config: 0123456789abcdef " lead.ts"')
    expect(parseCommitMessage(message).config).toEqual(config)
  })

  it("ignores a Gtd-Config trailer without a 16-digit hex hash, without a path, or with a control character in its path", () => {
    const read = (value: string) =>
      parseCommitMessage(`gtd(human): x\n\nGtd-Config: ${value}`).config
    expect(read("zzzzzzzzzzzzzzzz gtd.config.ts")).toEqual({})
    expect(read("deadbeef gtd.config.ts")).toEqual({})
    expect(read("deadbeefdeadbeef")).toEqual({})
    expect(read("deadbeefdeadbeef a\x1b]0;x\x07.ts")).toEqual({})
    expect(read('deadbeefdeadbeef "a\\u001b.ts"')).toEqual({})
  })

  it("round-trips Gtd-Branch and Gtd-Version, after Gtd-Judge and before Gtd-Format", () => {
    const message = formatCommitMessage({
      actor: "agent",
      to: "idle",
      judge: [{ id: "q1", answer: true, p: 0.9 }],
      branch: "feat/x",
      version: "1.2.3",
    })
    const lines = message.split("\n")
    const at = (prefix: string) => lines.findIndex((l) => l.startsWith(prefix))
    expect(at("Gtd-Judge:")).toBeLessThan(at("Gtd-Branch:"))
    expect(at("Gtd-Branch:")).toBeLessThan(at("Gtd-Version:"))
    expect(at("Gtd-Version:")).toBeLessThan(at("Gtd-Format:"))
    const parsed = parseCommitMessage(message)
    expect(parsed.branch).toBe("feat/x")
    expect(parsed.version).toBe("1.2.3")
  })

  it("omits Gtd-Branch and Gtd-Version when unset, and reads them as undefined", () => {
    const message = formatCommitMessage({ actor: "agent", to: "idle" })
    expect(message).not.toContain("Gtd-Branch")
    expect(message).not.toContain("Gtd-Version")
    const parsed = parseCommitMessage(message)
    expect(parsed.branch).toBeUndefined()
    expect(parsed.version).toBeUndefined()
  })

  it("keeps Gtd-Format at 1 when branch and version are written", () => {
    const message = formatCommitMessage({ actor: "a", to: "b", branch: "m", version: "1" })
    expect(message.endsWith("Gtd-Format: 1")).toBe(true)
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

describe("Gtd-Kept", () => {
  const hash = "0123456789abcdef0123456789abcdef01234567"

  it("parses a 40-hex hash", () => {
    expect(parseCommitMessage(`gtd(agent): a → b\n\nGtd-Step: a#1\nGtd-Kept: ${hash}`).kept).toBe(
      hash,
    )
  })

  it("parses a 64-hex (sha256) hash", () => {
    const sha256 = hash.repeat(2).slice(0, 64)
    expect(parseCommitMessage(`gtd(agent): a → b\n\nGtd-Kept: ${sha256}`).kept).toBe(sha256)
  })

  it("skips a non-hash value", () => {
    expect(parseCommitMessage("gtd(agent): a → b\n\nGtd-Kept: not-a-hash").kept).toBeUndefined()
    expect(parseCommitMessage(`gtd(agent): a → b\n\nGtd-Kept: ${hash}0`).kept).toBeUndefined()
  })

  it("reads undefined when absent, and leaves Gtd-Format at 1", () => {
    const parsed = parseCommitMessage(formatCommitMessage({ actor: "agent", to: "b" }))
    expect(parsed.kept).toBeUndefined()
    expect(parsed.format).toBe(1)
  })
})

describe("Gtd-Approved", () => {
  const approved = {
    step: { name: "seam", occurrence: 2 },
    name: "Ada Lovelace",
    email: "ada@x.io",
  }
  const line = (value: string) => `gtd(human): a → b\n\nGtd-Approved: ${value}`

  it("is written as one JSON line between Gtd-Judge and Gtd-Branch and round-trips", () => {
    const message = formatCommitMessage({
      actor: "human",
      to: "next",
      from: "seam",
      step: { name: "seam", occurrence: 2 },
      judge: [{ id: "v", answer: "yes", p: 1 }],
      branch: "feat",
      approved,
    })
    const lines = message.split("\n")
    const at = lines.indexOf(
      'Gtd-Approved: {"step":"seam#2","name":"Ada Lovelace","email":"ada@x.io"}',
    )
    expect(at).toBeGreaterThan(-1)
    expect(lines[at - 1]).toMatch(/^Gtd-Judge:/)
    expect(lines[at + 1]).toBe("Gtd-Branch: feat")
    expect(parseCommitMessage(message).approved).toEqual(approved)
  })

  it.each([
    ["a plain step", "seam"],
    ["a step with a space and hash", "phase#1 review"],
    ["a step with angle brackets", "a <b> c"],
    ["a scoped step", "pkg.seam"],
    ["a quote/backslash approver name", "seam", 'Ada "A" \\ L'],
  ])("round-trips %s", (_label, stepName, approver = "Ada") => {
    const a = { step: { name: stepName, occurrence: 3 }, name: approver, email: "a@x.io" }
    expect(
      parseCommitMessage(formatCommitMessage({ actor: "human", to: "b", approved: a })).approved,
    ).toEqual(a)
  })

  it("reads undefined for the old shape, non-objects and bad fields", () => {
    for (const value of [
      "seam#1 Ada <a@x.io>",
      "",
      "[]",
      '"x"',
      "null",
      '{"step":"seam#1","name":"Ada"}',
      '{"step":"seam#1","name":"Ada","email":1}',
      '{"step":"seam","name":"Ada","email":"a@x.io"}',
      '{"step":"seam#0","name":"Ada","email":"a@x.io"}',
    ]) {
      expect(parseCommitMessage(line(value)).approved).toBe(undefined)
    }
  })

  it("reads undefined for a control character in any field", () => {
    for (const json of [
      '{"step":"se\\u001bam#1","name":"Ada","email":"a@x.io"}',
      '{"step":"seam#1","name":"Ada\\u0007","email":"a@x.io"}',
      '{"step":"seam#1","name":"Ada","email":"a\\u0085@x.io"}',
    ]) {
      expect(parseCommitMessage(line(json)).approved).toBe(undefined)
    }
  })

  it("reads undefined when absent", () => {
    expect(parseCommitMessage(formatCommitMessage({ actor: "agent", to: "b" })).approved).toBe(
      undefined,
    )
  })
})

describe("isRecordableApproval", () => {
  const of = (name: string, email: string, occurrence = 1) => ({
    step: { name: "gate", occurrence },
    name,
    email,
  })

  it("accepts ordinary, quoted, backslashed and angle-bracketed identities", () => {
    for (const name of ["Ada", 'A "B"', "A\\B", "A <B>"]) {
      expect(isRecordableApproval(of(name, "a@x.io"))).toBe(true)
    }
    expect(isRecordableApproval(of("Ada", "a<b>@x.io"))).toBe(true)
  })

  it("refuses a C1 control character in name or email", () => {
    expect(isRecordableApproval(of("Ada\u0085", "a@x.io"))).toBe(false)
    expect(isRecordableApproval(of("Ada", "a\u0085@x.io"))).toBe(false)
  })

  it("refuses a JS line terminator that would split the trailer on read", () => {
    const name = "x\u2028Gtd-Branch: forged\u2028"
    expect(isRecordableApproval(of(name, "a@x.io"))).toBe(false)
    expect(isRecordableApproval(of("Ada", "a\u2029@x.io"))).toBe(false)
  })

  it("refuses an occurrence that does not read back", () => {
    expect(isRecordableApproval(of("Ada", "a@x.io", 0))).toBe(false)
  })
})
