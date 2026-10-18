import { afterEach, describe, expect, it } from "vitest"
import { installContext, type Change, type Changes, type StepRequest } from "../../flows/index.js"
import { declaredTests, packages, requireDeclaredTests } from "./packages.js"
import { fixtureContext } from "../shared/text.fixture.js"

afterEach(() => installContext(undefined))

describe("declaredTests", () => {
  it("parses unit and e2e lines of the Tests section", () => {
    const text = [
      "# Package",
      "",
      "## Tests",
      "",
      "- unit: `lib/a.test.ts`",
      "- e2e: `spec/a.feature`",
    ].join("\n")
    expect(declaredTests(text)).toEqual([
      { level: "unit", path: "lib/a.test.ts", unchanged: false },
      { level: "e2e", path: "spec/a.feature", unchanged: false },
    ])
  })

  it("ignores prose, malformed lines and other sections", () => {
    const text = [
      "## Tasks",
      "- unit: `lib/not-here.test.ts`",
      "## Tests",
      "Some prose.",
      "- unit: lib/unquoted.test.ts",
      "- integration: `lib/x.test.ts`",
      "- unit: `lib/ok.test.ts` extra",
      "## Notes",
      "- e2e: `spec/other.feature`",
    ].join("\n")
    expect(declaredTests(text)).toEqual([
      { level: "unit", path: "lib/ok.test.ts", unchanged: false },
    ])
  })

  it("marks a whitespace-led, case-insensitive `(unchanged)` ending at a boundary", () => {
    const text = [
      "## Tests",
      "- unit: `a.test.ts` (unchanged)",
      "- unit: `b.test.ts` extra",
      "- unit: `c.test.ts` (unchanged)x",
      "- unit: `f.test.ts` (unchanged) — kept as is",
      "- unit: `d.test.ts` (Unchanged)",
      "- e2e: `e.feature` (unchanged)",
      "- unit: `g.test.ts`\t(unchanged)",
      "- unit: `h.test.ts`   (unchanged)",
      "- unit: `i.test.ts`(unchanged)",
      "- Unit: `j.test.ts` (unchanged)",
    ].join("\n")
    expect(declaredTests(text).map((t) => [t.path, t.unchanged])).toEqual([
      ["a.test.ts", true],
      ["b.test.ts", false],
      ["c.test.ts", false],
      ["f.test.ts", true],
      ["d.test.ts", true],
      ["e.feature", true],
      ["g.test.ts", true],
      ["h.test.ts", true],
      ["i.test.ts", false],
    ])
  })

  it("never joins a marker across an empty or whitespace-only line", () => {
    for (const gap of ["\n\n", "\n  \n", "\n\t\n"]) {
      const text = `## Tests\n- unit: \`a.test.ts\`${gap}  (unchanged)\n`
      expect(declaredTests(text).map((t) => t.unchanged)).toEqual([false])
    }
  })

  it("reads an entry whose path or marker is wrapped, in any line-end style", () => {
    const forms = [
      "- unit: `a/long.test.ts` (unchanged)",
      "- unit:\n  `a/long.test.ts` (unchanged)",
      "- unit: `a/long.test.ts`\n  (unchanged)",
      "- unit:\n  `a/long.test.ts`\n  (unchanged)",
    ]
    for (const form of forms) {
      const lf = `## Tests\n${form}\n- e2e: \`b.feature\`\n`
      const want = [
        { level: "unit", path: "a/long.test.ts", unchanged: true },
        { level: "e2e", path: "b.feature", unchanged: false },
      ]
      expect(declaredTests(lf)).toEqual(want)
      expect(declaredTests(lf.replace(/\n/g, "\r\n"))).toEqual(want)
      expect(declaredTests(lf.replace(/\n/g, "\r"))).toEqual(want)
    }
  })

  it("keeps the heading and its entries when an indented marker follows `## Tests`", () => {
    const text = "## Tests\n  (unchanged)\n- unit: `a.test.ts`\n"
    expect(declaredTests(text)).toEqual([{ level: "unit", path: "a.test.ts", unchanged: false }])
  })

  it("never extends an entry across a new item or a heading", () => {
    const text = [
      "## Tests",
      "- unit: `a.test.ts`",
      "  - unit: `b.test.ts` (unchanged)",
      "- unit: `c.test.ts`",
      "## Tests",
      "  (unchanged)",
    ].join("\n")
    expect(declaredTests(text).map((t) => [t.path, t.unchanged])).toEqual([
      ["a.test.ts", false],
      ["b.test.ts", true],
      ["c.test.ts", false],
    ])
  })

  it("closes an entry on an unindented line", () => {
    const text = "## Tests\n- unit: `a.test.ts`\n(unchanged)\n"
    expect(declaredTests(text).map((t) => t.unchanged)).toEqual([false])
  })

  it("returns nothing without a Tests section", () => {
    expect(declaredTests("# Chore\n\n## Tasks\n- do it\n")).toEqual([])
  })
})

