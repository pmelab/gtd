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

  it("marks only the exact ` (unchanged)` suffix as unchanged", () => {
    const text = [
      "## Tests",
      "- unit: `a.test.ts` (unchanged)",
      "- unit: `b.test.ts` extra",
      "- unit: `c.test.ts` (unchanged)x",
      "- unit: `f.test.ts` (unchanged) — kept as is",
      "- unit: `d.test.ts` (Unchanged)",
      "- e2e: `e.feature` (unchanged)",
    ].join("\n")
    expect(declaredTests(text).map((t) => [t.path, t.unchanged])).toEqual([
      ["a.test.ts", true],
      ["b.test.ts", false],
      ["c.test.ts", false],
      ["f.test.ts", true],
      ["d.test.ts", true],
      ["e.feature", true],
    ])
  })

  it("accepts tabs, several spaces and any case before the boundary", () => {
    const text = [
      "## Tests",
      "- unit: `a.test.ts`\t(unchanged)",
      "- unit: `b.test.ts`   (unchanged)",
      "- unit: `c.test.ts` (UNCHANGED)",
      "- unit: `d.test.ts` (unchanged)x",
      "- unit: `e.test.ts`(unchanged)",
      "- Unit: `f.test.ts` (unchanged)",
    ].join("\n")
    expect(declaredTests(text).map((t) => [t.path, t.unchanged])).toEqual([
      ["a.test.ts", true],
      ["b.test.ts", true],
      ["c.test.ts", true],
      ["d.test.ts", false],
      ["e.test.ts", false],
    ])
  })

  it("parses CRLF and lone CR like LF, including a wrapped marker", () => {
    const lf = "## Tests\n- unit: `a/long.test.ts`\n  (unchanged)\n- e2e: `b.feature`\n"
    expect(declaredTests(lf.replace(/\n/g, "\r\n"))).toEqual(declaredTests(lf))
    expect(declaredTests(lf.replace(/\n/g, "\r"))).toEqual(declaredTests(lf))
    expect(declaredTests(lf).map((t) => t.unchanged)).toEqual([true, false])
  })

  it("never joins a marker across an empty or whitespace-only line", () => {
    for (const gap of ["\n\n", "\n  \n", "\n\t\n"]) {
      const text = `## Tests\n- unit: \`a.test.ts\`${gap}  (unchanged)\n`
      expect(declaredTests(text).map((t) => t.unchanged)).toEqual([false])
    }
  })

  it("reads a marker oxfmt wrapped onto a continuation line", () => {
    const text = "## Tests\n- unit: `some/long/dir/a.test.ts`\n  (unchanged)\n- e2e: `b.feature`\n"
    expect(declaredTests(text).map((t) => [t.path, t.unchanged])).toEqual([
      ["some/long/dir/a.test.ts", true],
      ["b.feature", false],
    ])
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
  it("groups an unwritten unmarked test and a missing marked test in one refusal", () => {
    const pkg = ".gtd/packages/01-a.md"
    const text = [
      "## Tests",
      "- unit: `lib/unwritten.test.ts`",
      "- unit: `lib/gone.test.ts` (unchanged)",
      "- unit: `lib/kept.test.ts` (unchanged)",
    ].join("\n")
    installContext(
      fixtureContext(
        {},
        {
          read: (path: string) =>
            path === pkg ? text : path === "lib/kept.test.ts" ? "x" : undefined,
          refuse: (message: string): never => {
            throw new Error(message)
          },
          changesSince: (): Changes => {
            const list: readonly Change[] = [
              { path: pkg, status: "modified", before: text, after: text },
            ]
            return Object.assign([...list], {
              paths: list.map((c) => c.path),
              get: (path: string) => list.find((c) => c.path === path),
            })
          },
        },
      ),
    )
    let message = ""
    try {
      requireDeclaredTests(pkg, "c")
    } catch (error) {
      message = String(error instanceof Error ? error.message : error)
    }
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

  const run = (
    text: string,
    tree: readonly string[],
    changes: readonly Change[],
    satisfied = false,
  ) => {
    const pkg = ".gtd/packages/01-a.md"
    let lookups = 0
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
            // runtime's `get` is `list.find`: one find per lookup
            const find = list.find.bind(list)
            list.find = ((predicate: (c: Change) => boolean) => {
              lookups += 1
              return find(predicate)
            }) as typeof list.find
            return Object.assign(list, { paths: [], get: () => undefined })
          },
        },
      ),
    )
    let message = ""
    try {
      requireDeclaredTests(pkg, "c")
    } catch (error) {
      message = String(error instanceof Error ? error.message : error)
    }
    return { message, lookups: () => lookups }
  }
  const deleted = (path: string): Change => ({
    path,
    status: "deleted",
    before: "x",
    after: undefined,
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

  it("orders write, restore, missing and never says satisfied", () => {
    const text = [
      "## Tests",
      "- unit: `w.test.ts`",
      "- unit: `r.test.ts` (unchanged)",
      "- unit: `m.test.ts` (unchanged)",
    ].join("\n")
    const { message } = run(text, [], [deleted("r.test.ts")])
    const w = message.indexOf("write them")
    const r = message.indexOf("restore them")
    const m = message.indexOf("missing from the tree")
    expect(w).toBeGreaterThan(0)
    expect(r).toBeGreaterThan(w)
    expect(m).toBeGreaterThan(r)
    expect(message).not.toMatch(/satisf/i)
  })

  it("looks each declared path up once", () => {
    const text = "## Tests\n- unit: `a.test.ts`\n- unit: `b.test.ts` (unchanged)"
    // the package file plus one lookup per declared test
    expect(run(text, ["b.test.ts"], []).lookups()).toBe(3)
  })
})
