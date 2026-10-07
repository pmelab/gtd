import { Cause, Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import { resolveScopeSkills } from "./skills.js"

const FILE = "/repo/gtd.config.ts"

const failure = async (skills: (vars: Record<string, string>) => unknown): Promise<string> => {
  const exit = await Effect.runPromiseExit(
    resolveScopeSkills({ skills: skills as never, skillsKeys: [], skillsOrigin: FILE }, {}),
  )
  expect(Exit.isFailure(exit)).toBe(true)
  return Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : ""
}

describe("resolveScopeSkills", () => {
  it("wraps a throwing export with the config prefix and file", async () => {
    const message = await failure(() => {
      throw new Error("boom")
    })
    expect(message).toContain(`gtd config:\n  - ${FILE}: boom`)
  })

  it("rejects a non-object return", async () => {
    expect(await failure(() => ["a"])).toContain(
      `gtd config:\n  - ${FILE}: skills export must return an object of scope -> skill names`,
    )
  })

  it("rejects a non-array value", async () => {
    expect(await failure(() => ({ a: "x" }))).toContain(
      `gtd config:\n  - ${FILE}: skills export: "a" must be an array of skill names`,
    )
  })

  it("rejects a non-string entry", async () => {
    expect(await failure(() => ({ a: ["x", 1] }))).toContain(
      `gtd config:\n  - ${FILE}: skills export: "a" must be an array of skill names`,
    )
  })

  it("reports an unknown key with its own origin", async () => {
    const exit = await Effect.runPromiseExit(
      resolveScopeSkills(
        {
          skills: () => ({ a: ["x"] }),
          skillsKeys: [{ key: "nope", origin: "/repo/.gtdrc.json" }],
          skillsOrigin: FILE,
        },
        {},
      ),
    )
    expect(String(Exit.isFailure(exit) ? Cause.squash(exit.cause) : "")).toContain(
      '/repo/.gtdrc.json: skills.nope: "skills.nope" is not a scope that runs a turn — known scopes: a',
    )
  })
})
