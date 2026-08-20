import { describe, expect, it } from "vitest"
import {
  EXIT_CODES,
  EXIT_OK,
  EXIT_RUNTIME_ERROR,
  EXIT_SIGINT,
  EXIT_SIGTERM,
  EXIT_USAGE_ERROR,
} from "./ExitCodes.js"

describe("EXIT_CODES", () => {
  it("is exactly {0, 1, 2, 130, 143}", () => {
    expect(EXIT_CODES).toEqual(new Set([0, 1, 2, 130, 143]))
  })

  it("each named constant is a member of the set", () => {
    for (const code of [EXIT_OK, EXIT_RUNTIME_ERROR, EXIT_USAGE_ERROR, EXIT_SIGINT, EXIT_SIGTERM]) {
      expect(EXIT_CODES.has(code)).toBe(true)
    }
  })
})
