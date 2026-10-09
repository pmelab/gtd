import { afterEach, describe, expect, it } from "vitest"
import { installContext, type Change, type StepRequest } from "../flows/index.js"
import { declaredTests, packages, SCENARIO_PACKAGE } from "./packages.js"
import { fixtureContext } from "./text.fixture.js"

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
      { level: "unit", path: "lib/a.test.ts" },
      { level: "e2e", path: "spec/a.feature" },
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
    expect(declaredTests(text)).toEqual([{ level: "unit", path: "lib/ok.test.ts" }])
  })

  it("returns nothing without a Tests section", () => {
    expect(declaredTests("# Chore\n\n## Tasks\n- do it\n")).toEqual([])
  })
})

describe("packages scenarios", () => {
  it("holds only package 0's own paths, not what later packages add", async () => {
    const queue = [SCENARIO_PACKAGE, ".gtd/packages/01-impl.md"]
    const touches: { at: number; change: Change }[] = []
    let steps = 0
    const touch = (path: string, status: Change["status"]): void => {
      touches.push({ at: steps, change: { path, status, before: undefined, after: "x" } })
    }
    const effects: Record<string, () => void> = {
      building: () => {
        if (queue[0] === SCENARIO_PACKAGE) {
          touch("tests/e2e/a.feature", "added")
          touch(".gtd/packages/00-e2e-scenarios.md", "modified")
        } else {
          touch("src/impl.ts", "added")
          touch("tests/e2e/b.feature", "added")
          touch("tests/e2e/a.feature", "modified")
        }
      },
      closing: () => void queue.shift(),
    }
    installContext(
      fixtureContext(
        {},
        {
          step: (request: StepRequest) => {
            steps++
            if (request.kind !== "restart") effects[request.name]?.()
            return Promise.resolve()
          },
          pushScope: () => undefined,
          popScope: () => undefined,
          refuse: (message: string): never => {
            throw new Error(message)
          },
          glob: () => [...queue],
          changesSince: (hash: string): readonly Change[] =>
            touches.filter((t) => t.at >= Number(hash.slice(1))).map((t) => t.change),
          head: () => `c${steps}`,
        },
      ),
    )
    const plan = await packages()
    expect(plan.ranges.map((r) => r.pkg)).toEqual([SCENARIO_PACKAGE, ".gtd/packages/01-impl.md"])
    expect(plan.scenarios.added).toEqual(["tests/e2e/a.feature"])
    expect(plan.scenarios.changed).toEqual([])
  })
})
