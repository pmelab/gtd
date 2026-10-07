import { describe, expect, test } from "vitest"

import { personaSpec, resumable } from "./persona"

const base = { scope: "build", system: "sys", skills: ["a", "b"] }

describe("personaSpec", () => {
  test("name is stable for equal input", async () => {
    expect((await personaSpec(base)).name).toBe((await personaSpec({ ...base })).name)
    expect((await personaSpec(base)).name).toMatch(/^p-[0-9a-f]{12}$/)
  })

  test("name differs on scope, system and skills", async () => {
    const n = (await personaSpec(base)).name
    for (const v of [{ scope: "x" }, { system: "other" }, { skills: ["a"] }]) {
      expect((await personaSpec({ ...base, ...v })).name).not.toBe(n)
    }
  })

  test("carries the list and withholds Skill", async () => {
    expect(await personaSpec(base)).toMatchObject({
      prompt: "sys",
      skills: ["a", "b"],
      disallowedTools: ["Skill"],
      permissionMode: "bypassPermissions",
    })
  })

  test("empty list preloads nothing, still withholds Skill", async () => {
    expect(await personaSpec({ ...base, skills: [] })).toMatchObject({
      skills: [],
      disallowedTools: ["Skill"],
    })
  })

  test("system-less turn gets a fallback prompt", async () => {
    const s = await personaSpec({ scope: "s", skills: [] })
    expect(s.prompt.length).toBeGreaterThan(0)
    expect(s.prompt).not.toContain("\n")
  })
})

describe("resumable", () => {
  test("id only when the persona matches", () => {
    expect(resumable({ agentId: "a1", persona: "p-1" }, "p-1")).toBe("a1")
    expect(resumable({ agentId: "a1", persona: "p-1" }, "p-2")).toBeUndefined()
    expect(resumable("a1", "p-1")).toBeUndefined()
    expect(resumable(undefined, "p-1")).toBeUndefined()
  })
})
