import { describe, expect, it } from "vitest"
import type { Change } from "../../flows/index.js"
import { testEvidence } from "./coverage.js"

const modified = (path: string, before: string, after: string): Change => ({
  path,
  status: "modified",
  before,
  after,
})

const lines = (n: number, line: (i: number) => string): string =>
  Array.from({ length: n }, (_, i) => line(i)).join("\n")

describe("testEvidence", () => {
  it("sends the changed hunk, not the whole file", () => {
    const before = lines(40, (i) => `line ${i}`)
    const after = before.replace("line 20", 'line 20\nit("[AC-1] subtracts")')
    const evidence = testEvidence([modified("a.test.ts", before, after)], ["AC-1"])
    expect(evidence).toContain('it("[AC-1] subtracts")')
    expect(evidence).toContain("line 18")
    expect(evidence).not.toContain("line 17")
    expect(evidence).not.toContain("line 30")
  })

  it("keeps the slice's tagged tests last, after fixtures with decoy tags", () => {
    const fixture = (i: number): Change => {
      const before = lines(30, (k) => `  - [AC-1] decoy fixture ${i}.${k}`)
      return modified(`f${i}.test.ts`, before, `${before}\n## Impact ${i}`)
    }
    const real: Change = {
      path: "calc.test.ts",
      status: "added",
      before: undefined,
      after: 'it("[AC-1] subtracts", () => expect(subtract(3, 1)).toBe(2))',
    }
    const evidence = testEvidence(
      [real, ...Array.from({ length: 50 }, (_, i) => fixture(i))],
      ["AC-1"],
    )
    expect(evidence.endsWith('it("[AC-1] subtracts", () => expect(subtract(3, 1)).toBe(2))')).toBe(
      true,
    )
  })

  it("ranks a tag outside this slice's IDs like no tag", () => {
    const other: Change = {
      path: "b.test.ts",
      status: "added",
      before: undefined,
      after: "[AC-10] b",
    }
    const own: Change = { path: "a.test.ts", status: "added", before: undefined, after: "[AC-1] a" }
    expect(testEvidence([own, other], ["AC-1"]).endsWith("[AC-1] a")).toBe(true)
  })

  it("names the test above a changed body", () => {
    const before = ['it("[AC-2] adds", () => {', "  a()", "  b()", "  c()", "  d()", "})"].join(
      "\n",
    )
    const after = before.replace("d()", "e()")
    const evidence = testEvidence([modified("a.test.ts", before, after)], ["AC-2"])
    expect(evidence).toContain('it("[AC-2] adds"')
  })

  it("leaves out a deleted file", () => {
    const gone: Change = {
      path: "a.test.ts",
      status: "deleted",
      before: "[AC-1]",
      after: undefined,
    }
    expect(testEvidence([gone], ["AC-1"])).toBe("")
  })
})
