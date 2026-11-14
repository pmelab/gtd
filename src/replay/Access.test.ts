import { describe, expect, it } from "vitest"
import { accessShapeFault, foldAccess } from "./Access.js"

describe("foldAccess", () => {
  it("adds the steering file to each restricted side, after the scope globs", () => {
    expect(foldAccess({ read: ["docs/**"], write: ["src/**"] }, ".gtd/X.md")).toEqual({
      read: ["docs/**", ".gtd/X.md"],
      write: ["src/**", ".gtd/X.md"],
    })
  })

  it("dedupes against scope globs", () => {
    expect(foldAccess({ write: ["src/a.ts", ".gtd/X.md"] }, ".gtd/X.md")).toEqual({
      read: null,
      write: ["src/a.ts", ".gtd/X.md"],
    })
  })

  it("leaves an unrestricted side null, whatever is added", () => {
    expect(foldAccess({}, ".gtd/X.md")).toEqual({ read: null, write: null })
    expect(foldAccess(undefined, ".gtd/X.md")).toEqual({ read: null, write: null })
  })

  it("adds nothing for a missing file", () => {
    expect(foldAccess({ read: ["a"], write: ["b"] }, undefined)).toEqual({
      read: ["a"],
      write: ["b"],
    })
  })
})

describe("accessShapeFault", () => {
  it("accepts {} and either side alone", () => {
    expect(accessShapeFault({})).toBeUndefined()
    expect(accessShapeFault({ read: [] })).toBeUndefined()
    expect(accessShapeFault({ write: ["a/**"] })).toBeUndefined()
  })

  it("names what is wrong", () => {
    expect(accessShapeFault("x")).toContain("must be an object")
    expect(accessShapeFault(["a"])).toContain("must be an object")
    expect(accessShapeFault({ write: "a" })).toContain("access.write must be an array")
    expect(accessShapeFault({ read: [1] })).toContain("access.read must be an array")
    expect(accessShapeFault({ exec: [] })).toContain('unknown access key "exec"')
  })
})
