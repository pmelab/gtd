import { describe, expect, it } from "vitest"
import {
  beatDocument,
  demandOf,
  type BeatKind,
  statusOf,
  type RenderedDemandSource,
} from "./index.js"
import { renderBeatPlain } from "./BeatPlain.js"

const rendered = (overrides: Partial<RenderedDemandSource> = {}): RenderedDemandSource => ({
  state: "build.fixing",
  actor: "agent",
  content: "fix it",
  edges: [],
  ...overrides,
})

const documentFor = (kind: BeatKind, content: string, rest: Partial<RenderedDemandSource> = {}) => {
  const r = rendered({ content, ...rest })
  const demand = demandOf({ rendered: r, kind })
  const status = statusOf({
    rendered: r,
    idle: false,
    log: "log",
    changes: [{ status: "M", path: "TODO.md", pattern: "TODO.md" }],
    next: { action: undefined, pattern: "C", target: "idle" },
    cost: 0,
    costByModel: [],
  })
  return beatDocument(demand, status)
}

const HEADER =
  "State: build.fixing\nAwaits: agent\nPending:\n  M TODO.md -> TODO.md\nNext: C → idle"

describe("renderBeatPlain", () => {
  it("prepends the run instruction, then shows header, blank line, content verbatim at kind script", () => {
    expect(renderBeatPlain(documentFor("script", "npm test"))).toBe(
      `Run this script:\n${HEADER}\n\nnpm test\n`,
    )
  })

  it("shows header, blank line, content verbatim at kind message — no instruction line", () => {
    expect(renderBeatPlain(documentFor("message", "write NOTE.md"))).toBe(
      `${HEADER}\n\nwrite NOTE.md\n`,
    )
  })

  it("prepends prose stating the edit is already made and gtd land will land it, at kind capture", () => {
    const plain = renderBeatPlain(documentFor("capture", "already edited"))
    expect(plain).toBe(
      `The edit is already made — run \`gtd land\` to land it.\n${HEADER}\n\nalready edited\n`,
    )
    expect(plain).toMatch(/already made/)
    expect(plain).toContain("gtd land")
  })

  it("shows header, blank line, the stall diagnosis (never the rendered content) at kind stalled", () => {
    const plain = renderBeatPlain(documentFor("stalled", "would-be prompt"))
    expect(plain.startsWith(`${HEADER}\n\n`)).toBe(true)
    expect(plain).toContain('stalled at "build.fixing"')
    expect(plain).not.toContain("would-be prompt")
  })

  it("a stalled beat at a prompt state whose machine declares system: prints its stall diagnosis with no System: line and no persona text", () => {
    const document = documentFor("stalled", "would-be prompt", {
      system: "You are a careful senior engineer.",
    })
    const plain = renderBeatPlain(document)
    expect(plain).not.toContain("System:")
    expect(plain).not.toContain("You are a careful senior engineer.")
  })

  it("drops the header entirely at kind prompt, emitting bare content — no self-validate command given", () => {
    expect(renderBeatPlain(documentFor("prompt", "fix the bug"))).toBe("fix the bug\n")
  })

  it("at kind prompt, appends the self-validation instruction when a command is given", () => {
    const document = documentFor("prompt", "fix the bug", { file: "TODO.md", mode: "qa" })
    expect(renderBeatPlain(document, "gtd check qa 'TODO.md'")).toBe(
      "fix the bug\n\nBefore finishing your turn, run `gtd check qa 'TODO.md'` — it checks " +
        "TODO.md — and fix every violation it reports until it exits cleanly. Do not finish " +
        "while it still reports violations.\n",
    )
  })

  it("is byte-identical to a bare prompt render when no self-validate command is given", () => {
    const document = documentFor("prompt", "fix the bug")
    expect(renderBeatPlain(document)).toBe(renderBeatPlain(document, undefined))
  })

  it("plain output at kind prompt is byte-identical whether or not the machine declares system:", () => {
    const withoutSystem = documentFor("prompt", "fix the bug")
    const withSystem = documentFor("prompt", "fix the bug", { system: "a persona" })
    expect(renderBeatPlain(withSystem)).toBe(renderBeatPlain(withoutSystem))
  })
})
