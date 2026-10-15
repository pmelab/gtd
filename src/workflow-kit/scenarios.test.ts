import { describe, expect, it } from "vitest"
import type { Change } from "../flows/index.js"
import { assertionLines, removedAssertions } from "./scenarios.js"

const scenario = (name: string, ...steps: string[]): string[] => [
  `  Scenario: ${name}`,
  ...steps.map((s) => `    ${s}`),
]

const feature = (...steps: string[]): string =>
  ["Feature: x", ...scenario("y", ...steps)].join("\n")

const modified = (path: string, before: string, after: string | undefined): Change => ({
  path,
  status: after === undefined ? "deleted" : "modified",
  before,
  after,
})

const lost = (path: string, name: string, ...lines: string[]) => ({
  path,
  lines: lines.map((line) => ({ scenario: `Scenario: ${name}`, line })),
})

describe("assertionLines", () => {
  it("keeps Then lines and their And/But continuations, not Given/When ones", () => {
    expect(
      assertionLines(
        feature(
          "Given a",
          "And b",
          "When c",
          "Then d",
          "And e",
          "| row |",
          "But f",
          "When g",
          "And h",
        ),
      ).map((a) => a.line),
    ).toEqual(["Then d", "And e", "But f"])
  })

  it("skips doc string content", () => {
    expect(
      assertionLines(feature("Then a file with:", '  """', "  Then not a step", '  """')).map(
        (a) => a.line,
      ),
    ).toEqual(["Then a file with:"])
  })

  it("names the scenario each assertion sits in, through an Examples table", () => {
    const source = [
      "Feature: x",
      ...scenario("a", "Then one"),
      "  Scenario Outline: b",
      "    Then <two>",
      "    Examples:",
      "      | two |",
    ].join("\n")
    expect(assertionLines(source)).toEqual([
      { scenario: "Scenario: a", line: "Then one" },
      { scenario: "Scenario Outline: b", line: "Then <two>" },
    ])
  })
})

describe("removedAssertions", () => {
  it("reports a reworded assertion of an existing scenario", () => {
    expect(
      removedAssertions([
        modified(
          "a.feature",
          feature("Given a", "Then it is shown"),
          feature("Given a", "Then it is displayed"),
        ),
      ]),
    ).toEqual([lost("a.feature", "y", "Then it is shown")])
  })

  it("ignores reworded Given and When steps and added assertions", () => {
    expect(
      removedAssertions([
        modified(
          "a.feature",
          feature("Given a", "Then b"),
          feature("Given z", "When y", "Then b", "And c"),
        ),
      ]),
    ).toEqual([])
  })

  it("counts duplicates, so dropping one of two identical lines shows", () => {
    expect(
      removedAssertions([modified("a.feature", feature("Then b", "Then b"), feature("Then b"))]),
    ).toEqual([lost("a.feature", "y", "Then b")])
  })

  it("reports an assertion that moved to another scenario", () => {
    const before = ["Feature: x", ...scenario("a", "Then ok"), ...scenario("b", "When c")]
    const after = ["Feature: x", ...scenario("a", "When d"), ...scenario("b", "When c", "Then ok")]
    expect(removedAssertions([modified("a.feature", before.join("\n"), after.join("\n"))])).toEqual(
      [lost("a.feature", "a", "Then ok")],
    )
  })

  it("reports every assertion of a deleted file, none of an added one or a non-feature", () => {
    expect(
      removedAssertions([
        modified("gone.feature", feature("Then b"), undefined),
        { path: "new.feature", status: "added", before: undefined, after: feature("Then c") },
        modified("a.ts", "Then b", ""),
      ]),
    ).toEqual([lost("gone.feature", "y", "Then b")])
  })
})
