import { describe, expect, it } from "vitest"
import { selectPrompt, type TestResult } from "./State.js"
import { buildPrompt } from "./Prompt.js"
import type { GtdContext, LeafState, ResolveResult } from "./Machine.js"

const baseContext = (overrides: Partial<GtdContext> = {}): GtdContext => ({
  verifyIterations: 0,
  maxVerifyIterations: 5,
  lastCommitSubject: "chore: init",
  workingTreeClean: true,
  packages: [],
  diff: "",
  ...overrides,
})

const result = (value: LeafState, context: Partial<GtdContext> = {}): ResolveResult => ({
  value,
  context: baseContext(context),
  autoAdvance: false,
})

const test = (exitCode: number, output = ""): TestResult => ({ exitCode, output })

describe("selectPrompt", () => {
  it("green → renders the resolved leaf unchanged, no override", () => {
    const sel = selectPrompt(result("human-review"), test(0))
    expect(sel.override).toBeUndefined()
    expect(sel.result.value).toBe("human-review")
  })

  it("red, below cap → fix-tests override carrying the captured output", () => {
    const sel = selectPrompt(
      result("human-review", { verifyIterations: 2 }),
      test(1, "FAIL src/x.test.ts\nexpected 1 got 2"),
    )
    expect(sel.override).toEqual({
      kind: "fix-tests",
      testOutput: "FAIL src/x.test.ts\nexpected 1 got 2",
    })
    // The leaf is untouched so the normal context still renders.
    expect(sel.result.value).toBe("human-review")
  })

  it("red, at cap (verifyIterations >= maxVerifyIterations) → escalate, no override", () => {
    const sel = selectPrompt(
      result("human-review", { verifyIterations: 5, maxVerifyIterations: 5 }),
      test(1, "still failing"),
    )
    expect(sel.override).toBeUndefined()
    expect(sel.result.value).toBe("escalate")
    expect(sel.result.autoAdvance).toBe(false)
  })

  it("cap check is generic — honors a context-provided maxVerifyIterations", () => {
    const below = selectPrompt(
      result("execute", { verifyIterations: 2, maxVerifyIterations: 3 }),
      test(1, "boom"),
    )
    expect(below.override?.kind).toBe("fix-tests")

    const atCap = selectPrompt(
      result("execute", { verifyIterations: 3, maxVerifyIterations: 3 }),
      test(1, "boom"),
    )
    expect(atCap.result.value).toBe("escalate")
  })
})

// End-to-end: selectPrompt fed into the real buildPrompt renders the right
// section for each test-gate branch on the human-review leaf.
describe("test gate → buildPrompt integration", () => {
  const hr = (ctx: Partial<GtdContext> = {}): ResolveResult => ({
    value: "human-review",
    context: baseContext({ refDiff: "diff", baseRef: "abc", ...ctx }),
    autoAdvance: false,
  })

  it("green → REVIEW.md prompt, no fix-tests", () => {
    const sel = selectPrompt(hr(), test(0))
    const out = buildPrompt(sel.result, sel.override)
    expect(out).toContain("format REVIEW.md")
    expect(out).not.toContain("Test gate failed")
  })

  it("red below cap → fix-tests prompt embedding output, no REVIEW.md", () => {
    const sel = selectPrompt(hr({ verifyIterations: 2 }), test(1, "BOOM-OUTPUT"))
    const out = buildPrompt(sel.result, sel.override)
    expect(out).toContain("Test gate failed")
    expect(out).toContain("BOOM-OUTPUT")
    expect(out).not.toContain("format REVIEW.md")
  })

  it("red at cap → escalate prompt, no fix-tests", () => {
    const sel = selectPrompt(hr({ verifyIterations: 5 }), test(1, "BOOM"))
    const out = buildPrompt(sel.result, sel.override)
    expect(out).toContain("Escalate to the human")
    expect(out).not.toContain("Test gate failed")
  })
})
