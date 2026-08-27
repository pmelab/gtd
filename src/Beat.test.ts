import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  beatFields,
  beatKindOf,
  landFields,
  landProseText,
  noopText,
  renderBeatJson,
  renderBeatPlain,
  renderLandJson,
  renderLandPlain,
  stallDiagnosis,
  type BeatFields,
  type BeatKind,
  type LandFields,
  type NextMatch,
} from "./Beat.js"
import type { ModelCost, RenderedRest } from "./Edge.js"

/** `renderBeatJson(beatFields(input))`, composed once so the pre-existing per-call-site assertions below (each pinning the JSON shape/order `beatFields`/`renderBeatJson` must produce) exercise the real two-function split byte-for-byte. */
const renderBeatJsonLine = (input: Parameters<typeof beatFields>[0]): string =>
  renderBeatJson(beatFields(input))

/** The four status-shape fields every `renderBeatJsonLine` call must now carry — factored so each test only overrides what it's testing. */
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
    readonly idle?: boolean
  } = {},
) => ({
  idle: overrides.idle ?? false,
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

describe("renderBeatJsonLine", () => {
  it("emits the unconditional fields plus the resolved kind and content", () => {
    const line = renderBeatJsonLine({
      rendered: rest({ kind: "script" }),
      kind: "script",
      log: ".git/gtd-loop.log",
      ...statusFields(),
    })
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
    const line = renderBeatJsonLine({
      rendered: rest(),
      kind: "stalled",
      log: "log",
      ...statusFields(),
    })
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
      const line = renderBeatJsonLine({
        rendered: rest(),
        kind,
        idle: false,
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
    const line = renderBeatJsonLine({
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
    const line = renderBeatJsonLine({
      rendered: rest(),
      kind: "prompt",
      log: "log",
      ...statusFields(),
    })
    const parsed = JSON.parse(line) as Record<string, unknown>
    expect("session" in parsed).toBe(false)
    expect("validate" in parsed).toBe(false)
  })

  it("emits model/system/memory/file/mode/label/edges at every kind when present, never null", () => {
    const rendered = rest({
      kind: "script",
      model: "opus",
      system: "You are a careful senior engineer.",
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
      // OPTIONAL fields under test (model/system/memory/file/mode/label/edges),
      // not about `next`, which is always present as an object or `null`.
      const line = renderBeatJsonLine({ rendered, kind, log: "log", ...statusFields() })
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
    const rendered = rest({ kind: "prompt", model: "", system: "" })
    const line = renderBeatJsonLine({ rendered, kind: "prompt", log: "log", ...statusFields() })
    const parsed = JSON.parse(line) as Record<string, unknown>
    expect("system" in parsed).toBe(false)
    expect(parsed.model).toBe("")
  })

  it("omits optional fields entirely (not undefined/null) when unset", () => {
    const line = renderBeatJsonLine({
      rendered: rest(),
      kind: "script",
      log: "log",
      ...statusFields(),
    })
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
    const rendered = rest({
      kind: "prompt",
      model: "opus",
      system: "You are a careful senior engineer.",
      memory: "build#a1b2c3d",
      file: "TODO.md",
      mode: "qa",
      label: "Fixing",
      edges: [{ pattern: "C", target: "idle" }],
    })
    const line = renderBeatJsonLine({
      rendered,
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
    const line = renderBeatJsonLine({
      rendered: rest(),
      kind: "script",
      log: "log",
      ...statusFields(),
    })
    expect(line.endsWith("\n")).toBe(true)
  })

  it("carries changes verbatim, always present even when empty", () => {
    const changes = [
      { status: "M", path: "TODO.md", pattern: "TODO.md" },
      { status: "A", path: "REVIEW.md", pattern: null },
    ]
    const line = renderBeatJsonLine({
      rendered: rest(),
      kind: "prompt",
      log: "log",
      ...statusFields({ changes }),
    })
    const parsed = JSON.parse(line) as { changes: unknown }
    expect(parsed.changes).toEqual(changes)
  })

  it("carries next as null on no match, an object (action omitted when absent) on a match", () => {
    const noMatch = renderBeatJsonLine({
      rendered: rest(),
      kind: "prompt",
      log: "log",
      ...statusFields(),
    })
    expect((JSON.parse(noMatch) as { next: unknown }).next).toBeNull()

    const matched = renderBeatJsonLine({
      rendered: rest(),
      kind: "prompt",
      log: "log",
      ...statusFields({ next: { action: undefined, pattern: "C", target: "idle" } }),
    })
    const parsedMatch = JSON.parse(matched) as { next: Record<string, unknown> }
    expect(parsedMatch.next).toEqual({ pattern: "C", target: "idle" })
    expect("action" in parsedMatch.next).toBe(false)

    const matchedWithAction = renderBeatJsonLine({
      rendered: rest(),
      kind: "prompt",
      log: "log",
      ...statusFields({ next: { action: "land", pattern: "C", target: "idle" } }),
    })
    const parsedAction = JSON.parse(matchedWithAction) as { next: Record<string, unknown> }
    expect(parsedAction.next).toEqual({ action: "land", pattern: "C", target: "idle" })
  })

  it("omits cost/costByModel when cost is zero, emits both when a cost was recorded", () => {
    const noCost = renderBeatJsonLine({
      rendered: rest(),
      kind: "prompt",
      log: "log",
      ...statusFields(),
    })
    const parsedNoCost = JSON.parse(noCost) as Record<string, unknown>
    expect("cost" in parsedNoCost).toBe(false)
    expect("costByModel" in parsedNoCost).toBe(false)

    const withCost = renderBeatJsonLine({
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
    const line = renderBeatJsonLine({
      rendered: rest(),
      kind: "prompt",
      log: "log",
      ...statusFields(),
    })
    expect("version" in (JSON.parse(line) as Record<string, unknown>)).toBe(false)
  })

  it("golden: a fully-populated rest renders one exact, byte-identical JSON line through beatFields + renderBeatJson", () => {
    const rendered = rest({
      kind: "prompt",
      model: "opus",
      system: "You are a careful senior engineer.",
      memory: "build#a1b2c3d",
      file: "TODO.md",
      mode: "qa",
      label: "Fixing",
      edges: [{ pattern: "C", target: "idle", describe: "clean tree" }],
    })
    const line = renderBeatJson(
      beatFields({
        rendered,
        kind: "prompt",
        idle: false,
        log: ".git/gtd-loop.log",
        session: { id: "8f2c", resume: true },
        validate: "gtd check qa 'TODO.md'",
        changes: [{ status: "M", path: "TODO.md", pattern: "TODO.md" }],
        next: { action: "land", pattern: "C", target: "idle" },
        cost: 12,
        costByModel: [{ model: "opus", cost: 12 }],
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
})

describe("idle", () => {
  it("is always present in JSON as a real boolean, never null", () => {
    const idleTrue = renderBeatJsonLine({
      rendered: rest({ kind: "message" }),
      kind: "message",
      log: "log",
      ...statusFields({ idle: true }),
    })
    expect((JSON.parse(idleTrue) as { idle: unknown }).idle).toBe(true)

    const idleFalse = renderBeatJsonLine({
      rendered: rest({ kind: "message" }),
      kind: "message",
      log: "log",
      ...statusFields({ idle: false }),
    })
    expect((JSON.parse(idleFalse) as { idle: unknown }).idle).toBe(false)
  })

  it("is the third JSON key", () => {
    const line = renderBeatJsonLine({
      rendered: rest({ kind: "message" }),
      kind: "message",
      log: "log",
      ...statusFields({ idle: true }),
    })
    const keys = Object.keys(JSON.parse(line) as Record<string, unknown>)
    expect(keys.slice(0, 3)).toEqual(["kind", "content", "idle"])
  })
})

describe("renderBeatPlain", () => {
  const fieldsFor = (
    kind: BeatKind,
    contentKind: RenderedRest["kind"],
    content: string,
  ): BeatFields =>
    beatFields({
      rendered: rest({ kind: contentKind, content }),
      kind,
      idle: false,
      log: "log",
      changes: [{ status: "M", path: "TODO.md", pattern: "TODO.md" }],
      next: { action: undefined, pattern: "C", target: "idle" },
      cost: 0,
      costByModel: [],
    })

  const HEADER =
    "State: build.fixing\nAwaits: agent\nPending:\n  M TODO.md -> TODO.md\nNext: C → idle"

  it("prepends the run instruction, then shows header, blank line, content verbatim at kind script", () => {
    const fields = fieldsFor("script", "script", "npm test")
    expect(renderBeatPlain(fields)).toBe(`Run this script:\n${HEADER}\n\nnpm test\n`)
  })

  it("shows header, blank line, content verbatim at kind message — no instruction line", () => {
    const fields = fieldsFor("message", "message", "write NOTE.md")
    expect(renderBeatPlain(fields)).toBe(`${HEADER}\n\nwrite NOTE.md\n`)
  })

  it("prepends prose stating the edit is already made and gtd land will land it, at kind capture", () => {
    const fields = fieldsFor("capture", "message", "already edited")
    const plain = renderBeatPlain(fields)
    expect(plain).toBe(
      `The edit is already made — run \`gtd land\` to land it.\n${HEADER}\n\nalready edited\n`,
    )
    expect(plain).toMatch(/already made/)
    expect(plain).toContain("gtd land")
  })

  it("shows header, blank line, the stall diagnosis (never the rendered content) at kind stalled", () => {
    const fields = fieldsFor("stalled", "prompt", "would-be prompt")
    const plain = renderBeatPlain(fields)
    expect(plain.startsWith(`${HEADER}\n\n`)).toBe(true)
    expect(plain).toContain('stalled at "build.fixing"')
    expect(plain).not.toContain("would-be prompt")
  })

  it("a stalled beat at a prompt state whose machine declares system: prints its stall diagnosis with no System: line and no persona text", () => {
    const fields = beatFields({
      rendered: rest({ kind: "prompt", system: "You are a careful senior engineer." }),
      kind: "stalled",
      idle: false,
      log: "log",
      changes: [{ status: "M", path: "TODO.md", pattern: "TODO.md" }],
      next: { action: undefined, pattern: "C", target: "idle" },
      cost: 0,
      costByModel: [],
    })
    const plain = renderBeatPlain(fields)
    expect(plain).not.toContain("System:")
    expect(plain).not.toContain("You are a careful senior engineer.")
  })

  it("drops the header entirely at kind prompt, emitting bare content — no self-validate command given", () => {
    const fields = fieldsFor("prompt", "prompt", "fix the bug")
    expect(renderBeatPlain(fields)).toBe("fix the bug\n")
  })

  it("at kind prompt, appends the self-validation instruction when a command is given", () => {
    const fields = beatFields({
      rendered: rest({ kind: "prompt", content: "fix the bug", file: "TODO.md", mode: "qa" }),
      kind: "prompt",
      idle: false,
      log: "log",
      changes: [],
      next: null,
      cost: 0,
      costByModel: [],
    })
    expect(renderBeatPlain(fields, "gtd check qa 'TODO.md'")).toBe(
      "fix the bug\n\nBefore finishing your turn, run `gtd check qa 'TODO.md'` — it checks " +
        "TODO.md — and fix every violation it reports until it exits cleanly. Do not finish " +
        "while it still reports violations.\n",
    )
  })

  it("is byte-identical to a bare prompt render when no self-validate command is given", () => {
    const fields = fieldsFor("prompt", "prompt", "fix the bug")
    expect(renderBeatPlain(fields)).toBe(renderBeatPlain(fields, undefined))
  })

  it("plain output at kind prompt is byte-identical whether or not the machine declares system:", () => {
    const withoutSystem = fieldsFor("prompt", "prompt", "fix the bug")
    const withSystem = beatFields({
      rendered: rest({ kind: "prompt", content: "fix the bug", system: "a persona" }),
      kind: "prompt",
      idle: false,
      log: "log",
      changes: [{ status: "M", path: "TODO.md", pattern: "TODO.md" }],
      next: { action: undefined, pattern: "C", target: "idle" },
      cost: 0,
      costByModel: [],
    })
    expect(renderBeatPlain(withSystem)).toBe(renderBeatPlain(withoutSystem))
  })
})

describe("landFields / renderLandJson", () => {
  const sample: LandFields = {
    script: "printf '%s %s\\n' '[commit]' 'gtd(agent): build.fixing'\ngit commit ...\n",
    settled: false,
    idle: false,
    state: "build.review.deciding",
    subject: "gtd(agent): build.fixing",
    cost: 0.42,
    model: "smart",
  }

  it("landFields assembles the object in the declared key order regardless of input order", () => {
    const scrambled = {
      model: sample.model,
      cost: sample.cost,
      subject: sample.subject,
      state: sample.state,
      idle: sample.idle,
      settled: sample.settled,
      script: sample.script,
    }
    expect(Object.keys(landFields(scrambled))).toEqual([
      "script",
      "settled",
      "idle",
      "state",
      "subject",
      "cost",
      "model",
    ])
  })

  it("renderLandJson emits exactly script/settled/idle/state/subject/cost/model, newline-terminated", () => {
    const line = renderLandJson(landFields(sample))
    expect(line.endsWith("\n")).toBe(true)
    expect(JSON.parse(line)).toEqual(sample)
  })

  it("renderLandJson carries null subject/cost/model verbatim for a genuine no-op — never omitted", () => {
    const noop: LandFields = {
      script: "printf '%s\\n' 'nothing to do at \"idle\"'\n",
      settled: true,
      idle: true,
      state: "idle",
      subject: null,
      cost: null,
      model: null,
    }
    expect(JSON.parse(renderLandJson(landFields(noop)))).toEqual(noop)
  })
})

describe("noopText / landProseText", () => {
  it("noopText names the state", () => {
    expect(noopText("idle")).toBe('nothing to do at "idle"\n')
  })

  it("landProseText names the commit subject, newline-terminated", () => {
    expect(landProseText("gtd(human): idle → working")).toBe(
      "commit everything with this message: gtd(human): idle → working\n",
    )
  })

  it("landProseText carries no ANSI escape sequence", () => {
    // eslint-disable-next-line no-control-regex -- asserting the ABSENCE of an escape byte
    expect(landProseText("gtd(agent): drafting")).not.toMatch(/\x1b/)
  })
})

describe("renderLandPlain", () => {
  const sample: LandFields = {
    script: "printf '%s %s\\n' '[commit]' 'gtd(agent): build.fixing'\ngit commit ...\n",
    settled: false,
    idle: false,
    state: "build.review.deciding",
    subject: "gtd(agent): build.fixing",
    cost: 0.42,
    model: "smart",
  }

  it("names the commit subject and points at gtd land --json=script at a real landing", () => {
    const plain = renderLandPlain(sample)
    expect(plain).toContain("gtd(agent): build.fixing")
    expect(plain).toContain("gtd land --json=script")
  })

  it("prints the no-op note when nothing landed", () => {
    const noop: LandFields = {
      script: "printf '%s\\n' 'nothing to do at \"idle\"'\n",
      settled: true,
      idle: true,
      state: "idle",
      subject: null,
      cost: null,
      model: null,
    }
    expect(renderLandPlain(noop)).toBe(noopText("idle"))
  })
})

describe("BeatFields optionals are present-with-undefined, not omitted", () => {
  const BEAT_SOURCE = readFileSync(new URL("./Beat.ts", import.meta.url), "utf8")

  it("declares every optional BeatFields key `T | undefined`, never `key?:`", () => {
    const interfaceMatch = BEAT_SOURCE.match(/export interface BeatFields \{([\s\S]*?)\n\}/)
    expect(interfaceMatch).not.toBeNull()
    const body = interfaceMatch![1]!
    // Only top-level keys (2-space indent) count — `next`'s own nested
    // `action?:` lives on a separate inline type, not a top-level key.
    expect(body).not.toMatch(/^ {2}readonly \w+\?:/m)
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
      const fieldLine = new RegExp(`readonly ${key}:[^\\n]*\\| undefined`)
      expect(body).toMatch(fieldLine)
    }
  })

  it("beatFields builds its result with plain assignments, not spread-conditionals, for its optional fields", () => {
    const fnMatch = BEAT_SOURCE.match(/export const beatFields = \(input: \{[\s\S]*?\n\}\n/)
    expect(fnMatch).not.toBeNull()
    const fnBody = fnMatch![0]!
    expect(fnBody).not.toContain("...(")
  })

  it("`session` is present-with-undefined (not omitted) when the caller supplied none at kind prompt", () => {
    const fields = beatFields({
      rendered: rest(),
      kind: "prompt",
      log: "log",
      ...statusFields(),
    })
    expect("session" in fields).toBe(true)
    expect(fields.session).toBeUndefined()
    expect("validate" in fields).toBe(true)
    expect(fields.validate).toBeUndefined()
  })

  it("every optional key is present-with-undefined on the BeatFields object even when absent, though JSON.stringify still drops it", () => {
    const fields = beatFields({
      rendered: rest(),
      kind: "script",
      log: "log",
      ...statusFields(),
    })
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
    ] as const) {
      expect(key in fields).toBe(true)
      expect(fields[key]).toBeUndefined()
    }
    // The JSON encoder still drops these keys entirely — the wire contract is
    // unchanged even though the in-memory object now always carries the key.
    const parsed = JSON.parse(renderBeatJson(fields)) as Record<string, unknown>
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

  it("renderBeatJson output for a rest with absent optionals is byte-identical to the pre-refactor golden bytes", () => {
    const line = renderBeatJsonLine({
      rendered: rest({ kind: "script" }),
      kind: "script",
      log: ".git/gtd-loop.log",
      ...statusFields(),
    })
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

  it("renderLandJson output for a no-op landing is byte-identical to before the change", () => {
    const noop: LandFields = {
      script: "printf '%s\\n' 'nothing to do at \"idle\"'\n",
      settled: true,
      idle: true,
      state: "idle",
      subject: null,
      cost: null,
      model: null,
    }
    expect(renderLandJson(landFields(noop))).toBe(
      JSON.stringify({
        script: "printf '%s\\n' 'nothing to do at \"idle\"'\n",
        settled: true,
        idle: true,
        state: "idle",
        subject: null,
        cost: null,
        model: null,
      }) + "\n",
    )
  })

  it("LandFields has no `?:`-declared keys — its optionality is already expressed as `T | null`, not `T | undefined`", () => {
    const interfaceMatch = BEAT_SOURCE.match(/export interface LandFields \{([\s\S]*?)\n\}/)
    expect(interfaceMatch).not.toBeNull()
    expect(interfaceMatch![1]!).not.toMatch(/^\s*readonly \w+\?:/m)
  })
})
