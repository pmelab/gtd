import { describe, expect, it } from "vitest"
import { compileConfig } from "./compile.js"

const FILE = "/repo/gtd.config.ts"

describe("compileConfig", () => {
  it("compiles no config export to empty settings", () => {
    expect(compileConfig(undefined, FILE)).toEqual({
      skills: {},
      access: {},
      diagnostics: [],
    })
  })

  it("reports every problem at the file, under config, and compiles nothing else", () => {
    const compiled = compileConfig({ vars: {}, skills: { a: "x" } }, FILE)
    expect(compiled.skills).toEqual({})
    expect(compiled.diagnostics).toEqual([
      { severity: "error", path: ["config", "vars"], message: "is not a known key", origin: FILE },
      {
        severity: "error",
        path: ["config", "skills", "a"],
        message: "must be an array of skill names",
        origin: FILE,
      },
    ])
  })

  it("keeps a __proto__ skills key as a plain entry", () => {
    const skills = JSON.parse('{ "__proto__": ["x"], "build": ["y"] }') as Record<string, string[]>
    const compiled = compileConfig({ skills }, FILE)
    expect(Object.keys(compiled.skills).sort()).toEqual(["__proto__", "build"])
  })
})
