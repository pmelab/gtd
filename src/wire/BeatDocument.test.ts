import { describe, expect, it } from "vitest"
import { beatDocument, renderBeatJson } from "./BeatDocument.js"
import { BEAT_KINDS, demandOf, stallDiagnosis, type BeatKind } from "./Demand.js"
import { statusOf, type NextMatch, type StatusChange } from "./BeatStatus.js"
import { DEMAND_BRIEFING, renderBeatPlain } from "./BeatPlain.js"
import type { ModelCost, RenderedDemandSource } from "./types.js"

const rendered = (overrides: Partial<RenderedDemandSource> = {}): RenderedDemandSource => ({
  state: "build.fixing",
  actor: "agent",
  content: "fix it",
  edges: [],
  ...overrides,
})

interface DocumentInput {
  readonly rendered?: RenderedDemandSource
  readonly kind: BeatKind
  readonly idle?: boolean
  readonly log?: string
  readonly session?: { readonly id: string; readonly resume: boolean }
  readonly validate?: string
  readonly changes?: readonly StatusChange[]
  readonly next?: NextMatch | null
  readonly cost?: number
  readonly costByModel?: readonly ModelCost[]
}

/** `demandOf`'s own input, isolated so `documentFor` stays a flat two-call body — `session`/`validate` are only spread in when the caller actually passed one, since `demandOf`'s `prompt` variant forbids an explicit `undefined`. */
const demandInput = (
  input: DocumentInput,
  r: RenderedDemandSource,
): Parameters<typeof demandOf>[0] => ({
  rendered: r,
  kind: input.kind,
  ...(input.session !== undefined ? { session: input.session } : {}),
  ...(input.validate !== undefined ? { validate: input.validate } : {}),
})

/** `statusOf`'s own input, isolated for the same reason as `demandInput` above. */
const statusInput = (
  input: DocumentInput,
  r: RenderedDemandSource,
): Parameters<typeof statusOf>[0] => ({
  rendered: r,
  idle: input.idle ?? false,
  log: input.log ?? "log",
  changes: input.changes ?? [],
  next: input.next ?? null,
  cost: input.cost ?? 0,
  costByModel: input.costByModel ?? [],
})

/** Builds one full `BeatDocument` in one call, mirroring the pre-split `beatFields` call shape so every golden below reads the same as before this package. */
const documentFor = (input: DocumentInput) => {
  const r = input.rendered ?? rendered()
  return beatDocument(demandOf(demandInput(input, r)), statusOf(statusInput(input, r)))
}

const renderJsonLine = (input: Parameters<typeof documentFor>[0]): string =>
  renderBeatJson(documentFor(input))

