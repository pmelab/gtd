import { describe, expect, test } from "vitest"

import { enter } from "./entry"
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

describe("entry", () => {
  test("fix runs the script gtd plans for its side door", async () => {
    const { calls, io } = repo({ "gtd --entry fix-precheck": { out: "git commit …" } })
    expect(await enter(io, "fix")).toMatchObject({ ok: true })
    expect(calls).toEqual(["gtd --entry fix-precheck", "sh -c git commit …"])
  })

  test("review starts from the merge-base with the default branch", async () => {
    const { calls, io } = repo({
      "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": { out: "origin/main\n" },
      "git merge-base origin/main HEAD": { out: "abc1234def\n" },
      "git rev-parse HEAD": { out: "fff\n" },
    })
    expect(await enter(io, "review")).toMatchObject({ ok: true })
    expect(calls).toContain("gtd --entry review-gate.check --var reviewBase=abc1234def")
  })

  test("review against a named base", async () => {
    const { calls, io } = repo({
      "git merge-base v1.0 HEAD": { out: "b0\n" },
      "git rev-parse HEAD": { out: "h\n" },
    })
    await enter(io, "review", "v1.0")
    expect(calls).toContain("gtd --entry review-gate.check --var reviewBase=b0")
  })

  test("a refused entry runs nothing", async () => {
    const { calls, io } = repo({
      "gtd --entry fix-precheck": { code: 1, err: "a process is underway" },
    })
    expect(await enter(io, "fix")).toEqual({ ok: false, text: "a process is underway" })
    expect(calls.some((c) => c.startsWith("sh"))).toBe(false)
  })

  test("there is nothing to review on the base itself", async () => {
    const { io } = repo({
      "git merge-base main HEAD": { out: "h\n" },
      "git rev-parse HEAD": { out: "h\n" },
    })
    expect(await enter(io, "review")).toMatchObject({ ok: false })
  })
})
