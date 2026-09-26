import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { renderScript, SCRIPT_NAMES } from "./text.fixture.js"

// Every bundled script body must parse: a script that fails `sh -n` kills the
// driver's check turn before it runs.
describe("the bundled workflow's scripts", () => {
  it("covers every script text (guards against one being dropped)", () => {
    expect(SCRIPT_NAMES).toEqual([
      "architecturePromoteScript",
      "buildQualityPickingScript",
      "buildQualitySeedingScript",
      "buildReviewDecidingScript",
      "buildReviewTriagingScript",
      "escalateScript",
      "healthCheckScript",
      "packagesItemClosingScript",
      "packagesItemSpecScopingScript",
      "packagesPickingScript",
      "questionCheckScript",
      "reUnwindScript",
      "suiteCheckScript",
      "unwindScript",
    ])
  })

  for (const name of SCRIPT_NAMES) {
    it(`${name} renders to syntactically valid sh`, () => {
      const rendered = renderScript(name, {
        read: () => "placeholder",
        refs: { start: "a".repeat(40), head: "b".repeat(40), reviewBase: "c".repeat(40) },
      })
      expect(() => execFileSync("sh", ["-n"], { input: rendered })).not.toThrow()
      expect(() => execFileSync("bash", ["-n"], { input: rendered })).not.toThrow()
    })
  }
})
