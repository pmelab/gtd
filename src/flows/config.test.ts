import { describe, expect, it } from "vitest"
import { configProblems, defineConfig } from "./config.js"

describe("defineConfig", () => {
  it("returns a valid config as given", () => {
    const config = {
      ui: { port: 8443 },
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
    // @ts-expect-error -- `ui` has no `theme`
    expect(() => defineConfig({ ui: { theme: "dark" } })).toThrow(
      "config.ui.theme: is not a known key",
    )
  })

  it("says what replaced `modes` and `ui.format`", () => {
    expect(configProblems({ modes: {}, ui: { format: "fmt" } })).toEqual([
      {
        path: ["modes"],
        message: "was removed: every steering file is a widget document gtd checks itself",
      },
      {
        path: ["ui", "format"],
        message: "was removed: gtd writes every steering file in its own canonical form",
      },
    ])
  })
})

describe("configProblems", () => {
  it("finds every malformed value", () => {
    expect(
      configProblems({
        ui: { port: "80", host: 1 },
        skills: { a: "tdd" },
        access: { a: { read: "*", other: [] } },
      }),
    ).toEqual([
      { path: ["ui", "port"], message: "must be an integer" },
      { path: ["ui", "host"], message: "must be a string" },
      { path: ["skills", "a"], message: "must be an array of skill names" },
      { path: ["access", "a", "other"], message: "is not a known key" },
      { path: ["access", "a", "read"], message: "must be an array of glob strings" },
    ])
  })

  it("rejects a container of the wrong shape", () => {
    expect(configProblems({ skills: [], ui: "x", access: { a: "x" } })).toEqual([
      { path: ["ui"], message: "must be an object" },
      { path: ["skills"], message: "must be an object of skill-name arrays" },
      { path: ["access", "a"], message: "must be an object of { read?, write? } glob arrays" },
    ])
    expect(configProblems({ access: [] })).toEqual([
      { path: ["access"], message: "must be an object of scope access" },
    ])
  })

  it("rejects a config that is no object", () => {
    expect(configProblems([])).toEqual([{ path: [], message: "must be an object" }])
  })
})
