import { describe, expect, it } from "vitest"
import { compileConfig, type ConfigLayer } from "./compile.js"

const layer = (value: unknown, origin = "/repo/.gtdrc"): ConfigLayer => ({
  origin,
  dir: "/repo",
  value,
})

describe("compileConfig: skills: shape validation", () => {
  it("rejects a non-object skills:, dropping it to {} while reporting the shape", () => {
    const compiled = compileConfig([layer({ skills: "nope" })])
    expect(compiled.rcSkills).toEqual({})
    const found = compiled.diagnostics.find((d) => d.path.join(".") === "skills")
    expect(found?.message).toContain(
      '"skills" must be a mapping of scope name -> array of skill names',
    )
    expect(found?.message).toContain("got string")
  })

  it("rejects an entry whose value is a string instead of an array, dropping only that key — a sibling good key survives", () => {
    const compiled = compileConfig([
      layer({
        skills: {
          "build.fix": "debugging-and-error-recovery",
          "build.review.reviewing": ["code-review-and-quality"],
        },
      }),
    ])
    expect(compiled.rcSkills).toEqual({ "build.review.reviewing": ["code-review-and-quality"] })
    const found = compiled.diagnostics.find((d) => d.path.join(".") === "skills.build.fix")
    expect(found?.message).toContain('"skills.build.fix" must be an array of skill names (strings)')
    expect(found?.message).toContain("got string")
  })

  it("rejects an entry whose array holds a non-string element, dropping only that key — a sibling good key survives", () => {
    const compiled = compileConfig([
      layer({
        skills: {
          "build.fix": ["debugging-and-error-recovery", 42],
          "build.review.reviewing": ["code-review-and-quality"],
        },
      }),
    ])
    expect(compiled.rcSkills).toEqual({ "build.review.reviewing": ["code-review-and-quality"] })
    const found = compiled.diagnostics.find((d) => d.path.join(".") === "skills.build.fix")
    expect(found?.message).toContain('"skills.build.fix" must be an array of skill names (strings)')
  })

  it("accepts a well-shaped skills: map untouched, with no diagnostic", () => {
    const compiled = compileConfig([layer({ skills: { "build.fix": ["my-org-runbook"] } })])
    expect(compiled.rcSkills).toEqual({ "build.fix": ["my-org-runbook"] })
    expect(compiled.diagnostics).toEqual([])
  })
})

describe("compileConfig: access: shape validation", () => {
  it("accepts a well-shaped map and any key", () => {
    const compiled = compileConfig([
      layer({ access: { "no.such.scope": { write: ["a/**"] }, x: { read: [] }, y: {} } }),
    ])
    expect(compiled.diagnostics).toEqual([])
    expect(Object.keys(compiled.access)).toEqual(["no.such.scope", "x", "y"])
    expect(compiled.accessKeys.map((k) => k.key)).toEqual(["no.such.scope", "x", "y"])
  })

  it("rejects a non-object access:", () => {
    const compiled = compileConfig([layer({ access: "nope" })])
    expect(compiled.access).toEqual({})
    expect(compiled.diagnostics.find((d) => d.path.join(".") === "access")?.message).toContain(
      '"access" must be a mapping',
    )
  })

  it("rejects a non-object entry, a non-array side and an unknown side, dropping the entry", () => {
    const compiled = compileConfig([
      layer({ access: { a: "x", b: { write: "x" }, c: { exec: [] }, d: { read: [1] } } }),
    ])
    expect(compiled.access).toEqual({})
    const messages = compiled.diagnostics.map((d) => d.message).join("\n")
    expect(messages).toContain('"access.a": access must be an object')
    expect(messages).toContain('"access.b": access.write must be an array of glob strings')
    expect(messages).toContain('"access.c": unknown access key "exec"')
    expect(messages).toContain('"access.d": access.read must be an array of glob strings')
  })
})

describe("compileConfig: skills: across layers", () => {
  it("reports an outer layer's malformed entry even when a nearer layer sets a good one", () => {
    const compiled = compileConfig([
      layer({ skills: { "build.fix": "oops" } }, "/outer/.gtdrc"),
      layer({ skills: { "build.fix": ["x"] } }, "/inner/.gtdrc"),
    ])
    expect(compiled.rcSkills).toEqual({ "build.fix": ["x"] })
    expect(compiled.diagnostics.map((d) => d.origin)).toEqual(["/outer/.gtdrc"])
  })

  it("reports the same malformed entry once per layer that carries it", () => {
    const compiled = compileConfig([
      layer({ skills: { "build.fix": "oops" } }, "/outer/.gtdrc"),
      layer({ skills: { "build.fix": "oops" } }, "/inner/.gtdrc"),
    ])
    expect(compiled.diagnostics.map((d) => d.origin)).toEqual(["/outer/.gtdrc", "/inner/.gtdrc"])
  })

  it("lists every layer's keys with their origin, and keeps a __proto__ key as a plain entry", () => {
    const compiled = compileConfig([
      layer({ skills: { "build.fix": ["x"] } }, "/outer/.gtdrc"),
      layer({ skills: JSON.parse('{"build.fix": ["y"], "__proto__": ["z"]}') }, "/inner/.gtdrc"),
    ])
    expect(compiled.skillsKeys).toEqual([
      { key: "build.fix", origin: "/outer/.gtdrc" },
      { key: "build.fix", origin: "/inner/.gtdrc" },
      { key: "__proto__", origin: "/inner/.gtdrc" },
    ])
  })
})

describe("compileConfig: setting names", () => {
  it.each(["vars", "env"] as const)(
    "refuses a %s: key outside the setting-name rule, keeping the raw key out of the path",
    (keyName) => {
      const compiled = compileConfig([layer({ [keyName]: { "a=b": "1", "x\ny": "2", ok_1: "3" } })])
      const found = compiled.diagnostics.filter((d) => d.severity === "error")
      expect(found.map((d) => d.path)).toEqual([[keyName], [keyName]])
      expect(found.map((d) => d.message).join("\n")).toContain(
        `"${keyName}" key "a=b" is not a valid setting name — a setting name is a letter or "_", then letters, digits or "_"`,
      )
      expect(found.map((d) => d.message).join("\n")).toContain(JSON.stringify("x\ny"))
      expect(keyName === "vars" ? compiled.rcVars : compiled.rcEnv).toEqual({ ok_1: "3" })
    },
  )
})
