import { describe, expect, it } from "vitest"
import { human, seamGate, type DiffShape, type DiffShapeResult, type Flow } from "../flows/index.js"
import { replay, treeFromRecord } from "./index.js"

// Lives in replay, which drives a flow to its rest (flows tests may not import replay).
const shape = (
  choice: DiffShape,
  strays: string[] = [],
  unreadable: string[] = [],
): DiffShapeResult => ({ choice, strays, unreadable, judgment: undefined })

const restOf = async (result: DiffShapeResult) => {
  const flow: Flow = async () => {
    await seamGate("seam", result)
    await human("next")
  }
  const outcome = await replay({
    flow,
    episode: { base: { hash: "0".repeat(40), tree: treeFromRecord({}) }, commits: [] },
    vars: {},
    env: {},
    start: "0".repeat(40),
    budgetBytes: 1024,
  })
  if (outcome.kind !== "rest") throw new Error(`expected a rest, got ${outcome.kind}`)
  return outcome.rest
}

describe("seamGate", () => {
  for (const choice of ["land", "reject"] as const) {
    it(`reaches no step on ${choice}: the flow's next step is the rest`, async () => {
      const rest = await restOf(shape(choice, ["a.ts"]))
      expect(rest.name).toBe("next")
    })
  }

  it("rests at an approve human step named after the caller on refactor-first", async () => {
    const rest = await restOf(shape("refactor-first", ["a.ts"]))
    expect(rest.name).toBe("seam")
    expect(rest.request).toMatchObject({ kind: "human", options: { approve: true } })
  })

  it("lists every stray in order, marks only the unreadable, names gtd land and gtd abandon", async () => {
    const rest = await restOf(shape("refactor-first", ["a.ts", "b/c.ts", "z.bin"], ["b/c.ts"]))
    if (rest.request.kind !== "human") throw new Error("expected a human step")
    const message = rest.request.options.message ?? ""
    const lines = message.split("\n")
    const strays = lines.filter((line) => line.startsWith("- "))
    expect(strays).toEqual(["- a.ts", "- b/c.ts (unreadable — not judged)", "- z.bin"])
    expect(message).toMatch(/`gtd land`[^\n]*approve/)
    expect(message).toContain("`gtd abandon`")
  })

  it("quotes a stray path with a control character", async () => {
    const rest = await restOf(shape("refactor-first", ["a\nb", "c\u001b[2K"]))
    if (rest.request.kind !== "human") throw new Error("expected a human step")
    const strays = (rest.request.options.message ?? "")
      .split("\n")
      .filter((line) => line.startsWith("- "))
    expect(strays).toEqual(['- "a\\nb"', '- "c\\u001b[2K"'])
  })
})
