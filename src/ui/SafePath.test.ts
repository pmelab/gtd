import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { resolveWithinRoot } from "./SafePath.js"

describe("resolveWithinRoot", () => {
  it("joins an ordinary relative path onto the root", () => {
    expect(resolveWithinRoot("/repo", "PLAN.md")).toBe(join("/repo", "PLAN.md"))
    expect(resolveWithinRoot("/repo", ".gtd/PLAN.md")).toBe(join("/repo", ".gtd/PLAN.md"))
  })

  it("refuses a path that walks above the root via ..", () => {
    expect(resolveWithinRoot("/repo", "../../../etc/passwd")).toBeUndefined()
    expect(resolveWithinRoot("/repo", "../outside.md")).toBeUndefined()
  })

  it("refuses a path that walks above the root and back down to a sibling", () => {
    expect(resolveWithinRoot("/repo", "../repo-evil/PLAN.md")).toBeUndefined()
  })

  it("refuses an absolute path — path.resolve's second-argument semantics never let it fall back to root", () => {
    expect(resolveWithinRoot("/repo", "/etc/passwd")).toBeUndefined()
  })

  it("accepts a path that dips below root and back up, as long as it never actually leaves it", () => {
    expect(resolveWithinRoot("/repo", "a/../b.md")).toBe(join("/repo", "b.md"))
  })

  it("accepts the root itself", () => {
    expect(resolveWithinRoot("/repo", ".")).toBe(resolve("/repo"))
    expect(resolveWithinRoot("/repo", "")).toBe(resolve("/repo"))
  })
})
