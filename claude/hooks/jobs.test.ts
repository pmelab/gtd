import { describe, expect, test } from "vitest"

import { jobs } from "./jobs"
import type { JobName } from "./tools"
import type { Done } from "./git"

const settle = () => new Promise((r) => setTimeout(r, 0))

const setup = () => {
  const reports: [JobName, Done][] = []
  const j = jobs()
  const done = (job: JobName) => async (outcome: Done) => void reports.push([job, outcome])
  return { j, reports, done }
}

const gate = () => {
  let open!: (s: Done) => void
  const done = new Promise<Done>((r) => (open = r))
  return { done, open }
}

describe("jobs", () => {
  test("start answers before the work settles; report fires only after", async () => {
    const { j, reports, done } = setup()
    const g = gate()
    const answer = j.start("handoff", () => g.done, false, done("handoff"))
    expect(answer).toMatch(/hand-off has started/)
    await settle()
    expect(reports).toEqual([])
    g.open({ ok: true, text: "done" })
    await settle()
    expect(reports).toEqual([["handoff", { ok: true, text: "done" }]])
  })

  test("an in-turn job runs nothing until flush", async () => {
    const { j, reports, done } = setup()
    let ran = false
    j.start("handoff", async () => ((ran = true), { ok: true, text: "x" }), true, done("handoff"))
    await settle()
    expect(ran).toBe(false)
    expect(j.busy()).toBe("handoff")
    j.flush()
    await settle()
    expect(ran).toBe(true)
    expect(reports).toHaveLength(1)
  })

  test("a second start is refused naming the busy job, running or queued", async () => {
    const { j, done } = setup()
    const g = gate()
    j.start("handoff", () => g.done, true, done("handoff"))
    expect(
      j.start("handoff", async () => ({ ok: true, text: "" }), false, done("handoff")),
    ).toMatch(/hand-off is already being prepared/)
    j.flush()
    expect(j.busy()).toBe("handoff")
    expect(
      j.start("handoff", async () => ({ ok: true, text: "" }), false, done("handoff")),
    ).toMatch(/hand-off is already being prepared/)
    g.open({ ok: true, text: "" })
    await settle()
    expect(j.busy()).toBeUndefined()
  })

  test("work that throws reports a failure with the error text and frees the slot", async () => {
    const { j, reports, done } = setup()
    j.start(
      "handoff",
      async () => {
        throw new Error("kaboom")
      },
      false,
      done("handoff"),
    )
    await settle()
    expect(reports[0]![1]).toMatchObject({ ok: false, text: expect.stringContaining("kaboom") })
    expect(j.busy()).toBeUndefined()
    expect(
      j.start("handoff", async () => ({ ok: true, text: "" }), false, done("handoff")),
    ).not.toMatch(/already/)
    await settle()
    expect(reports).toHaveLength(2)
  })
})
