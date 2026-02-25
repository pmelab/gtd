import { describe, it, expect } from "@effect/vitest"
import { interpolate, planPrompt, buildPrompt, learnPrompt } from "./index.js"

describe("prompts", () => {
  it("planPrompt is a non-empty string", () => {
    expect(typeof planPrompt).toBe("string")
    expect(planPrompt.length).toBeGreaterThan(0)
  })

  it("plan prompt contains web research instruction", () => {
    expect(planPrompt).toMatch(/brave.search|web research/i)
  })

  it("buildPrompt is a non-empty string", () => {
    expect(typeof buildPrompt).toBe("string")
    expect(buildPrompt.length).toBeGreaterThan(0)
  })

  it("learnPrompt is a non-empty string", () => {
    expect(typeof learnPrompt).toBe("string")
    expect(learnPrompt.length).toBeGreaterThan(0)
  })
})

describe("interpolate", () => {
  it("replaces single variable", () => {
    expect(interpolate("hello {{name}}", { name: "world" })).toBe("hello world")
  })

  it("replaces multiple variables", () => {
    expect(interpolate("{{a}} and {{b}}", { a: "foo", b: "bar" })).toBe("foo and bar")
  })

  it("replaces all occurrences of same variable", () => {
    expect(interpolate("{{x}} {{x}}", { x: "y" })).toBe("y y")
  })

  it("leaves unmatched placeholders unchanged", () => {
    expect(interpolate("{{a}} {{b}}", { a: "1" })).toBe("1 {{b}}")
  })

  it("handles empty vars", () => {
    expect(interpolate("no vars", {})).toBe("no vars")
  })
})
