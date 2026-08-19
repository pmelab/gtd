import { describe, expect, it } from "vitest"
import { beatDocument, beatKindOf, stallDiagnosis, type BeatKind, type NextMatch } from "./Beat.js"
import type { ModelCost, RenderedRest } from "./Edge.js"

/** The four status-shape fields every `beatDocument` call must now carry — factored so each test only overrides what it's testing. */
const statusFields = (
  overrides: {
    readonly changes?: readonly {
      readonly status: string
      readonly path: string
      readonly pattern: string | null
    }[]
    readonly next?: NextMatch | null
    readonly cost?: number
    readonly costByModel?: readonly ModelCost[]
  } = {},
) => ({
  changes: overrides.changes ?? [],
  next: overrides.next ?? null,
  cost: overrides.cost ?? 0,
  costByModel: overrides.costByModel ?? [],
})

const rest = (overrides: Partial<RenderedRest> = {}): RenderedRest => ({
  state: "build.fixing",
  actor: "agent",
  kind: "prompt",
  content: "fix it",
  memoryResumed: false,
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
    expect(text).toMatch(/retry:/)
    expect(text).toMatch(/"C" pattern/)
    expect(text).toMatch(/prompt so the turn has something concrete/)
  })
})

describe("beatDocument", () => {
  it("emits the unconditional fields plus the resolved kind and content", () => {
    const line = beatDocument({
      rendered: rest({ kind: "script" }),
      kind: "script",
      log: ".git/gtd-loop.log",
      ...statusFields(),
    })
    expect(JSON.parse(line)).toEqual({
      kind: "script",
      content: "fix it",
      log: ".git/gtd-loop.log",
      state: "build.fixing",
      actor: "agent",
      changes: [],
      next: null,
    })
  })

  it("uses the stall diagnosis as content, never the rendered content, at kind stalled", () => {
    const line = beatDocument({ rendered: rest(), kind: "stalled", log: "log", ...statusFields() })
    const parsed = JSON.parse(line) as { content: string }
    expect(parsed.content).toBe(stallDiagnosis("build.fixing", "agent"))
    expect(parsed.content).not.toBe("fix it")
  })

  it("gates session/validate to kind prompt, dropping them at every other kind", () => {
    const session = { id: "8f2c", resume: true }
    for (const kind of [
      "capture",
      "message",
      "script",
      "stalled",
    ] as const satisfies readonly BeatKind[]) {
      const line = beatDocument({
        rendered: rest(),
        kind,
        log: "log",
        session,
        validate: "gtd check qa 'TODO.md'",
        changes: [],
        next: null,
        cost: 0,
        costByModel: [],
      })
      const parsed = JSON.parse(line) as Record<string, unknown>
      expect(parsed.session).toBeUndefined()
      expect(parsed.validate).toBeUndefined()
    }
  })

  it("emits session and validate at kind prompt", () => {
    const session = { id: "8f2c", resume: true }
    const line = beatDocument({
      rendered: rest(),
      kind: "prompt",
      log: "log",
      session,
      validate: "gtd check qa 'TODO.md'",
      ...statusFields(),
    })
    const parsed = JSON.parse(line) as Record<string, unknown>
    expect(parsed.session).toEqual({ id: "8f2c", resume: true })
    expect(parsed.validate).toBe("gtd check qa 'TODO.md'")
  })

  it("omits session/validate at kind prompt when the caller supplied none, never emitting null", () => {
    const line = beatDocument({ rendered: rest(), kind: "prompt", log: "log", ...statusFields() })
    const parsed = JSON.parse(line) as Record<string, unknown>
    expect("session" in parsed).toBe(false)
    expect("validate" in parsed).toBe(false)
  })

  it("emits model/memory/file/mode/label/edges at every kind when present, never null", () => {
    const rendered = rest({
      kind: "script",
      model: "opus",
      memory: "build#a1b2c3d",
      file: "TODO.md",
      mode: "qa",
      label: "Fixing",
      edges: [{ pattern: "C", target: "idle" }],
    })
    for (const kind of [
      "capture",
      "message",
      "script",
      "prompt",
      "stalled",
    ] as const satisfies readonly BeatKind[]) {
      // `next: null` is a legitimate literal here (statusFields()'s default,
      // no match) — the "never null" claim in this test's title is about the
      // OPTIONAL fields under test (model/memory/file/mode/label/edges), not
      // about `next`, which is always present as an object or `null`.
      const line = beatDocument({ rendered, kind, log: "log", ...statusFields() })
      const parsed = JSON.parse(line) as Record<string, unknown>
      expect(parsed.model).toBe("opus")
      expect(parsed.memory).toBe("build#a1b2c3d")
      expect(parsed.file).toBe("TODO.md")
      expect(parsed.mode).toBe("qa")
      expect(parsed.label).toBe("Fixing")
      expect(parsed.edges).toEqual([{ pattern: "C", target: "idle" }])
    }
  })

  it("omits optional fields entirely (not undefined/null) when unset", () => {
    const line = beatDocument({ rendered: rest(), kind: "script", log: "log", ...statusFields() })
    const parsed = JSON.parse(line) as Record<string, unknown>
    for (const key of [
      "session",
      "model",
      "validate",
      "label",
      "memory",
      "file",
      "mode",
      "edges",
      "cost",
      "costByModel",
    ]) {
      expect(key in parsed).toBe(false)
    }
  })

  it("emits keys in the documented order", () => {
    const rendered = rest({
      kind: "prompt",
      model: "opus",
      memory: "build#a1b2c3d",
      file: "TODO.md",
      mode: "qa",
      label: "Fixing",
      edges: [{ pattern: "C", target: "idle" }],
    })
    const line = beatDocument({
      rendered,
      kind: "prompt",
      log: ".git/gtd-loop.log",
      session: { id: "8f2c", resume: true },
      validate: "gtd check qa 'TODO.md'",
      changes: [{ status: "M", path: "TODO.md", pattern: null }],
      next: { action: undefined, pattern: "C", target: "idle" },
      cost: 12,
      costByModel: [{ model: "opus", cost: 12 }],
    })
    const keys = Object.keys(JSON.parse(line) as Record<string, unknown>)
    expect(keys).toEqual([
      "kind",
      "content",
      "session",
      "model",
      "validate",
      "log",
      "state",
      "actor",
      "label",
      "memory",
      "file",
      "mode",
      "edges",
      "changes",
      "next",
      "cost",
      "costByModel",
    ])
  })

  it("ends with a trailing newline", () => {
    const line = beatDocument({ rendered: rest(), kind: "script", log: "log", ...statusFields() })
    expect(line.endsWith("\n")).toBe(true)
  })

  it("carries changes verbatim, always present even when empty", () => {
    const changes = [
      { status: "M", path: "TODO.md", pattern: "TODO.md" },
      { status: "A", path: "REVIEW.md", pattern: null },
    ]
    const line = beatDocument({
      rendered: rest(),
      kind: "prompt",
      log: "log",
      ...statusFields({ changes }),
    })
    const parsed = JSON.parse(line) as { changes: unknown }
    expect(parsed.changes).toEqual(changes)
  })

  it("carries next as null on no match, an object (action omitted when absent) on a match", () => {
    const noMatch = beatDocument({
      rendered: rest(),
      kind: "prompt",
      log: "log",
      ...statusFields(),
    })
    expect((JSON.parse(noMatch) as { next: unknown }).next).toBeNull()

    const matched = beatDocument({
      rendered: rest(),
      kind: "prompt",
      log: "log",
      ...statusFields({ next: { action: undefined, pattern: "C", target: "idle" } }),
    })
    const parsedMatch = JSON.parse(matched) as { next: Record<string, unknown> }
    expect(parsedMatch.next).toEqual({ pattern: "C", target: "idle" })
    expect("action" in parsedMatch.next).toBe(false)

    const matchedWithAction = beatDocument({
      rendered: rest(),
      kind: "prompt",
      log: "log",
      ...statusFields({ next: { action: "land", pattern: "C", target: "idle" } }),
    })
    const parsedAction = JSON.parse(matchedWithAction) as { next: Record<string, unknown> }
    expect(parsedAction.next).toEqual({ action: "land", pattern: "C", target: "idle" })
  })

  it("omits cost/costByModel when cost is zero, emits both when a cost was recorded", () => {
    const noCost = beatDocument({ rendered: rest(), kind: "prompt", log: "log", ...statusFields() })
    const parsedNoCost = JSON.parse(noCost) as Record<string, unknown>
    expect("cost" in parsedNoCost).toBe(false)
    expect("costByModel" in parsedNoCost).toBe(false)

    const withCost = beatDocument({
      rendered: rest(),
      kind: "prompt",
      log: "log",
      ...statusFields({ cost: 42, costByModel: [{ model: "opus", cost: 42 }] }),
    })
    const parsedWithCost = JSON.parse(withCost) as Record<string, unknown>
    expect(parsedWithCost.cost).toBe(42)
    expect(parsedWithCost.costByModel).toEqual([{ model: "opus", cost: 42 }])
  })

  it("carries no version key", () => {
    const line = beatDocument({ rendered: rest(), kind: "prompt", log: "log", ...statusFields() })
    expect("version" in (JSON.parse(line) as Record<string, unknown>)).toBe(false)
  })
})
