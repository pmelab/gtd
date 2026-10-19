import { describe, expect, test } from "vitest"

import { withRequirements } from "./sketch"

describe("withRequirements", () => {
  test("an empty steering file holds just the requirements", () => {
    expect(withRequirements("", "add a greeting")).toBe("add a greeting\n")
    expect(withRequirements("\n\n", "add a greeting")).toBe("add a greeting\n")
  })

  test("deferred review notes survive below the new requirements", () => {
    const notes = "## Deferred review notes (abcdef1)\n\n- note-1 — a.ts:3 (could: tiny): plain\n"
    expect(withRequirements(notes, "add a greeting")).toBe(`add a greeting\n\n${notes}`)
  })

  test("the requirements lose trailing, never leading, whitespace", () => {
    expect(withRequirements("notes\n", "    code\n\n")).toBe("    code\n\nnotes\n")
  })

  test("existing content is kept byte for byte", () => {
    expect(withRequirements("  indented\n\n\n", "x")).toBe("x\n\n  indented\n\n\n")
    expect(withRequirements("no newline", "x")).toBe("x\n\nno newline")
  })
})
