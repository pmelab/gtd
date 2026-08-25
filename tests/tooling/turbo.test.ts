import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const turbo = JSON.parse(readFileSync(new URL("../../turbo.json", import.meta.url), "utf8"))
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))

const taskKeys = Object.keys(turbo.tasks)
const nonBuildTaskKeys = taskKeys.filter((key) => key !== "build")

describe("turbo.json / package.json invariants", () => {
  it("has a package.json script for every turbo task", () => {
    for (const key of taskKeys) {
      expect(pkg.scripts, `missing script for turbo task "${key}"`).toHaveProperty(key)
    }
  })

  it("names exactly the non-build tasks in the test script's turbo run", () => {
    const match = pkg.scripts.test.match(/^turbo run (.+)$/)
    expect(match, `"test" script must start with "turbo run": ${pkg.scripts.test}`).not.toBeNull()
    const invoked = match![1].split(/\s+/)
    expect(new Set(invoked)).toEqual(new Set(nonBuildTaskKeys))
  })

  it("does not name itself as a turbo task (no recursion)", () => {
    expect(taskKeys).not.toContain("test")
  })

  it("declares no pre<task> script for any task key, except the allowlisted postbuild", () => {
    for (const key of taskKeys) {
      expect(pkg.scripts, `"pre${key}" bypasses the turbo graph`).not.toHaveProperty(`pre${key}`)
    }
    // postbuild is part of the build itself (schema generation + the
    // no-test-doubles bundle assertion), not a duplicate graph edge.
    expect(pkg.scripts).toHaveProperty("postbuild")
  })

  it("makes test:e2e:live depend on build", () => {
    expect(turbo.tasks["test:e2e:live"].dependsOn).toContain("build")
  })

  it("lists docs/** as an input to test:unit and both e2e tasks", () => {
    expect(turbo.tasks["test:unit"].inputs).toContain("docs/**")
    expect(turbo.tasks["test:e2e:inmem"].inputs).toContain("docs/**")
    expect(turbo.tasks["test:e2e:live"].inputs).toContain("docs/**")
  })

  it("declares an explicit inputs array for every task except format:check", () => {
    for (const key of taskKeys) {
      if (key === "format:check") continue
      expect(
        Array.isArray(turbo.tasks[key].inputs),
        `task "${key}" must declare explicit inputs`,
      ).toBe(true)
    }
  })
})
