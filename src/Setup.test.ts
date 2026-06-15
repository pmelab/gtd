import { describe, expect, it } from "vitest"
import { buildSetupPrompt, REQUIRED_SKILLS } from "./Setup.js"

describe("buildSetupPrompt", () => {
  it("references skills.sh", () => {
    expect(buildSetupPrompt()).toContain("skills.sh")
  })

  it("includes every required skill URL as a bullet", () => {
    const out = buildSetupPrompt()
    for (const url of REQUIRED_SKILLS) expect(out).toContain(`- ${url}`)
  })

  it("tells the agent not to commit", () => {
    expect(buildSetupPrompt()).toMatch(/do .*not.*commit/i)
  })

  it("contains no git diff or state context", () => {
    const out = buildSetupPrompt()
    expect(out).not.toContain("```diff")
    expect(out).not.toContain("## Context")
  })
})
