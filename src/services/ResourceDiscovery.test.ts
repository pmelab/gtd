import { describe, it, expect } from "vitest"
import { DefaultResourceLoader } from "@mariozechner/pi-coding-agent"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("PI resource discovery", () => {
  function makeTempProject() {
    const dir = mkdtempSync(join(tmpdir(), "pi-discovery-"))
    return dir
  }

  it("discovers skills from .pi/skills/", async () => {
    const cwd = makeTempProject()
    mkdirSync(join(cwd, ".pi/skills/greet"), { recursive: true })
    writeFileSync(join(cwd, ".pi/skills/greet/SKILL.md"), [
      "---",
      "name: greet",
      "description: Say hello",
      "---",
      "",
      "# Greet",
      "Always say hello first.",
    ].join("\n"))

    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: join(cwd, ".pi-agent-fake"),
      noExtensions: true,
    })
    await loader.reload()

    const { skills } = loader.getSkills()
    expect(skills).toHaveLength(1)
    expect(skills[0]!.name).toBe("greet")
    expect(skills[0]!.description).toBe("Say hello")
  })

  it("discovers AGENTS.md from project root", async () => {
    const cwd = makeTempProject()
    writeFileSync(join(cwd, "AGENTS.md"), "# Project Rules\n\n- always test first\n")

    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: join(cwd, ".pi-agent-fake"),
      noExtensions: true,
    })
    await loader.reload()

    const { agentsFiles } = loader.getAgentsFiles()
    expect(agentsFiles.length).toBeGreaterThanOrEqual(1)
    const match = agentsFiles.find(f => f.path.endsWith("AGENTS.md"))
    expect(match).toBeDefined()
    expect(match!.content).toContain("always test first")
  })

  it("discovers both skills and AGENTS.md together", async () => {
    const cwd = makeTempProject()
    mkdirSync(join(cwd, ".pi/skills/lint"), { recursive: true })
    writeFileSync(join(cwd, ".pi/skills/lint/SKILL.md"), [
      "---",
      "name: lint",
      "description: Run linter",
      "---",
      "",
      "Run eslint on all files.",
    ].join("\n"))
    writeFileSync(join(cwd, "AGENTS.md"), "# Guidelines\n\nuse strict mode\n")

    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: join(cwd, ".pi-agent-fake"),
      noExtensions: true,
    })
    await loader.reload()

    const { skills } = loader.getSkills()
    expect(skills.some(s => s.name === "lint")).toBe(true)

    const { agentsFiles } = loader.getAgentsFiles()
    expect(agentsFiles.some(f => f.content.includes("use strict mode"))).toBe(true)
  })
})
