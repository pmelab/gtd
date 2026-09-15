import { describe, expect, it } from "vitest"
import { statusOf } from "./BeatStatus.js"
import type { RenderedDemandSource } from "./types.js"

const rendered = (overrides: Partial<RenderedDemandSource> = {}): RenderedDemandSource => ({
  state: "build.fixing",
  actor: "agent",
  content: "fix it",
  edges: [],
  ...overrides,
})

const baseInput = (overrides: Partial<RenderedDemandSource> = {}) => ({
  rendered: rendered(overrides),
  idle: false,
  log: "log",
  changes: [],
  next: null,
  cost: 0,
  costByModel: [],
})

describe("statusOf", () => {
  it("carries model through verbatim, including the empty string", () => {
    expect(statusOf(baseInput({ model: "" })).model).toBe("")
  })

  it("omits system when its rendered value is the empty string, unlike model", () => {
    const status = statusOf(baseInput({ model: "", system: "" }))
    expect(status.system).toBeUndefined()
    expect(status.model).toBe("")
  })

  it("carries system through when non-empty", () => {
    expect(statusOf(baseInput({ system: "a persona" })).system).toBe("a persona")
  })

  it("omits edges when the rest declares none, carries them through otherwise", () => {
    expect(statusOf(baseInput()).edges).toBeUndefined()
    const edges = [{ pattern: "C", target: "idle" }]
    expect(statusOf(baseInput({ edges })).edges).toEqual(edges)
  })

  it("carries idle/log/changes/next/cost/costByModel through unchanged (ungated — beatDocument applies the wire's omission rules)", () => {
    const status = statusOf({
      rendered: rendered(),
      idle: true,
      log: ".git/gtd-loop.log",
      changes: [{ status: "M", path: "TODO.md", pattern: null }],
      next: { action: undefined, pattern: "C", target: "idle" },
      cost: 12,
      costByModel: [{ model: "opus", cost: 12 }],
    })
    expect(status.idle).toBe(true)
    expect(status.log).toBe(".git/gtd-loop.log")
    expect(status.changes).toEqual([{ status: "M", path: "TODO.md", pattern: null }])
    expect(status.next).toEqual({ action: undefined, pattern: "C", target: "idle" })
    expect(status.cost).toBe(12)
    expect(status.costByModel).toEqual([{ model: "opus", cost: 12 }])
  })
})
