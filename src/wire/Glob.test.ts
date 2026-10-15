import { describe, expect, it } from "vitest"
import { globMatches } from "./Glob.js"

describe("globMatches", () => {
  it("`*` stays within one segment; `**` crosses segments, zero included", () => {
    expect(globMatches("a.md", "*.md")).toBe(true)
    expect(globMatches("docs/a.md", "*.md")).toBe(false)
    expect(globMatches("src/x/y/a.ts", "src/**")).toBe(true)
    expect(globMatches("a.ts", "**/a.ts")).toBe(true)
    expect(globMatches("x/a.ts", "**/a.ts")).toBe(true)
  })

  it("dotfiles match `*` and `**` like any other path", () => {
    expect(globMatches(".env", "*")).toBe(true)
    expect(globMatches("dir/.hidden", "dir/*")).toBe(true)
    expect(globMatches(".github/ci.yml", "**")).toBe(true)
    expect(globMatches(".github/ci.yml", "*")).toBe(false)
  })

  it("matches case-sensitively", () => {
    expect(globMatches("README.md", "readme.md")).toBe(false)
  })

  it("`?` and `[` are literal", () => {
    expect(globMatches("a?.txt", "a?.txt")).toBe(true)
    expect(globMatches("ab.txt", "a?.txt")).toBe(false)
    expect(globMatches("[a].txt", "[a].txt")).toBe(true)
    expect(globMatches("a.txt", "[a].txt")).toBe(false)
  })

  it("`**` crosses a path containing a line break", () => {
    expect(globMatches("weird\nname.txt", "**")).toBe(true)
    expect(globMatches("d/a\nb", "d/**")).toBe(true)
  })
})
