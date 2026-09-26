import { describe, expect, it } from "vitest"
import { BEAT_KINDS, beatKindOf, demandOf, stallDiagnosis } from "./Demand.js"
import type { RenderedDemandSource } from "./index.js"

const rendered = (overrides: Partial<RenderedDemandSource> = {}): RenderedDemandSource => ({
  state: "build.fixing",
  actor: "agent",
  content: "fix it",
  edges: [],
  ...overrides,
})

describe("beatKindOf", () => {
  it("is stalled whenever stalled is true, regardless of content kind or dirtiness", () => {
    for (const contentKind of ["script", "prompt", "message"] as const) {
      for (const dirty of [true, false]) {
        expect(beatKindOf({ contentKind, dirty, stalled: true })).toBe("stalled")
      }
    }
  })

  it("is capture at a dirty message rest", () => {
    expect(beatKindOf({ contentKind: "message", dirty: true, stalled: false })).toBe("capture")
  })

  it("is message at a clean message rest", () => {
    expect(beatKindOf({ contentKind: "message", dirty: false, stalled: false })).toBe("message")
  })

  it("is script at a script rest, dirty or clean", () => {
    expect(beatKindOf({ contentKind: "script", dirty: true, stalled: false })).toBe("script")
    expect(beatKindOf({ contentKind: "script", dirty: false, stalled: false })).toBe("script")
  })

  it("is prompt at a prompt rest, dirty or clean", () => {
    expect(beatKindOf({ contentKind: "prompt", dirty: true, stalled: false })).toBe("prompt")
    expect(beatKindOf({ contentKind: "prompt", dirty: false, stalled: false })).toBe("prompt")
  })
})

describe("stallDiagnosis", () => {
  it("names the state and mentions all three escapes", () => {
    const text = stallDiagnosis("build.working", "agent")
    expect(text).toContain('stalled at "build.working"')
    expect(text).toContain("gtd(agent): build.working")
    expect(text).toMatch(/escalation/)
    expect(text).toMatch(/allowEmpty: true/)
    expect(text).toMatch(/prompt so the turn has something concrete/)
  })
})

describe("demandOf", () => {
  it("uses the rendered content verbatim at every non-stalled kind", () => {
    for (const kind of BEAT_KINDS.filter((k) => k !== "stalled")) {
      const demand = demandOf({ rendered: rendered(), kind })
      expect(demand.content).toBe("fix it")
    }
  })

  it("uses the stall diagnosis as content, never the rendered content, at kind stalled", () => {
    const demand = demandOf({ rendered: rendered(), kind: "stalled" })
    expect(demand.content).toBe(stallDiagnosis("build.fixing", "agent"))
    expect(demand.content).not.toBe("fix it")
  })

  it("carries session/validate only on the prompt variant — no other kind's Demand shape can hold them", () => {
    const session = { id: "8f2c", resume: true }
    for (const kind of BEAT_KINDS.filter((k) => k !== "prompt")) {
      const demand = demandOf({
        rendered: rendered(),
        kind,
        session,
        validate: "gtd check qa 'TODO.md'",
      })
      expect("session" in demand).toBe(false)
      expect("validate" in demand).toBe(false)
    }
  })

  it("carries session/validate at kind prompt when supplied", () => {
    const session = { id: "8f2c", resume: true }
    const demand = demandOf({
      rendered: rendered(),
      kind: "prompt",
      session,
      validate: "gtd check qa 'TODO.md'",
    })
    expect(demand.kind).toBe("prompt")
    if (demand.kind !== "prompt") throw new Error("unreachable")
    expect(demand.session).toEqual(session)
    expect(demand.validate).toBe("gtd check qa 'TODO.md'")
  })

  it("carries session/validate present-with-undefined (not omitted) at kind prompt when the caller supplied none", () => {
    const demand = demandOf({ rendered: rendered(), kind: "prompt" })
    expect(demand.kind).toBe("prompt")
    if (demand.kind !== "prompt") throw new Error("unreachable")
    expect("session" in demand).toBe(true)
    expect(demand.session).toBeUndefined()
    expect("validate" in demand).toBe(true)
    expect(demand.validate).toBeUndefined()
  })
})
