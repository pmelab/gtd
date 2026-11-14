import { describe, expect, it } from "vitest"
import { BEAT_KINDS, beatKindOf, demandOf, stallDiagnosis } from "./Demand.js"
import type { RenderedDemandSource } from "./index.js"

const rendered = (overrides: Partial<RenderedDemandSource> = {}): RenderedDemandSource => ({
  state: "build.fixing",
  actor: "agent",
  content: "fix it",
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
  it("names the step and mentions both escapes", () => {
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

  it("carries session only on the prompt variant — no other kind's Demand shape can hold it", () => {
    const session = { id: "8f2c", resume: true }
    for (const kind of BEAT_KINDS.filter((k) => k !== "prompt")) {
      expect("session" in demandOf({ rendered: rendered(), kind, session })).toBe(false)
    }
  })

  it("carries session at kind prompt when supplied, and present-with-undefined when not", () => {
    const session = { id: "8f2c", resume: true }
    const demand = demandOf({ rendered: rendered(), kind: "prompt", session })
    if (demand.kind !== "prompt") throw new Error("unreachable")
    expect(demand.session).toEqual(session)
    const bare = demandOf({ rendered: rendered(), kind: "prompt" })
    if (bare.kind !== "prompt") throw new Error("unreachable")
    expect("session" in bare).toBe(true)
    expect(bare.session).toBeUndefined()
  })

  it("carries skills at kind prompt when the rendered source has a non-empty list", () => {
    const demand = demandOf({ rendered: rendered({ skills: ["a", "b"] }), kind: "prompt" })
    expect(demand.kind).toBe("prompt")
    if (demand.kind !== "prompt") throw new Error("unreachable")
    expect(demand.skills).toEqual(["a", "b"])
  })

  it("normalizes an empty or absent skills list to undefined at kind prompt, never []", () => {
    const empty = demandOf({ rendered: rendered({ skills: [] }), kind: "prompt" })
    const absent = demandOf({ rendered: rendered(), kind: "prompt" })
    if (empty.kind !== "prompt" || absent.kind !== "prompt") throw new Error("unreachable")
    expect(empty.skills).toBeUndefined()
    expect(absent.skills).toBeUndefined()
  })

  it("carries access at kind prompt, unrestricted on both sides when the source has none", () => {
    const bare = demandOf({ rendered: rendered(), kind: "prompt" })
    const restricted = demandOf({
      rendered: rendered({ access: { read: ["docs/**"], write: [] } }),
      kind: "prompt",
    })
    if (bare.kind !== "prompt" || restricted.kind !== "prompt") throw new Error("unreachable")
    expect(bare.access).toEqual({ read: null, write: null })
    expect(restricted.access).toEqual({ read: ["docs/**"], write: [] })
  })

  it("carries no access field at any non-prompt kind", () => {
    for (const kind of BEAT_KINDS.filter((k) => k !== "prompt")) {
      const demand = demandOf({ rendered: rendered({ access: { read: null, write: [] } }), kind })
      expect("access" in demand).toBe(false)
    }
  })

  it("carries no skills field at any non-prompt kind, even when the rendered source has one", () => {
    for (const kind of BEAT_KINDS.filter((k) => k !== "prompt")) {
      const demand = demandOf({ rendered: rendered({ skills: ["a"] }), kind })
      expect("skills" in demand).toBe(false)
    }
  })
})
