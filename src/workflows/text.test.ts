import { describe, expect, it } from "vitest"
import {
  agentWithSkills,
  architectureAuthorPrompt,
  buildFixQualityPrompt,
  designTriagePrompt,
  splitSkills,
  summaryPrompt,
  withSkills,
} from "./text.js"
import { captureStep, renderText } from "./text.fixture.js"

describe("withSkills", () => {
  const prompted = (skills: string | undefined) =>
    renderText(() => withSkills(skills, "do-the-work"))

  it("puts the preamble, naming the skills, ahead of the prompt", () => {
    const prompt = prompted("code-review, testing")
    expect(prompt).toContain("missing one: code-review, testing")
    expect(prompt.endsWith("\n\ndo-the-work")).toBe(true)
  })

  it("leaves the prompt bare when there are no skills", () => {
    expect(prompted(undefined)).toBe("do-the-work")
    expect(prompted("  ")).toBe("do-the-work")
  })
})

describe("splitSkills", () => {
  it("splits on comma, trims each name, drops empty entries", () => {
    expect(splitSkills("a, b")).toEqual(["a", "b"])
    expect(splitSkills(" a ,, b ")).toEqual(["a", "b"])
  })

  it("returns [] for undefined, empty, or blank input", () => {
    expect(splitSkills(undefined)).toEqual([])
    expect(splitSkills("")).toEqual([])
    expect(splitSkills("   ")).toEqual([])
  })
})

describe("agentWithSkills", () => {
  const capture = (fn: () => Promise<void>) => captureStep(fn)

  it("produces a byte-identical preamble to withSkills for a comma-free name list", async () => {
    const skills = "code-review, testing"
    const viaHelper = await capture(() => agentWithSkills("name", skills, "do-the-work"))
    if (viaHelper.kind !== "agent") throw new Error("unreachable")
    expect(viaHelper.prompt).toBe(withSkills(skills, "do-the-work"))
  })

  it("passes the skills list, split, as the option, alongside the preamble", async () => {
    const request = await capture(() =>
      agentWithSkills("name", "code-review, testing", "do-the-work"),
    )
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.options.skills).toEqual(["code-review", "testing"])
  })

  it("leaves the prompt bare and the option an empty array when skills is undefined", async () => {
    const request = await capture(() => agentWithSkills("name", undefined, "do-the-work"))
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.prompt).toBe("do-the-work")
    expect(request.options.skills).toEqual([])
  })
})

describe("the shared open-question instruction", () => {
  it("leaves the option count to the agent, floored at two real options", () => {
    const prompt = renderText(() => designTriagePrompt("base"))
    expect(prompt).toContain("count of concrete options is your call")
    expect(prompt).toContain("at least two real options plus the")
    expect(prompt).not.toContain("plus a checkbox list: two")
  })

  it("requires a body between the heading and the option list", () => {
    const prompt = renderText(() => designTriagePrompt("base"))
    expect(prompt).toContain("followed by one or two lines of body naming the fork")
    expect(prompt).toContain("what actually differs, THEN the option list")
  })

  it("requires per-option impacts, free-form with no fixed count", () => {
    const prompt = renderText(() => designTriagePrompt("base"))
    expect(prompt).toContain("its own impacts nested under it")
    expect(prompt).toContain("one to four bullets, free-form")
    expect(prompt).toContain("labels, no fixed bullet count")
  })

  it("is the identical block, full text, in both the design gate and the architecture gate", () => {
    // Anchored at questionBar's own first and last lines (not a bullet
    // partway in) so the whole ~3.4k-char block is compared — a divergence
    // anywhere inside, including its opening bullets, fails this test the
    // moment either gate's copy drifts from the shared source.
    const start = "The goal is shared understanding, not a quota or an empty section"
    const end = "Never tick a box yourself — the human ticks exactly one per question"
    const sharedBlock = (prompt: string): string =>
      prompt.slice(prompt.indexOf(start), prompt.indexOf(end) + end.length)

    const designBlock = sharedBlock(renderText(() => designTriagePrompt("base")))
    const architectureBlock = sharedBlock(renderText(() => architectureAuthorPrompt()))

    expect(designBlock.length).toBeGreaterThan(3000)
    expect(designBlock).toBe(architectureBlock)
  })
})

describe("architectureAuthorPrompt", () => {
  it("qualifies the PERMISSIVE default with a settled-requirements exception", () => {
    const prompt = renderText(() => architectureAuthorPrompt())
    expect(prompt).toContain("is an open question, not a")
  })
})

describe("buildFixQualityPrompt", () => {
  it("states the missing-test-signal-beats-line-count tiebreak", () => {
    const prompt = renderText(() => buildFixQualityPrompt())
    expect(prompt).toContain("missing test signal beats line count")
    expect(prompt).toContain("a test is never deleted to satisfy a simplification finding")
  })
})

describe("summaryPrompt", () => {
  it("puts the total and every model's cost on a line of its own", () => {
    const prompt = summaryPrompt({
      entryCommit: "e",
      processBase: "b",
      processTip: "t",
      humanCommits: [],
      processCost: 12,
      processCostByModel: [
        { model: "smart", cost: 5 },
        { model: "base", cost: 7 },
      ],
      vars: {},
    })
    expect(prompt).toContain("Token cost: 12\n- smart: 5\n- base: 7\n\nPrint the closing message")
  })
})
