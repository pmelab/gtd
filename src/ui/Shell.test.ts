import { describe, expect, it } from "vitest"
import { singleQuoted } from "./Shell.js"

describe("singleQuoted", () => {
  it("wraps a plain value in single quotes", () => {
    expect(singleQuoted("example.local")).toBe("'example.local'")
  })

  it("escapes an embedded single quote so it can never end the quoted string early", () => {
    expect(singleQuoted("it's-a-host")).toBe("'it'\\''s-a-host'")
  })

  it("neutralizes a command substitution — the whole payload stays a literal string to bash", () => {
    const quoted = singleQuoted("$(touch PWNED_MARKER)")
    expect(quoted).toBe("'$(touch PWNED_MARKER)'")
    // Never split into a real substitution: no bare, unescaped `$(` outside quotes.
    expect(quoted.startsWith("'")).toBe(true)
    expect(quoted.endsWith("'")).toBe(true)
  })

  it("neutralizes a semicolon-chained command", () => {
    expect(singleQuoted("host; touch PWNED_MARKER")).toBe("'host; touch PWNED_MARKER'")
  })

  it("neutralizes a backtick command substitution", () => {
    expect(singleQuoted("`touch PWNED_MARKER`")).toBe("'`touch PWNED_MARKER`'")
  })
})
