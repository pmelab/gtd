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
      "- unit: `c.test.ts` (unchanged-ish)",
      "- unit: `d.test.ts` (Unchanged)",
      "- e2e: `e.feature` (unchanged)",
    ].join("\n")
    expect(declaredTests(text).map((t) => [t.path, t.unchanged])).toEqual([
      ["a.test.ts", true],
      ["b.test.ts", false],
      ["c.test.ts", false],
      ["d.test.ts", false],
      ["e.feature", true],
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
            path === pkg ? text : path === "lib/gone.test.ts" ? undefined : "x",
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
    const diffAt = message.indexOf("not in the package's diff")
    const treeAt = message.indexOf("missing from the tree")
    expect(diffAt).toBeGreaterThanOrEqual(0)
    expect(treeAt).toBeGreaterThan(diffAt)
    expect(message.indexOf("  - lib/unwritten.test.ts")).toBeGreaterThan(diffAt)
    expect(message.indexOf("  - lib/unwritten.test.ts")).toBeLessThan(treeAt)
    expect(message.indexOf("  - lib/gone.test.ts")).toBeGreaterThan(treeAt)
    expect(message).not.toContain("kept.test.ts")
  })
})