describe("packages", () => {
  it("closes every queued package in name order, the plan with the last", async () => {
    const queue = [".gtd/packages/02-b.md", ".gtd/packages/01-a.md"]
    const closings: string[] = []
    installContext(
      fixtureContext(
        {},
        {
          step: (request: StepRequest) => {
            if (request.kind === "run" && request.name === "closing") {
              closings.push(request.body)
              queue.splice(queue.indexOf([...queue].sort()[0]!), 1)
            }
            return Promise.resolve()
          },
          pushScope: () => undefined,
          popScope: () => undefined,
          glob: () => [...queue],
          changesSince: (): readonly Change[] => [],
          head: () => "c",
        },
      ),
    )
    await packages()
    expect(closings).toHaveLength(2)
    expect(closings[0]).toContain("01-a.md")
    expect(closings[0]).not.toContain("ARCHITECTURE")
    expect(closings[1]).toContain("02-b.md")
    expect(closings[1]).toContain(".gtd/ARCHITECTURE.md")
  })
})

describe("requireDeclaredTests", () => {
  const run = (
    text: string,
    tree: readonly string[],
    changes: readonly Change[],
    satisfied = false,
    turn: "build" | "fix" | "default" = "build",
  ) => {
    const pkg = ".gtd/packages/01-a.md"
    installContext(
      fixtureContext(
        {},
        {
          read: (path: string) =>
            path === pkg
              ? text
              : path === ".gtd/SATISFIED.md"
                ? satisfied
                  ? "x"
                  : undefined
                : tree.includes(path)
                  ? "x"
                  : undefined,
          refuse: (message: string): never => {
            throw new Error(message)
          },
          changesSince: (): Changes => {
            const list: Change[] = [
              { path: pkg, status: "modified", before: text, after: text },
              ...changes,
            ]
            return Object.assign(list, {
              paths: list.map((c) => c.path),
              get: (path: string) => list.find((c) => c.path === path),
            })
          },
        },
      ),
    )
    let message = ""
    try {
      if (turn === "default") requireDeclaredTests(pkg, "c")
      else requireDeclaredTests(pkg, "c", turn)
    } catch (error) {
      message = String(error instanceof Error ? error.message : error)
    }
    return { message }
  }
  const deleted = (path: string): Change => ({
    path,
    status: "deleted",
    before: "x",
    after: undefined,
  })

  it("groups an unwritten unmarked test and a missing marked test in one refusal", () => {
    const text = [
      "## Tests",
      "- unit: `lib/unwritten.test.ts`",
      "- unit: `lib/gone.test.ts` (unchanged)",
      "- unit: `lib/kept.test.ts` (unchanged)",
    ].join("\n")
    const { message } = run(text, ["lib/kept.test.ts"], [])
    expect(message).toContain("gtd land: declared-tests:")
    expect(message).not.toMatch(/satisf/i)
    const diffAt = message.indexOf("not in the package's diff")
    const treeAt = message.indexOf("missing from the tree")
    expect(diffAt).toBeGreaterThanOrEqual(0)
    expect(treeAt).toBeGreaterThan(diffAt)
    expect(message.indexOf("  - lib/unwritten.test.ts")).toBeGreaterThan(diffAt)
    expect(message.indexOf("  - lib/unwritten.test.ts")).toBeLessThan(treeAt)
    expect(message.indexOf("  - lib/gone.test.ts")).toBeGreaterThan(treeAt)
    expect(message).not.toContain("kept.test.ts")
  })

  it("sends a marked deleted test to restore only", () => {
    const { message } = run("## Tests\n- unit: `a.test.ts` (unchanged)", [], [deleted("a.test.ts")])
    expect(message).toContain("declares tests this turn left unmet:")
    expect(message).toContain("marked (unchanged) but deleted — restore them:\n  - a.test.ts")
    expect(message).not.toContain("missing from the tree")
    expect(message).not.toContain("write them")
  })

  it("keeps a marked absent test with no diff change under missing", () => {
    const { message } = run("## Tests\n- unit: `a.test.ts` (unchanged)", [], [])
    expect(message).toContain("missing from the tree:\n  - a.test.ts")
    expect(message).not.toContain("restore")
  })

  it("keeps an unmarked deleted test under write, or missing once satisfied", () => {
    const text = "## Tests\n- unit: `a.test.ts`"
    expect(run(text, [], [deleted("a.test.ts")]).message).toContain(
      "not in the package's diff — write them:\n  - a.test.ts",
    )
    const done = run(text, [], [deleted("a.test.ts")], true).message
    expect(done).toContain("missing from the tree:\n  - a.test.ts")
    expect(done).not.toContain("restore")
  })

  const modified = (path: string): Change => ({
    path,
    status: "modified",
    before: "x",
    after: "y",
  })

  it("refuses a marked test the build modified, even with SATISFIED.md", () => {
    const text = "## Tests\n- unit: `a.test.ts` (unchanged)"
    for (const satisfied of [false, true]) {
      const { message } = run(text, ["a.test.ts"], [modified("a.test.ts")], satisfied)
      expect(message).toContain("marked (unchanged) but modified — revert them:\n  - a.test.ts")
    }
  })

  it("lets a fix turn modify a marked test but not delete it", () => {
    const text = "## Tests\n- unit: `a.test.ts` (unchanged)\n- unit: `b.test.ts` (unchanged)"
    expect(run(text, ["a.test.ts"], [modified("a.test.ts")], false, "fix").message).toContain(
      "missing from the tree:\n  - b.test.ts",
    )
    expect(run(text, ["a.test.ts"], [modified("a.test.ts")], false, "fix").message).not.toContain(
      "revert",
    )
    const gone = run(text, [], [deleted("a.test.ts"), deleted("b.test.ts")], false, "fix").message
    expect(gone).toContain("restore them:\n  - a.test.ts\n  - b.test.ts")
    const clean = "## Tests\n- unit: `a.test.ts` (unchanged)"
    expect(run(clean, ["a.test.ts"], [modified("a.test.ts")], false, "fix").message).toBe("")
  })

  it("lets an unmarked entry for the same file win over a marked one", () => {
    const text = "## Tests\n- e2e: `x.feature`\n- e2e: `x.feature` (unchanged)"
    expect(run(text, ["x.feature"], [modified("x.feature")]).message).toBe("")
  })

  const added = (path: string): Change => ({
    path,
    status: "added",
    before: undefined,
    after: "x",
  })
  const addedGroup =
    "marked (unchanged) but added by this turn — the marker promises an existing test; stop and leave it to a person"

  it("refuses a marked test the build added, as added and never as modified", () => {
    const { message } = run(
      "## Tests\n- unit: `a.test.ts` (unchanged)",
      ["a.test.ts"],
      [added("a.test.ts")],
    )
    expect(message).toContain(`${addedGroup}:\n  - a.test.ts`)
    expect(message).not.toContain("revert")
    expect(message).not.toMatch(/delete|restore/i)
  })

  it("only the build turn refuses an added marked test (turn split, not a fix-turn flow)", () => {
    const text = "## Tests\n- unit: `a.test.ts` (unchanged)"
    expect(run(text, ["a.test.ts"], [added("a.test.ts")], false, "fix").message).toBe("")
  })

  it("defaults to the fix turn when called with two arguments", () => {
    const text = "## Tests\n- unit: `a.test.ts` (unchanged)"
    const cases: [string, Change][] = [
      ["modified", modified("a.test.ts")],
      ["added", added("a.test.ts")],
    ]
    for (const [, change] of cases) {
      expect(run(text, ["a.test.ts"], [change], false, "default").message).toBe("")
      expect(run(text, ["a.test.ts"], [change], false, "build").message).not.toBe("")
    }
  })

  it("lets an unmarked entry win over a marked one the build added", () => {
    const text = "## Tests\n- unit: `a.test.ts`\n- unit: `a.test.ts` (unchanged)"
    expect(run(text, ["a.test.ts"], [added("a.test.ts")]).message).toBe("")
  })

  it("lists a duplicated unwritten line once", () => {
    const text = "## Tests\n- unit: `a.test.ts`\n- unit: `a.test.ts`"
    const { message } = run(text, [], [])
    expect(message.split("a.test.ts").length - 1).toBe(1)
  })

  it("lists a duplicated marked line missing from the tree once", () => {
    const text = "## Tests\n- unit: `a.test.ts` (unchanged)\n- unit: `a.test.ts` (unchanged)"
    const { message } = run(text, [], [])
    expect(message.split("a.test.ts").length - 1).toBe(1)
  })

  it("orders write, revert, added, restore, missing and never says satisfied", () => {
    const text = [
      "## Tests",
      "- unit: `w.test.ts`",
      "- unit: `r.test.ts` (unchanged)",
      "- unit: `m.test.ts` (unchanged)",
      "- unit: `v.test.ts` (unchanged)",
      "- unit: `a.test.ts` (unchanged)",
    ].join("\n")
    const { message } = run(
      text,
      ["v.test.ts", "a.test.ts"],
      [deleted("r.test.ts"), modified("v.test.ts"), added("a.test.ts")],
    )
    const w = message.indexOf("write them")
    const v = message.indexOf("revert them")
    expect(v).toBeGreaterThan(w)
    const ad = message.indexOf("added by this turn")
    expect(ad).toBeGreaterThan(v)
    const r = message.indexOf("restore them")
    expect(r).toBeGreaterThan(ad)
    const m = message.indexOf("missing from the tree")
    expect(w).toBeGreaterThan(0)
    expect(r).toBeGreaterThan(w)
    expect(m).toBeGreaterThan(r)
    expect(message).not.toMatch(/satisf/i)
  })
})
