import { describe, expect, it } from "vitest"
import { configProblems, defineConfig } from "./config.js"

describe("defineConfig", () => {
  it("returns a valid config as given", () => {
    const config = {
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

  it("says what replaced `modes` and `ui`", () => {
    expect(configProblems({ modes: {}, ui: { port: 8443 } })).toEqual([
      {
        path: ["modes"],
        message: "was removed: every steering file is a widget document gtd checks itself",
      },
      {
        path: ["ui"],
        message:
          "was removed: only `gtd workspace` serves gate pages, at /<project>/<worktree>/gate — see docs/adr/0017-gate-pages-only-in-the-workspace.md",
      },
    ])
  })
})

describe("configProblems", () => {
  it("finds every malformed value", () => {
    expect(
      configProblems({
        skills: { a: "tdd" },
        access: { a: { read: "*", other: [] } },
      }),
    ).toEqual([
      { path: ["skills", "a"], message: "must be an array of skill names" },
      { path: ["access", "a", "other"], message: "is not a known key" },
      { path: ["access", "a", "read"], message: "must be an array of glob strings" },
    ])
  })

  it("rejects a container of the wrong shape", () => {
    expect(configProblems({ skills: [], access: { a: "x" } })).toEqual([
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
