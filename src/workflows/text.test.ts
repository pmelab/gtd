import { describe, expect, it } from "vitest"
import { withSkills } from "./text.js"
import { renderText } from "./text.fixture.js"

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
