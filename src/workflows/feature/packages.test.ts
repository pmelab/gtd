import { afterEach, describe, expect, it } from "vitest"
import { installContext, type Change, type StepRequest } from "../../flows/index.js"
import { declaredTests, packages } from "./packages.js"
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

describe("packages", () => {
  it("builds every queued package in name order, one commit range each", async () => {
    const queue = [".gtd/packages/02-b.md", ".gtd/packages/01-a.md"]
    let steps = 0
    installContext(
      fixtureContext(
        {},
        {
          step: (request: StepRequest) => {
            steps++
            if (request.kind !== "restart" && request.name === "closing") {
              queue.splice(queue.indexOf([...queue].sort()[0]!), 1)
            }
            return Promise.resolve()
          },
          pushScope: () => undefined,
          popScope: () => undefined,
          glob: () => [...queue],
          changesSince: (): readonly Change[] => [],
          head: () => `c${steps}`,
        },
      ),
    )
    const plan = await packages()
    expect(plan.ranges.map((r) => r.pkg)).toEqual([
      ".gtd/packages/01-a.md",
      ".gtd/packages/02-b.md",
    ])
    expect(plan.ranges[0]!.to).toBe(plan.ranges[1]!.from)
  })
})
