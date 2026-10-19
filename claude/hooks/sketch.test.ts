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
})
