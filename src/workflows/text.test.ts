import { describe, expect, it } from "vitest"
import { architectureAuthorPrompt, designTriagePrompt, summaryPrompt, withSkills } from "./text.js"
import { renderText } from "./text.fixture.js"

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
