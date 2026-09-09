import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
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

  it("accepts a file named '..foo' — its own first path segment isn't '..', a string-prefix test would wrongly refuse it", () => {
    expect(resolveWithinRoot("/repo", "..foo")).toBe(join("/repo", "..foo"))
  })

  describe("against a real, on-disk root", () => {
    let root: string

    afterEach(() => {
      rmSync(root, { recursive: true, force: true })
    })

    it("accepts a leaf file that doesn't exist yet, walking up to the nearest existing ancestor", () => {
      root = mkdtempSync(join(tmpdir(), "gtd-safepath-"))
      mkdirSync(join(root, "sub"))
      expect(resolveWithinRoot(root, "sub/not-yet-written.md")).toBe(
        join(root, "sub/not-yet-written.md"),
      )
    })

    it("resolves a symlinked root itself, rather than refusing its own files", () => {
      const real = mkdtempSync(join(tmpdir(), "gtd-safepath-real-"))
      writeFileSync(join(real, "PLAN.md"), "hi")
      const parent = mkdtempSync(join(tmpdir(), "gtd-safepath-parent-"))
      root = join(parent, "linked-root")
      symlinkSync(real, root)
      expect(resolveWithinRoot(root, "PLAN.md")).toBe(join(root, "PLAN.md"))
      rmSync(parent, { recursive: true, force: true })
      rmSync(real, { recursive: true, force: true })
    })

    it("refuses a symlink inside the root whose real target lands outside it", () => {
      root = mkdtempSync(join(tmpdir(), "gtd-safepath-"))
      const outside = mkdtempSync(join(tmpdir(), "gtd-safepath-outside-"))
      writeFileSync(join(outside, "secret.md"), "top secret")
      symlinkSync(join(outside, "secret.md"), join(root, "escape.md"))
      expect(resolveWithinRoot(root, "escape.md")).toBeUndefined()
      rmSync(outside, { recursive: true, force: true })
    })

    it("refuses a path through a symlinked DIRECTORY inside the root pointing outside it", () => {
      root = mkdtempSync(join(tmpdir(), "gtd-safepath-"))
      const outside = mkdtempSync(join(tmpdir(), "gtd-safepath-outside-"))
      writeFileSync(join(outside, "secret.md"), "top secret")
      symlinkSync(outside, join(root, "escape-dir"))
      expect(resolveWithinRoot(root, "escape-dir/secret.md")).toBeUndefined()
      rmSync(outside, { recursive: true, force: true })
    })
  })
})
