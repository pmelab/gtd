import { describe, expect, test } from "vitest"

import { doors, enter } from "./doors"
import type { Ran, ShipIo } from "./ship"

const repo = (script: Record<string, Partial<Ran>>) => {
  const calls: string[] = []
  const io: ShipIo = {
    run: async (argv) => {
      calls.push(argv.join(" "))
      return { code: 0, out: "", err: "", ...script[argv.join(" ")] }
    },
    complete: async () => undefined,
    log: () => {},
    today: () => "2026-10-03",
  }
  return { calls, io }
}

describe("doors", () => {
  test("lists what gtd reports", async () => {
    const listed = [
      { name: "fix", workflow: "fix", args: [] },
      { name: "review", workflow: "review", args: [{ name: "base", optional: true }] },
    ]
    const { io } = repo({ "gtd doors --json": { out: JSON.stringify(listed) } })
    expect(await doors(io)).toEqual(listed)
  })

  test("is empty when gtd refuses", async () => {
    const { io } = repo({ "gtd doors --json": { code: 1, err: "config error" } })
    expect(await doors(io)).toEqual([])
  })

  test("is empty when gtd prints something else", async () => {
    const { io } = repo({ "gtd doors --json": { out: "not json" } })
    expect(await doors(io)).toEqual([])
  })
})

describe("enter", () => {
  test("runs the script gtd plans for the door, then says which door started", async () => {
    const { calls, io } = repo({ "gtd door fix": { out: "git commit …" } })
    expect(await enter(io, "fix", [])).toEqual({ ok: true, text: "Started fix." })
    expect(calls).toEqual(["gtd door fix", "sh -c git commit …"])
  })

  test("hands the door its args as given", async () => {
    const { calls, io } = repo({ "gtd door review v1.0": { out: "script" } })
    await enter(io, "review", ["v1.0"])
    expect(calls).toContain("gtd door review v1.0")
  })

  test("a refused door runs nothing and reports gtd's own words", async () => {
    const { calls, io } = repo({
      "gtd door fix": { code: 1, err: "a process is underway\n" },
    })
    expect(await enter(io, "fix", [])).toEqual({ ok: false, text: "a process is underway" })
    expect(calls.some((c) => c.startsWith("sh"))).toBe(false)
  })

  test("a refusal with no message still names the command and its exit code", async () => {
    const { io } = repo({ "gtd door fix": { code: 3 } })
    expect(await enter(io, "fix", [])).toEqual({ ok: false, text: "gtd door fix exited 3" })
  })

  test("a failing script is reported with its stderr", async () => {
    const { io } = repo({
      "gtd door fix": { out: "boom" },
      "sh -c boom": { code: 1, err: "bad\n" },
    })
    expect(await enter(io, "fix", [])).toEqual({ ok: false, text: "The door script failed.\nbad" })
  })
})
