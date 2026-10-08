import { describe, expect, it } from "vitest"
import { ACCESS_REFUSAL } from "../wire/index.js"
import { accessRefusal } from "./accessRefusal.js"

describe("accessRefusal", () => {
  it("allows changes inside the write globs", () => {
    expect(
      accessRefusal(
        [
          { status: "M", path: ".gtd/REVIEW.md" },
          { status: "A", path: "docs/deep/a.md" },
        ],
        [".gtd/REVIEW.md", "docs/**"],
      ),
    ).toBeUndefined()
  })

  it("refuses a path outside, naming it and the allowed globs", () => {
    const message = accessRefusal(
      [
        { status: "M", path: "src/foo.ts" },
        { status: "M", path: ".gtd/REVIEW.md" },
      ],
      [".gtd/REVIEW.md"],
    )
    expect(message).toBe(`${ACCESS_REFUSAL}\n  - src/foo.ts\nallowed: .gtd/REVIEW.md`)
  })

  it("refuses a delete outside", () => {
    expect(accessRefusal([{ status: "D", path: "src/gone.ts" }], ["docs/**"])).toContain(
      "  - src/gone.ts",
    )
  })

  it("refuses only the side of a rename that lands outside the write globs", () => {
    const message = accessRefusal(
      [
        { status: "D", path: "docs/a.md" },
        { status: "A", path: "src/a.md" },
      ],
      ["docs/**"],
    )
    expect(message).toContain("  - src/a.md")
    expect(message).not.toContain("  - docs/a.md")
  })

  it("never refuses a null write", () => {
    expect(accessRefusal([{ status: "M", path: "anything" }], null)).toBeUndefined()
  })

  it("says nothing is allowed for an empty list", () => {
    expect(accessRefusal([{ status: "A", path: "x" }], [])).toContain("allowed: (nothing)")
  })

  it("starts with the marker line", () => {
    expect(accessRefusal([{ status: "A", path: "x" }], ["y"])?.split("\n")[0]).toBe(ACCESS_REFUSAL)
  })
})
