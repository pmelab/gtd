import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { selectPath } from "./Select.js"

describe("selectPath — scalar/boolean/list leaves", () => {
  it("returns value with the raw string for a scalar leaf", () => {
    expect(selectPath({ kind: "prompt" }, "kind")).toEqual({ kind: "value", text: "prompt" })
  })

  it("returns value with true/false for a boolean leaf", () => {
    expect(selectPath({ idle: true }, "idle")).toEqual({ kind: "value", text: "true" })
    expect(selectPath({ idle: false }, "idle")).toEqual({ kind: "value", text: "false" })
  })

  it("returns value with one JSON.stringify per entry, newline-joined, for a list leaf", () => {
    const result = selectPath({ changes: [{ path: "a" }, { path: "b" }] }, "changes")
    expect(result).toEqual({
      kind: "value",
      text: '{"path":"a"}\n{"path":"b"}',
    })
  })

  it("never carries a trailing newline in value.text", () => {
    const result = selectPath({ changes: [{ path: "a" }, { path: "b" }] }, "changes")
    expect(result.kind).toBe("value")
    if (result.kind === "value") {
      expect(result.text.endsWith("\n")).toBe(false)
    }
  })
})

describe("selectPath — absent vs unknown", () => {
  it("returns absent for a key that is present with an undefined value", () => {
    expect(selectPath({ label: undefined }, "label")).toEqual({ kind: "absent" })
  })

  it("returns unknown for a key that is missing from the object", () => {
    expect(selectPath({ kind: "prompt" }, "nope")).toEqual({ kind: "unknown", path: "nope" })
  })

  it("returns absent for the whole remaining path when a parent is present-but-undefined", () => {
    expect(selectPath({ session: undefined }, "session.id")).toEqual({ kind: "absent" })
  })

  it("returns unknown for an all-digits segment against a list", () => {
    expect(selectPath({ changes: [{ path: "a" }] }, "changes.0.path")).toEqual({
      kind: "unknown",
      path: "changes.0.path",
    })
  })
})

describe("selectPath — never throws", () => {
  it("returns unknown when descending a path through a plain scalar", () => {
    expect(selectPath({ a: 5 }, "a.b")).toEqual({ kind: "unknown", path: "a.b" })
  })

  it("returns unknown when the root itself is a primitive", () => {
    expect(selectPath(5, "a")).toEqual({ kind: "unknown", path: "a" })
  })

  it("returns absent for the whole remaining path when a parent is null — never descends into it, never unknown", () => {
    expect(selectPath({ a: null }, "a.b")).toEqual({ kind: "absent" })
  })
})

describe('selectPath — a null leaf is absent, never the string "null"', () => {
  it('returns absent, not a value with text "null", for a null-valued leaf', () => {
    expect(selectPath({ subject: null }, "subject")).toEqual({ kind: "absent" })
  })

  it("BeatFields.next is | null on no match — next.target reads as absent, not unknown, so a driver's read is never fatal", () => {
    expect(selectPath({ next: null }, "next.target")).toEqual({ kind: "absent" })
  })
})

describe("selectPath — nested field reach", () => {
  it("reaches a nested scalar field", () => {
    expect(selectPath({ session: { id: "abc123" } }, "session.id")).toEqual({
      kind: "value",
      text: "abc123",
    })
  })
})

describe("src/Select.ts — zero imports", () => {
  it("contains no import statement", () => {
    const source = readFileSync(new URL("./Select.ts", import.meta.url), "utf8")
    expect(source).not.toMatch(/^\s*import\b/m)
  })
})
