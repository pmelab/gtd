import { describe, expect, it } from "vitest"
import type { Change } from "../flows/index.js"
import { assertionLines, removedAssertions } from "./scenarios.js"

const feature = (...steps: string[]): string =>
  ["Feature: x", "  Scenario: y", ...steps.map((s) => `    ${s}`)].join("\n")

const modified = (path: string, before: string, after: string | undefined): Change => ({
  path,
  status: after === undefined ? "deleted" : "modified",
  before,
  after,
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
      ),
    ).toEqual(["Then d", "And e", "But f"])
  })

  it("skips doc string content", () => {
    expect(
      assertionLines(feature("Then a file with:", '  """', "  Then not a step", '  """')),
    ).toEqual(["Then a file with:"])
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
    ).toEqual([{ path: "a.feature", lines: ["Then it is shown"] }])
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
    ).toEqual([{ path: "a.feature", lines: ["Then b"] }])
  })

  it("reports every assertion of a deleted file, none of an added one or a non-feature", () => {
    expect(
      removedAssertions([
        modified("gone.feature", feature("Then b"), undefined),
        { path: "new.feature", status: "added", before: undefined, after: feature("Then c") },
        modified("a.ts", "Then b", ""),
      ]),
    ).toEqual([{ path: "gone.feature", lines: ["Then b"] }])
  })
})
