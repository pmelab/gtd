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
    // All 8 prefixes from CommitPrefix.ts must appear in the table
    expect(content).toContain("🤦")
    expect(content).toContain("🤖")
    expect(content).toContain("🔨")
    expect(content).toContain("🎓")
    expect(content).toContain("🧹")
    expect(content).toContain("🌱")
    expect(content).toContain("💬")
    expect(content).toContain("👷")

    // Verify the commit prefixes table contains all 8 rows
    const tableSection = content.match(/### Commit Prefixes\n\n([\s\S]*?)(?=\n##|\n$)/)?.[1] ?? ""
    expect(tableSection).toContain("🌱")
    expect(tableSection).toContain("💬")
    expect(tableSection).toContain("👷")
    expect(tableSection).toContain("🤦")
    expect(tableSection).toContain("🤖")
    expect(tableSection).toContain("🔨")
    expect(tableSection).toContain("🎓")
    expect(tableSection).toContain("🧹")
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

  it("mermaid flowchart reflects the actual InferStep decision tree", () => {
    const content = readmeContent()
    const mermaidMatch = content.match(/```mermaid\n([\s\S]*?)```/)
    const mermaid = mermaidMatch![1]!

    // commit-feedback classifies into up to 4 separate commits
    expect(mermaid).toMatch(/🌱.*seed/i)
    expect(mermaid).toMatch(/💬.*feedback/i)
    expect(mermaid).toMatch(/🤦.*human/i)
    expect(mermaid).toMatch(/👷.*fix/i)

    // SEED, FEEDBACK, and HUMAN all route the same way (learnings only → learn, else → plan)
    expect(mermaid).toMatch(/🌱.*💬.*🤦/i)

    // FIX routes the same as BUILD (todoFileIsNew decision)
    expect(mermaid).toMatch(/🔨.*👷|👷.*🔨/i)

    // todoFileIsNew decision branch after BUILD/FIX
    expect(mermaid).toMatch(/todo.*new|new.*todo/i)

    // Default/unknown with todoFileIsNew → plan
    expect(mermaid).toMatch(/none.*unknown/i)
  })

  it("has a How It Works section", () => {
    const content = readmeContent()
    expect(content).toContain("## How It Works")
  })

  it("documents feedback marker prefixes for commit-feedback classification", () => {
    const content = readmeContent()
    const markers = ["TODO:", "FIX:", "FIXME:", "HACK:", "XXX:"]
    for (const marker of markers) {
      expect(content).toContain(marker)
    }
    expect(content).toMatch(/case.insensitive/i)
  })

  it("documents that TODO.md changes are always treated as feedback", () => {
    const content = readmeContent()
    expect(content).toMatch(/TODO\.md.*always.*feedback|all.*changes.*TODO\.md.*feedback/i)
  })

  it("has a Sandbox Runtime section explaining wrapper architecture", () => {
    const content = readmeContent()
    expect(content).toMatch(/## Sandbox Runtime|## Sandbox/i)
    expect(content).toMatch(/wrap/i)
    expect(content).toMatch(/provider/i)
  })

  it("documents the boundary levels with per-phase defaults", () => {
    const content = readmeContent()
    expect(content).toContain("restricted")
    expect(content).toContain("standard")
    expect(content).toContain("elevated")
    expect(content).toMatch(/plan.*restricted/i)
    expect(content).toMatch(/build.*standard/i)
    expect(content).toMatch(/learn.*restricted/i)
  })

  it("documents fail-stop behavior for permission violations", () => {
    const content = readmeContent()
    expect(content).toMatch(/fail.stop/i)
    expect(content).toMatch(/stop/i)
    expect(content).toMatch(/re.run/i)
  })

  it("clarifies forbidden tools and sandbox boundaries are orthogonal", () => {
    const content = readmeContent()
    expect(content).toMatch(/orthogonal|independent/i)
    expect(content).toMatch(/forbidden.*tool/i)
    expect(content).toMatch(/sandbox.*boundar|boundar.*sandbox/i)
  })

  it("notes forbidden tool blocklists are internal and not user-configurable", () => {
    const content = readmeContent()
    expect(content).toMatch(/internal|hardcoded|not.*user.configur|not.*configur.*user/i)
    expect(content).toMatch(/forbidden.*tool|tool.*blocklist/i)
  })

  it("includes example config with sandbox configuration", () => {
    const content = readmeContent()
    expect(content).toContain("sandboxEnabled")
    expect(content).toContain("sandboxBoundaries")
  })

  it("documents sandbox-on-by-default behavior", () => {
    const content = readmeContent()
    expect(content).toMatch(/sandbox.*enabled.*by default|enabled by default/i)
    expect(content).toMatch(/opt.out|sandboxEnabled.*false/i)
  })

  it("documents strict defaults: cwd-only filesystem and agent-essential-only network", () => {
    const content = readmeContent()
    expect(content).toMatch(/cwd|working directory/i)
    expect(content).toMatch(/agent.essential/i)
  })

  it("does not reference interactive approval prompts or escalation policies", () => {
    const content = readmeContent()
    expect(content).not.toMatch(/approval prompt/i)
    expect(content).not.toMatch(/escalation polic/i)
    expect(content).not.toMatch(/approved escalation/i)
    expect(content).not.toMatch(/prompting for escalation/i)
  })

  it("shows permission extension examples for npm registry, parent dir reads, and shared output", () => {
    const content = readmeContent()
    expect(content).toContain("registry.npmjs.org")
    expect(content).toMatch(/allowRead/i)
    expect(content).toMatch(/allowWrite/i)
  })

  it("mermaid diagram shows fail-stop flow with violation and error", () => {
    const content = readmeContent()
    const mermaidMatch = content.match(/```mermaid\n([\s\S]*?)```/)
    const mermaid = mermaidMatch![1]!
    expect(mermaid).toMatch(/violation|denied/i)
    expect(mermaid).toMatch(/error/i)
    expect(mermaid).toMatch(/config/i)
  })

  it("example configs validate against the JSON schema", () => {
    const content = readmeContent()
    const jsonBlocks = [...content.matchAll(/```jsonc?\n([\s\S]*?)```/g)]
    expect(jsonBlocks.length).toBeGreaterThan(0)

    const schema = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "schema.json"), "utf-8"),
    )
    const Ajv = require("ajv")
    const ajv = new Ajv({ strict: false })
    const validate = ajv.compile(schema)

    for (const [, block] of jsonBlocks) {
      const cleaned = block!
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/,(\s*[}\]])/g, "$1")
      let parsed: unknown
      try {
        parsed = JSON.parse(cleaned)
      } catch {
        continue
      }
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const { $schema, ...rest } = parsed as Record<string, unknown>
        const valid = validate(rest)
        expect(valid, `Config block failed schema validation: ${JSON.stringify(validate.errors)}`).toBe(true)
      }
    }
  })

  it("mermaid flowchart includes sandbox flow", () => {
    const content = readmeContent()
    const mermaidMatch = content.match(/```mermaid\n([\s\S]*?)```/)
    const mermaid = mermaidMatch![1]!
    expect(mermaid).toMatch(/sandbox/i)
  })

  it("documents the 4-way diff classification in the Feedback Classification section", () => {
    const content = readmeContent()
    const feedbackSection =
      content.match(/## Feedback Classification\n([\s\S]*?)(?=\n## [^#])/)?.[1] ?? ""

    expect(feedbackSection).toMatch(/seed/i)
    expect(feedbackSection).toMatch(/feedback/i)
    expect(feedbackSection).toMatch(/humanTodos|human.?todos/i)
    expect(feedbackSection).toMatch(/fix(es)?/i)

    expect(feedbackSection).toMatch(/new.*TODO\.md.*seed|seed.*new.*TODO\.md/i)
    expect(feedbackSection).toMatch(/existing.*TODO\.md.*feedback|feedback.*existing.*TODO\.md/i)
    expect(feedbackSection).toMatch(/marker.*human|human.*marker/i)
    expect(feedbackSection).toMatch(/plain.*code.*fix|fix.*plain.*code|without.*marker.*fix/i)
  })

  it("documents multi-commit behavior when multiple categories are present", () => {
    const content = readmeContent()
    const feedbackSection =
      content.match(/## Feedback Classification\n([\s\S]*?)(?=\n## [^#])/)?.[1] ?? ""

    expect(feedbackSection).toMatch(/multiple.*categor|each.*own.*commit|separate.*commit/i)
    expect(feedbackSection).toMatch(/stageByPatch|staged.*patch|patch/i)
  })

  it("documents blockquote detection in TODO.md", () => {
    const content = readmeContent()
    const feedbackSection =
      content.match(/## Feedback Classification\n([\s\S]*?)(?=\n## [^#])/)?.[1] ?? ""

    expect(feedbackSection).toMatch(/blockquote/i)
    expect(feedbackSection).toMatch(/`>\s*`|>\s*lines|blockquote.*addition/i)
  })

  it("documents prefix classification priority order", () => {
    const content = readmeContent()
    const feedbackSection =
      content.match(/## Feedback Classification\n([\s\S]*?)(?=\n## [^#])/)?.[1] ?? ""

    expect(feedbackSection).toMatch(/priority/i)
    expect(feedbackSection).toMatch(/🌱.*💬.*🤦.*👷/)
  })

  it("section 5 Learn describes manual step between build completion and learn", () => {
    const content = readmeContent()
    const learnMatch = content.match(/### 5\. Learn\n([\s\S]*?)(?=\n### \d|$)/)
    expect(learnMatch).not.toBeNull()
    const learnSection = learnMatch![1]!

    // Should mention that gtd stops after build
    expect(learnSection).toMatch(/stops|exit|finish|complet/i)

    // Should mention that user runs gtd again to trigger learn
    expect(learnSection).toMatch(/run.*`gtd`.*again|re-run|run\s+`gtd`/i)

    // Should NOT imply learn starts automatically after build
    expect(learnSection).not.toMatch(
      /automatically.*enter.*learn|auto.*learn phase/i,
    )
  })
})
