import { describe, expect, it } from "vitest"
import type { Change } from "../flows/index.js"
import { filterChanges, packageDiff } from "./diff.js"

const change = (over: Partial<Change> & Pick<Change, "path" | "status">): Change => ({
  before: undefined,
  after: undefined,
  ...over,
})

// A cap high enough that nothing is ever dropped, for cases exercising the
// rendering pipeline rather than the byte-budget behavior itself.
const NO_CAP = 10_000

describe("packageDiff / rendering", () => {
  it("renders a normal edit as hunks with three lines of context", () => {
    const before = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n")
    const after = before.replace("line 5", "line five")
    const text = packageDiff([change({ path: "a.ts", status: "modified", before, after })], NO_CAP)
    expect(text).toContain("--- a/a.ts")
    expect(text).toContain("+++ b/a.ts")
    expect(text).toContain("-line 5")
    expect(text).toContain("+line five")
    // three lines of context on either side of the one changed line
    expect(text).toContain(" line 2")
    expect(text).toContain(" line 8")
    expect(text).not.toContain(" line 1\n")
  })

  it("degrades a 1500+ line change to its summary line", () => {
    const before = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join("\n")
    const after = Array.from({ length: 2000 }, (_, i) => `changed ${i}`).join("\n")
    const text = packageDiff(
      [change({ path: "big.ts", status: "modified", before, after })],
      NO_CAP,
    )
    expect(text).toBe("big.ts: +2000/-2000 lines, too large to inline")
  })

  it("renders files in path order for byte-identical output across replays", () => {
    const a = change({ path: "z.ts", status: "added", after: "z" })
    const b = change({ path: "a.ts", status: "added", after: "a" })
    expect(packageDiff([a, b], NO_CAP)).toBe(packageDiff([b, a], NO_CAP))
    expect(packageDiff([a, b], NO_CAP).indexOf("a.ts")).toBeLessThan(
      packageDiff([a, b], NO_CAP).indexOf("z.ts"),
    )
  })
})

describe("filterChanges / exclusion list", () => {
  it("excludes a lockfile change entirely", () => {
    const c = change({ path: "package-lock.json", status: "modified", before: "a", after: "b" })
    expect(filterChanges([c])).toEqual([])
    expect(packageDiff([c], NO_CAP)).toBe("")
  })

  it("excludes .gtd/** paths", () => {
    const c = change({ path: ".gtd/PLAN.md", status: "added", after: "x" })
    expect(filterChanges([c])).toEqual([])
  })

  it("excludes a binary file by extension", () => {
    const c = change({ path: "logo.png", status: "added", after: "binary-ish" })
    expect(filterChanges([c])).toEqual([])
  })

  it("excludes a binary file by content, separately from extension", () => {
    const c = change({ path: "weird.txt", status: "added", after: "abc\0def" })
    expect(filterChanges([c])).toEqual([])
  })

  it("keeps an ordinary source file", () => {
    const c = change({ path: "src/a.ts", status: "added", after: "export const a = 1\n" })
    expect(filterChanges([c])).toEqual([c])
  })
})

describe("packageDiff", () => {
  it("drops whole files from the end and names them in a trailer", () => {
    const a = change({ path: "a.ts", status: "added", after: "export const a = 1\n" })
    const b = change({
      path: "b.ts",
      status: "added",
      after: Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n"),
    })
    const text = packageDiff([a, b], 120)
    expect(text).toContain("--- /dev/null")
    expect(text).toContain("+++ b/a.ts")
    expect(text).not.toContain("b.ts\n")
    expect(text).toContain("1 file(s) omitted for the judge's byte budget: b.ts")
  })

  it("counts the omission trailer itself against the cap, so many dropped paths never push the total past it", () => {
    const kept = change({ path: "a.ts", status: "added", after: "export const a = 1\n" })
    const rest = Array.from({ length: 6 }, (_, i) =>
      change({ path: `f${i}.ts`, status: "added", after: "y" }),
    )
    // A naive cap check (size the kept text alone, append the trailer
    // afterwards) would keep a.ts plus two of the small files here — 150
    // bytes of text — then tack on an unbudgeted trailer for the other four,
    // landing well past capBytes. Budgeting the trailer itself must instead
    // drop enough files that the total, trailer included, stays at or under it.
    const capBytes = 150
    const text = packageDiff([kept, ...rest], capBytes)
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(capBytes)
    expect(text).toContain("omitted")
  })

  it("keeps every file when the cap is not exceeded", () => {
    const a = change({ path: "a.ts", status: "added", after: "x" })
    const text = packageDiff([a], 10_000)
    expect(text).not.toContain("omitted")
    expect(text).toContain("a.ts")
  })
})
