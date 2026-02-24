import { describe, it, expect } from "vitest"
import { formatMarkdown } from "./MarkdownFormat.js"
import { resolve } from "node:path"

const filePath = resolve(process.cwd(), "TODO.md")

describe("formatMarkdown", () => {
  it("formats using project .prettierrc settings", async () => {
    const input = "# Title\n\nSome    text   here\n"
    const result = await formatMarkdown(input, filePath)
    expect(result).toBe("# Title\n\nSome text here\n")
  })

  it("preserves task list checkboxes", async () => {
    const input = "- [x] done task\n- [ ] pending task\n"
    const result = await formatMarkdown(input, filePath)
    expect(result).toContain("- [x] done task")
    expect(result).toContain("- [ ] pending task")
  })

  it("wraps prose at 80 chars (markdown override)", async () => {
    const longLine = "word ".repeat(30).trim()
    const input = `# Title\n\n${longLine}\n`
    const result = await formatMarkdown(input, filePath)
    const lines = result.split("\n").filter((l) => l.length > 0 && !l.startsWith("#"))
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(80)
    }
  })

  it("is idempotent", async () => {
    const input = "# Title\n\n- [ ] task one\n- [x] task two\n\nSome paragraph text.\n"
    const first = await formatMarkdown(input, filePath)
    const second = await formatMarkdown(first, filePath)
    expect(second).toBe(first)
  })

  it("handles empty input", async () => {
    const result = await formatMarkdown("", filePath)
    expect(result).toBe("")
  })
})
