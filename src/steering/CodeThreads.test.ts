import { describe, expect, it } from "vitest"
import { parseCodeThreads, stripCodeThreads } from "./CodeThreads.js"

// Samples are built from string arrays: a template literal with a line-start
// `// H:` would be a live thread in this repo's own changed files.
const doc = (...lines: string[]): string => lines.join("\n")

describe("parseCodeThreads — tokens", () => {
  it.each([
    ["a.ts", "//"],
    ["a.py", "#"],
    ["a.sql", "--"],
    ["a.ini", ";"],
  ])("%s accepts %s", (path, token) => {
    const { threads } = parseCodeThreads(path, [token, "H: why?"].join(" "))
    expect(threads).toHaveLength(1)
  })

  it("recognises a token only in its own extensions", () => {
    expect(parseCodeThreads("a.ts", "# H: why?").threads).toEqual([])
    expect(parseCodeThreads("a.py", ["//", "H: why?"].join(" ")).threads).toEqual([])
    expect(parseCodeThreads("a.sql", "; H: why?").threads).toEqual([])
  })

  it("scans an unmapped file for all four tokens", () => {
    for (const token of ["//", "#", "--", ";"]) {
      expect(parseCodeThreads("Makefile", [token, "H: why?"].join(" ")).threads).toHaveLength(1)
    }
  })

  it("never scans markdown or .gtd files", () => {
    const text = doc(["//", "H: why?"].join(" "), "# H: why?")
    for (const path of ["a.md", "b.markdown", ".gtd/x.ts", ".gtd/sub/y.sh"]) {
      expect(parseCodeThreads(path, text)).toEqual({ threads: [], findings: [] })
    }
  })
})

describe("parseCodeThreads — runs", () => {
  it("returns 0-based lines, entries and waitingOn", () => {
    const text = doc("const x = 1", "  // H: why?", "  // A: because", "const y = 2")
    const [thread] = parseCodeThreads("a.ts", text).threads
    expect(thread).toMatchObject({ path: "a.ts", line: 1, endLine: 2, waitingOn: "human" })
    expect(thread!.entries.map((e) => [e.author, e.text, e.line])).toEqual([
      ["me", "why?", 1],
      ["agent", "because", 2],
    ])
  })

  it("is waiting on the agent when the last entry is H:", () => {
    expect(parseCodeThreads("a.ts", "// H: why?").threads[0]!.waitingOn).toBe("agent")
  })

  it("joins unprefixed lines onto the entry above", () => {
    const text = doc("// H: why", "// is this", "// so?", "// A: ok")
    const [thread] = parseCodeThreads("a.ts", text).threads
    expect(thread!.entries[0]!.text).toBe("why is this so?")
    expect(thread!.entries).toHaveLength(2)
  })

  it("ends at a non-comment line or a token switch", () => {
    const a = parseCodeThreads("Makefile", doc("# H: q", "code", "# A: orphan"))
    expect(a.threads).toHaveLength(2)
    expect(a.threads[0]!.entries).toHaveLength(1)
    const b = parseCodeThreads("Makefile", doc("# H: q", "-- A: other"))
    expect(b.threads[0]!.endLine).toBe(0)
    expect(b.threads[0]!.entries).toHaveLength(1)
  })

  it("treats a run not opening with a prefix as an ordinary comment", () => {
    const text = doc("// note", "// H: why?")
    expect(parseCodeThreads("a.ts", text)).toEqual({ threads: [], findings: [] })
  })

  it("ignores trailing and block comments", () => {
    const text = doc("foo() // H: why?", "/* H: why? */", "<!-- H: why? -->", " * H: why?")
    expect(parseCodeThreads("Makefile", text).threads).toEqual([])
  })
})

describe("parseCodeThreads — faults", () => {
  it("reports an agent opening", () => {
    const { findings } = parseCodeThreads("a.ts", "// A: hi")
    expect(findings[0]!.message).toBe(
      `Code thread at a.ts:1: the agent never starts a thread — the first entry must be "H:"`,
    )
  })

  it("reports the same author twice", () => {
    const { findings } = parseCodeThreads("a.ts", doc("// H: a", "// H: b"))
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ line: 1 })
    expect(findings[0]!.message).toMatch(/two consecutive "H:"/)
  })

  it("reports an empty entry", () => {
    const { findings } = parseCodeThreads("a.ts", "// H:")
    expect(findings[0]!.message).toMatch(/empty "H:" entry/)
  })

  it("reports nothing for a clean thread", () => {
    expect(parseCodeThreads("a.ts", doc("// H: a", "// A: b")).findings).toEqual([])
  })
})

describe("stripCodeThreads", () => {
  it("removes thread runs and keeps ordinary comments and code", () => {
    const text = doc("// note", "code()", "// H: why?", "// A: because", "more()", "// plain")
    expect(stripCodeThreads("a.ts", text)).toBe(doc("// note", "code()", "more()", "// plain"))
  })

  it("leaves unscanned paths alone", () => {
    expect(stripCodeThreads("a.md", "// H: x")).toBe("// H: x")
  })
})
