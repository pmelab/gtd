import { Cause, Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import { resolveScopeAccess, resolveScopeSkills } from "./skills.js"

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

describe("resolveScopeAccess", () => {
  const run = (
    def: {
      access: (vars: Record<string, string>) => unknown
      accessKeys?: { key: string; origin: string }[]
    },
    skills: Record<string, readonly string[]> = {},
  ) =>
    Effect.runPromiseExit(
      resolveScopeAccess(
        { access: def.access as never, accessKeys: def.accessKeys ?? [], skillsOrigin: FILE },
        skills,
        {},
      ),
    )
  const message = (exit: Awaited<ReturnType<typeof run>>): string =>
    Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : ""

  it("returns a well-shaped record", async () => {
    const exit = await run({ access: () => ({ a: { write: ["x"] }, b: {} }) })
    expect(Exit.isSuccess(exit) && exit.value).toEqual({ a: { write: ["x"] }, b: {} })
  })

  it("rejects a malformed export with the file", async () => {
    expect(message(await run({ access: () => ["a"] }))).toContain(
      `gtd config:\n  - ${FILE}: access export must return an object`,
    )
    expect(message(await run({ access: () => ({ a: { write: "x" } }) }))).toContain(
      `${FILE}: access export: "a": access.write must be an array`,
    )
  })

  it("knows the scopes of both the skills and access exports", async () => {
    const exit = await run(
      {
        access: () => ({ fromAccess: {} }),
        accessKeys: [
          { key: "fromSkills", origin: "/repo/.gtdrc" },
          { key: "fromAccess", origin: "/repo/.gtdrc" },
        ],
      },
      { fromSkills: ["s"] },
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("reports an unknown key with the exact message and known scopes", async () => {
    const text = message(
      await run(
        { access: () => ({ b: {} }), accessKeys: [{ key: "nope", origin: "/repo/.gtdrc" }] },
        { a: ["x"] },
      ),
    )
    expect(text).toContain(
      '/repo/.gtdrc: access.nope: "access.nope" is not a scope that runs a turn — known scopes: a, b',
    )
  })
})
