import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { withSkills } from "./text.js"
import { renderScript, renderText, SCRIPT_NAMES } from "./text.fixture.js"

// Every bundled script body must parse: a script that fails `sh -n` kills the
// driver's check turn before it runs.
describe("the bundled workflow's scripts", () => {
  it("covers every script text (guards against one being dropped)", () => {
    expect(SCRIPT_NAMES).toEqual([
      "architecturePromoteScript",
      "buildQualityPickingScript",
      "buildQualitySeedingScript",
      "healthCheckScript",
      "packagesItemClosingScript",
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
        start: "a".repeat(40),
        head: "b".repeat(40),
        base: "c".repeat(40),
      })
      expect(() => execFileSync("sh", ["-n"], { input: rendered })).not.toThrow()
      expect(() => execFileSync("bash", ["-n"], { input: rendered })).not.toThrow()
    })
  }
})

describe("withSkills", () => {
  const preamble = "Load: {skills}"
  const prompted = (skills: string | undefined, skillsPreamble = preamble) =>
    renderText(() => withSkills(skills, "do-the-work"), { vars: { skillsPreamble } })

  it("puts the preamble, naming the skills, ahead of the prompt", () => {
    expect(prompted("code-review, testing")).toBe("Load: code-review, testing\n\ndo-the-work")
  })

  it("leaves the prompt bare when there are no skills", () => {
    expect(prompted(undefined)).toBe("do-the-work")
    expect(prompted("  ")).toBe("do-the-work")
  })

  it("leaves the prompt bare when skillsPreamble is blank", () => {
    expect(prompted("code-review", "  ")).toBe("do-the-work")
  })
})
