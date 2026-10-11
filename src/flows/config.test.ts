import { describe, expect, it } from "vitest"
import { configProblems, defineConfig } from "./config.js"

describe("defineConfig", () => {
  it("returns a valid config as given", () => {
    const config = {
      modes: { qa: { format: "fmt" }, adr: { validate: "check" } },
      ui: { port: 8443, format: "fmt" },
      skills: { "feature.plan": ["tdd"] },
      access: { "feature.plan": { write: [".gtd/**"] } },
    }
    expect(defineConfig(config)).toBe(config)
  })

  it("rejects a removed key at type level and at runtime", () => {
    // @ts-expect-error -- `vars` is no `gtd.config.ts` setting
    expect(() => defineConfig({ vars: { testCommand: "npm test" } })).toThrow(
      "config.vars: is not a known key",
    )
  })

  it("rejects an unknown nested key at type level and at runtime", () => {
    // @ts-expect-error -- a mode has only format and validate
    expect(() => defineConfig({ modes: { qa: { formatter: "fmt" } } })).toThrow(
      "config.modes.qa.formatter: is not a known key",
    )
  })
})

describe("configProblems", () => {
  it("finds every malformed value", () => {
    expect(
      configProblems({
        modes: { empty: {}, scalar: "fmt", blank: { format: " " } },
        ui: { port: "80", host: 1 },
        skills: { a: "tdd" },
        access: { a: { read: "*", other: [] } },
      }),
    ).toEqual([
      { path: ["modes", "scalar"], message: 'must be an object with "format" and/or "validate"' },
      { path: ["modes", "blank", "format"], message: "must be a non-empty shell command" },
      { path: ["ui", "port"], message: "must be an integer" },
      { path: ["ui", "host"], message: "must be a string" },
      { path: ["skills", "a"], message: "must be an array of skill names" },
      { path: ["access", "a", "other"], message: "is not a known key" },
      { path: ["access", "a", "read"], message: "must be an array of glob strings" },
    ])
  })

  it("rejects a container of the wrong shape", () => {
    expect(configProblems({ modes: { "": {} }, skills: [], ui: "x", access: { a: "x" } })).toEqual([
      { path: ["modes", ""], message: "is a mode without a name" },
      { path: ["ui"], message: "must be an object" },
      { path: ["skills"], message: "must be an object of skill-name arrays" },
      { path: ["access", "a"], message: "must be an object of { read?, write? } glob arrays" },
    ])
    expect(configProblems({ modes: "x", access: [] })).toEqual([
      { path: ["modes"], message: "must be an object of modes" },
      { path: ["access"], message: "must be an object of scope access" },
    ])
  })

  it("rejects a config that is no object", () => {
    expect(configProblems([])).toEqual([{ path: [], message: "must be an object" }])
  })
})
