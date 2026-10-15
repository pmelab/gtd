import { describe, expect, it } from "vitest"
import { strayPaths } from "./index.js"

describe("strayPaths", () => {
  it("returns the paths no glob matches, sorted", () => {
    expect(strayPaths(["src/a.ts", "z.md", "a.md"], ["src/**"])).toEqual(["a.md", "z.md"])
  })

  it("an empty allowlist returns every touched path", () => {
    expect(strayPaths(["b", "a"], [])).toEqual(["a", "b"])
  })

  it("an empty touched list returns []", () => {
    expect(strayPaths([], ["src/**"])).toEqual([])
    expect(strayPaths([], [])).toEqual([])
  })
})
