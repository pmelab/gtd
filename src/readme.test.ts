import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const readmeContent = () =>
  readFileSync(join(import.meta.dirname, "..", "README.md"), "utf-8")

describe("README.md", () => {
  it("contains no references to old subcommands", () => {
    const content = readmeContent()
    const oldSubcommands = [
      /`gtd plan`/,
      /`gtd build`/,
      /`gtd learn`/,
      /`gt plan`/,
      /GTD_AGENT_PLAN/,
      /GTD_AGENT_BUILD/,
      /GTD_AGENT_LEARN/,
    ]
    for (const pattern of oldSubcommands) {
      expect(content).not.toMatch(pattern)
    }
  })

  it("references the unified gtd command", () => {
    const content = readmeContent()
    expect(content).toContain("`gtd`")
  })

  it("includes emoji-prefixed commit convention", () => {
    const content = readmeContent()
    expect(content).toContain("🤦")
    expect(content).toContain("🤖")
    expect(content).toContain("🔨")
    expect(content).toContain("🎓")
    expect(content).toContain("🧹")
  })

  it("contains a valid mermaid flowchart", () => {
    const content = readmeContent()
    const mermaidMatch = content.match(/```mermaid\n([\s\S]*?)```/)
    expect(mermaidMatch).not.toBeNull()

    const mermaid = mermaidMatch![1]!
    expect(mermaid).toMatch(/^flowchart TD/m)

    // Validate basic structure: nodes and edges
    expect(mermaid).toMatch(/-->/)
    // Should have decision nodes (curly braces for diamond)
    expect(mermaid).toMatch(/\{.*\}/)
  })

  it("mermaid flowchart contains all lifecycle steps", () => {
    const content = readmeContent()
    const mermaidMatch = content.match(/```mermaid\n([\s\S]*?)```/)
    const mermaid = mermaidMatch![1]!

    const requiredConcepts = [
      /commit.?feedback|🤦/i,
      /plan|🤖/i,
      /build|🔨/i,
      /learn|🎓/i,
      /cleanup|🧹/i,
      /idle/i,
      /uncommitted/i,
    ]
    for (const concept of requiredConcepts) {
      expect(mermaid).toMatch(concept)
    }
  })

  it("has a How It Works section", () => {
    const content = readmeContent()
    expect(content).toContain("## How It Works")
  })
})