describe("beatDocument / renderBeatJson", () => {
  it("emits the unconditional fields plus the resolved kind and content", () => {
    const line = renderJsonLine({ rendered: rendered(), kind: "script", log: ".git/gtd-loop.log" })
    expect(JSON.parse(line)).toEqual({
      kind: "script",
      content: "fix it",
      idle: false,
      log: ".git/gtd-loop.log",
      state: "build.fixing",
      actor: "agent",
      changes: [],
      next: null,
    })
  })

  it("uses the stall diagnosis as content, never the rendered content, at kind stalled", () => {
    const line = renderJsonLine({ rendered: rendered(), kind: "stalled" })
    const parsed = JSON.parse(line) as { content: string }
    expect(parsed.content).toBe(stallDiagnosis("build.fixing", "agent"))
    expect(parsed.content).not.toBe("fix it")
  })

  it("gates session/validate to kind prompt, dropping them at every other kind", () => {
    const session = { id: "8f2c", resume: true }
    for (const kind of BEAT_KINDS.filter((k) => k !== "prompt")) {
      const line = renderJsonLine({
        kind,
        session,
        validate: "gtd check qa 'TODO.md'",
      })
      const parsed = JSON.parse(line) as Record<string, unknown>
      expect(parsed.session).toBeUndefined()
      expect(parsed.validate).toBeUndefined()
    }
  })

  it("emits session and validate at kind prompt", () => {
    const session = { id: "8f2c", resume: true }
    const line = renderJsonLine({ kind: "prompt", session, validate: "gtd check qa 'TODO.md'" })
    const parsed = JSON.parse(line) as Record<string, unknown>
    expect(parsed.session).toEqual({ id: "8f2c", resume: true })
    expect(parsed.validate).toBe("gtd check qa 'TODO.md'")
  })

  it("omits session/validate at kind prompt when the caller supplied none, never emitting null", () => {
    const line = renderJsonLine({ kind: "prompt" })
    const parsed = JSON.parse(line) as Record<string, unknown>
    expect("session" in parsed).toBe(false)
    expect("validate" in parsed).toBe(false)
  })

  it("emits model/system/memory/file/mode/label/edges at every kind when present, never null", () => {
    const r = rendered({
      model: "opus",
      system: "You are a careful senior engineer.",
      memory: "build#a1b2c3d",
      file: "TODO.md",
      mode: "qa",
      label: "Fixing",
      edges: [{ pattern: "C", target: "idle" }],
    })
    for (const kind of BEAT_KINDS) {
      const line = renderJsonLine({ rendered: r, kind })
      const parsed = JSON.parse(line) as Record<string, unknown>
      expect(parsed.model).toBe("opus")
      expect(parsed.system).toBe("You are a careful senior engineer.")
      expect(parsed.memory).toBe("build#a1b2c3d")
      expect(parsed.file).toBe("TODO.md")
      expect(parsed.mode).toBe("qa")
      expect(parsed.label).toBe("Fixing")
      expect(parsed.edges).toEqual([{ pattern: "C", target: "idle" }])
    }
  })

  it("omits system when its rendered value is the empty string, unlike model which carries an empty string through", () => {
    const line = renderJsonLine({ rendered: rendered({ model: "", system: "" }), kind: "prompt" })
    const parsed = JSON.parse(line) as Record<string, unknown>
    expect("system" in parsed).toBe(false)
    expect(parsed.model).toBe("")
  })

  it("omits optional fields entirely (not undefined/null) when unset", () => {
    const line = renderJsonLine({ kind: "script" })
    const parsed = JSON.parse(line) as Record<string, unknown>
    for (const key of [
      "session",
      "model",
      "system",
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
    const r = rendered({
      model: "opus",
      system: "You are a careful senior engineer.",
      memory: "build#a1b2c3d",
      file: "TODO.md",
      mode: "qa",
      label: "Fixing",
      edges: [{ pattern: "C", target: "idle" }],
    })
    const line = renderJsonLine({
      rendered: r,
      kind: "prompt",
      idle: false,
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
      "idle",
      "session",
      "model",
      "system",
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
    expect(renderJsonLine({ kind: "script" }).endsWith("\n")).toBe(true)
  })

  it("carries changes verbatim, always present even when empty", () => {
    const changes = [
      { status: "M", path: "TODO.md", pattern: "TODO.md" },
      { status: "A", path: "REVIEW.md", pattern: null },
    ]
    const line = renderJsonLine({ kind: "prompt", changes })
    const parsed = JSON.parse(line) as { changes: unknown }
    expect(parsed.changes).toEqual(changes)
  })

  it("carries next as null on no match, an object (action omitted when absent) on a match", () => {
    const noMatch = renderJsonLine({ kind: "prompt" })
    expect((JSON.parse(noMatch) as { next: unknown }).next).toBeNull()

    const matched = renderJsonLine({
      kind: "prompt",
      next: { action: undefined, pattern: "C", target: "idle" },
    })
    const parsedMatch = JSON.parse(matched) as { next: Record<string, unknown> }
    expect(parsedMatch.next).toEqual({ pattern: "C", target: "idle" })
    expect("action" in parsedMatch.next).toBe(false)

    const matchedWithAction = renderJsonLine({
      kind: "prompt",
      next: { action: "land", pattern: "C", target: "idle" },
    })
    const parsedAction = JSON.parse(matchedWithAction) as { next: Record<string, unknown> }
    expect(parsedAction.next).toEqual({ action: "land", pattern: "C", target: "idle" })
  })

  it("omits cost/costByModel when cost is zero, emits both when a cost was recorded", () => {
    const noCost = renderJsonLine({ kind: "prompt" })
    const parsedNoCost = JSON.parse(noCost) as Record<string, unknown>
    expect("cost" in parsedNoCost).toBe(false)
    expect("costByModel" in parsedNoCost).toBe(false)

    const withCost = renderJsonLine({
      kind: "prompt",
      cost: 42,
      costByModel: [{ model: "opus", cost: 42 }],
    })
    const parsedWithCost = JSON.parse(withCost) as Record<string, unknown>
    expect(parsedWithCost.cost).toBe(42)
    expect(parsedWithCost.costByModel).toEqual([{ model: "opus", cost: 42 }])
  })

  it("carries no version key", () => {
    const line = renderJsonLine({ kind: "prompt" })
    expect("version" in (JSON.parse(line) as Record<string, unknown>)).toBe(false)
  })
})

describe("golden: one byte-for-byte document per BeatKind", () => {
  const fullRendered = rendered({
    model: "opus",
    system: "You are a careful senior engineer.",
    memory: "build#a1b2c3d",
    file: "TODO.md",
    mode: "qa",
    label: "Fixing",
    edges: [{ pattern: "C", target: "idle", describe: "clean tree" }],
  })
  const commonInput = {
    rendered: fullRendered,
    idle: false,
    log: ".git/gtd-loop.log",
    changes: [{ status: "M", path: "TODO.md", pattern: "TODO.md" }],
    next: { action: "land", pattern: "C", target: "idle" },
    cost: 12,
    costByModel: [{ model: "opus", cost: 12 }],
  }

  it("kind capture", () => {
    const line = renderBeatJson(documentFor({ ...commonInput, kind: "capture" }))
    expect(line).toBe(
      JSON.stringify({
        kind: "capture",
        content: "fix it",
        idle: false,
        model: "opus",
        system: "You are a careful senior engineer.",
        log: ".git/gtd-loop.log",
        state: "build.fixing",
        actor: "agent",
        label: "Fixing",
        memory: "build#a1b2c3d",
        file: "TODO.md",
        mode: "qa",
        edges: [{ pattern: "C", target: "idle", describe: "clean tree" }],
        changes: [{ status: "M", path: "TODO.md", pattern: "TODO.md" }],
        next: { action: "land", pattern: "C", target: "idle" },
        cost: 12,
        costByModel: [{ model: "opus", cost: 12 }],
      }) + "\n",
    )
  })

  it("kind message", () => {
    const line = renderBeatJson(documentFor({ ...commonInput, kind: "message" }))
    expect(line).toBe(
      JSON.stringify({
        kind: "message",
        content: "fix it",
        idle: false,
        model: "opus",
        system: "You are a careful senior engineer.",
        log: ".git/gtd-loop.log",
        state: "build.fixing",
        actor: "agent",
        label: "Fixing",
        memory: "build#a1b2c3d",
        file: "TODO.md",
        mode: "qa",
        edges: [{ pattern: "C", target: "idle", describe: "clean tree" }],
        changes: [{ status: "M", path: "TODO.md", pattern: "TODO.md" }],
        next: { action: "land", pattern: "C", target: "idle" },
        cost: 12,
        costByModel: [{ model: "opus", cost: 12 }],
      }) + "\n",
    )
  })

  it("kind script", () => {
    const line = renderBeatJson(documentFor({ ...commonInput, kind: "script" }))
    expect(line).toBe(
      JSON.stringify({
        kind: "script",
        content: "fix it",
        idle: false,
        model: "opus",
        system: "You are a careful senior engineer.",
        log: ".git/gtd-loop.log",
        state: "build.fixing",
        actor: "agent",
        label: "Fixing",
        memory: "build#a1b2c3d",
        file: "TODO.md",
        mode: "qa",
        edges: [{ pattern: "C", target: "idle", describe: "clean tree" }],
        changes: [{ status: "M", path: "TODO.md", pattern: "TODO.md" }],
        next: { action: "land", pattern: "C", target: "idle" },
        cost: 12,
        costByModel: [{ model: "opus", cost: 12 }],
      }) + "\n",
    )
  })

  it("kind prompt", () => {
    const line = renderBeatJson(
      documentFor({
        ...commonInput,
        kind: "prompt",
        session: { id: "8f2c", resume: true },
        validate: "gtd check qa 'TODO.md'",
      }),
    )
    expect(line).toBe(
      JSON.stringify({
        kind: "prompt",
        content: "fix it",
        idle: false,
        session: { id: "8f2c", resume: true },
        model: "opus",
        system: "You are a careful senior engineer.",
        validate: "gtd check qa 'TODO.md'",
        log: ".git/gtd-loop.log",
        state: "build.fixing",
        actor: "agent",
        label: "Fixing",
        memory: "build#a1b2c3d",
        file: "TODO.md",
        mode: "qa",
        edges: [{ pattern: "C", target: "idle", describe: "clean tree" }],
        changes: [{ status: "M", path: "TODO.md", pattern: "TODO.md" }],
        next: { action: "land", pattern: "C", target: "idle" },
        cost: 12,
        costByModel: [{ model: "opus", cost: 12 }],
      }) + "\n",
    )
  })

  it("kind stalled", () => {
    const line = renderBeatJson(documentFor({ ...commonInput, kind: "stalled" }))
    expect(line).toBe(
      JSON.stringify({
        kind: "stalled",
        content: stallDiagnosis("build.fixing", "agent"),
        idle: false,
        model: "opus",
        system: "You are a careful senior engineer.",
        log: ".git/gtd-loop.log",
        state: "build.fixing",
        actor: "agent",
        label: "Fixing",
        memory: "build#a1b2c3d",
        file: "TODO.md",
        mode: "qa",
        edges: [{ pattern: "C", target: "idle", describe: "clean tree" }],
        changes: [{ status: "M", path: "TODO.md", pattern: "TODO.md" }],
        next: { action: "land", pattern: "C", target: "idle" },
        cost: 12,
        costByModel: [{ model: "opus", cost: 12 }],
      }) + "\n",
    )
  })

  it("renderBeatJson output for a rest with absent optionals is byte-identical to the pre-refactor golden bytes", () => {
    const line = renderJsonLine({ rendered: rendered(), kind: "script", log: ".git/gtd-loop.log" })
    expect(line).toBe(
      JSON.stringify({
        kind: "script",
        content: "fix it",
        idle: false,
        log: ".git/gtd-loop.log",
        state: "build.fixing",
        actor: "agent",
        changes: [],
        next: null,
      }) + "\n",
    )
  })
})

/**
 * ONE test, looping the ONE kind list (`BEAT_KINDS`, exported from
 * `Demand.ts`), covering all three places a `BeatKind` must be handled:
 * `beatDocument` (the JSON side, via `dispatchFieldsOf`'s exhaustive switch),
 * `DEMAND_BRIEFING` (the plain-render briefing table), and `renderBeatPlain`
 * itself (whether the status header is actually suppressed). Replaces the
 * three previously hand-maintained kind lists (this file's own literal, plus
 * one each in `Demand.test.ts` and `BeatPlain.test.ts`) with the single
 * source `Demand.ts` now exports — a sixth `BeatKind` member is caught here
 * (a missing `DEMAND_BRIEFING`/`dispatchFieldsOf` entry fails `tsc` first,
 * before this test can even run) as well as by this loop actually exercising
 * every member.
 */
describe("exhaustiveness over Demand/BeatKind", () => {
  it("BeatKind is exactly the five documented members", () => {
    expect([...BEAT_KINDS].sort()).toEqual(["capture", "message", "prompt", "script", "stalled"])
  })

  it("every kind: produces a document, has a DEMAND_BRIEFING entry, and the plain header is shown iff the briefing doesn't suppress it", () => {
    for (const kind of BEAT_KINDS) {
      const document = documentFor({ kind })
      expect(() => renderBeatJson(document)).not.toThrow()
      expect(document.kind).toBe(kind)

      const briefing = DEMAND_BRIEFING[kind]
      expect(briefing).toBeDefined()

      const plain = renderBeatPlain(document)
      expect(plain.includes("State: ")).toBe(!briefing.suppressHeader)
      if (briefing.instructionLine !== undefined) {
        expect(plain.startsWith(`${briefing.instructionLine}\n`)).toBe(true)
      }
    }
  })
})
