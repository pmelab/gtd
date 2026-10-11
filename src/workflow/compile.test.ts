import { describe, expect, it } from "vitest"
import { compileConfig } from "./compile.js"
import { seededValidateCommand } from "./index.js"

const FILE = "/repo/gtd.config.ts"

describe("compileConfig", () => {
  it("compiles no config export to the built-in modes alone", () => {
    expect(compileConfig(undefined, FILE)).toEqual({
      modes: {
        qa: { validate: seededValidateCommand("qa") },
        review: { validate: seededValidateCommand("review") },
      },
      skills: {},
      access: {},
      diagnostics: [],
    })
  })

  it("layers a mode over a built-in one per half, and adds a new one", () => {
    const { modes } = compileConfig(
      { modes: { qa: { format: "fmt" }, adr: { validate: "v" } } },
      FILE,
    )
    expect(modes["qa"]).toEqual({ format: "fmt", validate: seededValidateCommand("qa") })
    expect(modes["adr"]).toEqual({ validate: "v" })
  })

  it("keeps a built-in half a mode leaves undefined", () => {
    const { modes } = compileConfig({ modes: { qa: { format: "fmt", validate: undefined } } }, FILE)
    expect(modes["qa"]).toEqual({ format: "fmt", validate: seededValidateCommand("qa") })
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
