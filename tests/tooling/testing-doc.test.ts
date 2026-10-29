import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { extractFiles } from "../integration/helpers/testing-doc.ts"

const fence = "```"
const root = new URL("../../", import.meta.url).pathname

describe("extractFiles", () => {
  it("names each fence by its first line and leaves the command out", () => {
    const doc = [
      "## Example",
      `${fence}ts`,
      "// a.ts",
      "export {}",
      fence,
      `${fence}gherkin`,
      "# b.feature",
      "Feature: b",
      fence,
      `${fence}bash`,
      "node --test",
      fence,
      "## Next",
      `${fence}ts`,
      "// c.ts",
      fence,
    ].join("\n")
    expect([...extractFiles(doc, "## Example")]).toEqual([
      ["a.ts", "// a.ts\nexport {}\n"],
      ["b.feature", "# b.feature\nFeature: b\n"],
    ])
  })

  it("refuses a section that names no file", () => {
    expect(() => extractFiles("## A\n\ntext\n", "## A")).toThrow("names no file")
  })
})

// The step wording is public API: docs/testing.md lists every step the gherkin
// subpath registers, and nothing else.
describe("docs/testing.md's step list", () => {
  it("is every step @pmelab/gtd/testkit/gherkin registers", () => {
    const source = readFileSync(`${root}src/gherkin/index.ts`, "utf8")
    const registered = [...source.matchAll(/^(?:Given|When|Then)\(\s*"([^"]+)"/gm)].map(
      (m) => m[1]!,
    )
    const doc = readFileSync(`${root}docs/testing.md`, "utf8")
    const steps = doc.slice(doc.indexOf("### Steps"))
    const documented = [...steps.matchAll(/^- `(.+)`$/gm)].map((m) => m[1]!)
    expect(documented.toSorted()).toEqual(registered.toSorted())
  })
})
