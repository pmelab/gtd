import { describe, expect, test } from "vitest"

import { jobs } from "./jobs"
import type { JobName } from "./tools"
import type { Shipped } from "./ship"

const settle = () => new Promise((r) => setTimeout(r, 0))

const setup = () => {
  const reports: [JobName, Shipped][] = []
  const j = jobs()
  const done = (job: JobName) => async (outcome: Shipped) => void reports.push([job, outcome])
  return { j, reports, done }
}

const gate = () => {
  let open!: (s: Shipped) => void
  const done = new Promise<Shipped>((r) => (open = r))
  return { done, open }
}

describe("jobs", () => {
  test("start answers before the work settles; report fires only after", async () => {
    const { j, reports, done } = setup()
    const g = gate()
    const answer = j.start("ship", () => g.done, false, done("ship"))
    expect(answer).toMatch(/ship has started/)
    await settle()
    expect(reports).toEqual([])
    g.open({ ok: true, text: "done" })
    await settle()
    expect(reports).toEqual([["ship", { ok: true, text: "done" }]])
  })

  test("an in-turn job runs nothing until flush", async () => {
    const { j, reports, done } = setup()
    let ran = false
    j.start("ship", async () => ((ran = true), { ok: true, text: "x" }), true, done("ship"))
    await settle()
    expect(ran).toBe(false)
    expect(j.busy()).toBe("ship")
    j.flush()
    await settle()
    expect(ran).toBe(true)
    expect(reports).toHaveLength(1)
  })

  test("a second start is refused naming the busy job, running or queued", async () => {
    const { j, done } = setup()
    const g = gate()
    j.start("ship", () => g.done, true, done("ship"))
    expect(
      j.start("handoff", async () => ({ ok: true, text: "" }), false, done("handoff")),
    ).toMatch(/ship/)
    j.flush()
    expect(j.busy()).toBe("ship")
    expect(
      j.start("handoff", async () => ({ ok: true, text: "" }), false, done("handoff")),
    ).toMatch(/ship/)
    g.open({ ok: true, text: "" })
    await settle()
    expect(j.busy()).toBeUndefined()
  })

  test("hand-off holds the slot against ship", () => {
    const { j, done } = setup()
    j.start("handoff", () => gate().done, false, done("handoff"))
    expect(j.start("ship", async () => ({ ok: true, text: "" }), false, done("ship"))).toMatch(
      /handoff|hand-off/,
    )
  })

  test("work that throws reports a failure with the error text and frees the slot", async () => {
    const { j, reports, done } = setup()
    j.start(
      "ship",
      async () => {
        throw new Error("kaboom")
      },
      false,
      done("ship"),
    )
    await settle()
    expect(reports[0]![1]).toMatchObject({ ok: false, text: expect.stringContaining("kaboom") })
    expect(j.busy()).toBeUndefined()
    expect(j.start("ship", async () => ({ ok: true, text: "" }), false, done("ship"))).not.toMatch(
      /already/,
    )
    await settle()
    expect(reports).toHaveLength(2)
  })
})
