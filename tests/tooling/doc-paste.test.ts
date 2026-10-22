import { describe, expect, it } from "vitest"
import { extractBashBlock } from "../integration/helpers/driver-doc.ts"

const fence = "```"

describe("extractBashBlock", () => {
  it("keeps a heading inside the fence as part of the paste", () => {
    const doc = [
      "## Worked example",
      "",
      `${fence}bash`,
      "cat >NOTE.md <<'EOF'",
      "## Open Questions",
      "EOF",
      fence,
      "",
      "## Next",
      "",
      `${fence}bash`,
      "echo other",
      fence,
    ].join("\n")
    expect(extractBashBlock(doc, "## Worked example")).toBe(
      "cat >NOTE.md <<'EOF'\n## Open Questions\nEOF",
    )
  })

  it("keeps a shorter fence inside a longer one as part of the paste", () => {
    const doc = `## A\n\n${fence}\`bash\necho\n${fence}\n## inner\n${fence}\`\n`
    expect(extractBashBlock(doc, "## A")).toBe(`echo\n${fence}\n## inner`)
  })

  it("refuses a section with two bash fences", () => {
    const doc = `## A\n\n${fence}bash\na\n${fence}\n\n${fence}bash\nb\n${fence}\n`
    expect(() => extractBashBlock(doc, "## A")).toThrow("found 2")
  })

  it("refuses a missing heading", () => {
    expect(() => extractBashBlock("## B\n", "## A")).toThrow('missing the "## A" heading')
  })
})
