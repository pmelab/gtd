import { describe, expect, it } from "vitest"
import { restoreScript } from "./scripts.js"

describe("restoreScript", () => {
  const paths = { restore: ["a.ts"], remove: [] }

  it("restores from <commit>~1 by default", () => {
    expect(restoreScript("abc", paths)).toContain("--source='abc~1'")
  })

  it("restores from the given source commit", () => {
    const script = restoreScript("abc", paths, "def")
    expect(script).toContain("--source='def'")
    expect(script).not.toContain("abc~1")
  })
})
