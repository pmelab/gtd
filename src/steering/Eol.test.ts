import { describe, expect, it } from "vitest"
import { eolOf } from "./Eol.js"

describe("eolOf", () => {
  it("returns CRLF when the content contains any \\r\\n", () => {
    expect(eolOf("a\r\nb\nc")).toBe("\r\n")
  })

  it("returns LF when the content has no \\r\\n", () => {
    expect(eolOf("a\nb\nc")).toBe("\n")
  })

  it("returns LF for content with no newlines at all", () => {
    expect(eolOf("a single line")).toBe("\n")
  })
})
