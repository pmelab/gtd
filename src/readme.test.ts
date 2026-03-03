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
      /`gt plan`/,
      /GTD_AGENT_PLAN/,
      /GTD_AGENT_BUILD/,
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
    // All 6 active prefixes from CommitPrefix.ts must appear in the table
    expect(content).toContain("🤦")
    expect(content).toContain("🤖")
    expect(content).toContain("🔨")
    expect(content).toContain("🧹")
    expect(content).toContain("🌱")
    expect(content).toContain("👷")

    // Verify the commit prefixes table contains all active rows
    const tableSection = content.match(/### Commit Prefixes\n\n([\s\S]*?)(?=\n##|\n$)/)?.[1] ?? ""
    expect(tableSection).toContain("🌱")
    expect(tableSection).toContain("👷")
    expect(tableSection).toContain("🤦")
    expect(tableSection).toContain("🤖")
    expect(tableSection).toContain("🔨")
    expect(tableSection).toContain("🧹")

    // 💬 FEEDBACK is removed; the table must not contain it
    expect(tableSection).not.toContain("💬")
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
      /cleanup|🧹/i,
      /idle/i,
      /uncommitted/i,
    ]
    for (const concept of requiredConcepts) {
      expect(mermaid).toMatch(concept)
    }

    // 💬 FEEDBACK node is removed; 🤦 covers all human feedback
    expect(mermaid).not.toContain("💬")
    expect(mermaid).toMatch(/🤦.*human/i)
  })

  it("mermaid flowchart reflects the actual InferStep decision tree", () => {
    const content = readmeContent()
    const mermaidMatch = content.match(/```mermaid\n([\s\S]*?)```/)
    const mermaid = mermaidMatch![1]!

    // commit-feedback classifies into up to 4 separate commits
    expect(mermaid).toMatch(/🌱.*seed/i)
    expect(mermaid).toMatch(/🤦.*human/i)
    expect(mermaid).toMatch(/👷.*fix/i)

    // SEED routes to plan
    expect(mermaid).toMatch(/🌱.*Plan/i)

    // HUMAN routes through a "Previous phase?" decision node
    expect(mermaid).toMatch(/🤦.*HumanRoute/i)

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

  it("example configs validate against the JSON schema", () => {
    const content = readmeContent()
    const jsonBlocks = [...content.matchAll(/```jsonc?\n([\s\S]*?)```/g)]
    expect(jsonBlocks.length).toBeGreaterThan(0)

    const schema = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "schema.json"), "utf-8"),
    )
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
        const { $schema: _, ...rest } = parsed as Record<string, unknown>
        const valid = validate(rest)
        expect(valid, `Config block failed schema validation: ${JSON.stringify(validate.errors)}`).toBe(true)
      }
    }
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
    expect(feedbackSection).toMatch(/🌱.*🤦.*👷/)
  })

  it("step 3 workflow narrative reflects multi-prefix commit behavior", () => {
    const content = readmeContent()
    const step3Match = content.match(/### 3\. Review and give feedback\n([\s\S]*?)(?=\n### \d)/)
    expect(step3Match).not.toBeNull()
    const step3 = step3Match![1]!

    // Should mention classifying changes into separate commits by type
    expect(step3).toMatch(/classif|separate.*commit|different.*commit/i)

    // Should mention the commit types for feedback
    expect(step3).toMatch(/🤦/)
    expect(step3).toMatch(/👷/)

    // Should explain what each type maps to
    expect(step3).toMatch(/blockquote|TODO\.md/i)
    expect(step3).toMatch(/marker|🤦.*code|code.*🤦/i)
    expect(step3).toMatch(/plain.*code.*👷|👷.*plain|fix.*👷|👷.*fix/i)

    // Should NOT claim all feedback is a single 🤦 commit
    expect(step3).not.toMatch(/commits your feedback as `🤦`/)

    // 💬 must not appear as a produced prefix in this narrative
    expect(step3).not.toContain("💬")

    // 🤦 HUMAN must be mentioned (blockquote/TODO.md feedback uses 🤦 now)
    expect(step3).toMatch(/🤦.*HUMAN|🤦 human/i)

    // Re-dispatch still works the same
    expect(step3).toMatch(/re.dispatch|routes? accordingly|checks the last prefix/i)
  })

  it("documents the gtd init subcommand", () => {
    const content = readmeContent()
    expect(content).toMatch(/`gtd init`/)
    expect(content).toMatch(/`gtd init --global`/)
    expect(content).toMatch(/project.local|project.level|local.*config/i)
    expect(content).toMatch(/user.level|global.*config|user.*config/i)
  })

})
