import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  head: "h1",
  files: {} as Record<string, string | undefined>,
  annotations: [] as string[],
  since: [] as { path: string; status: string }[],
}))

vi.mock("../flows/index.js", () => ({
  annotations: () => state.annotations,
  changesSince: () => state.since,
  head: () => state.head,
  read: (path: string) => state.files[path],
  refuse: (m: string) => {
    throw new Error(m)
  },
  widgets: () => [],
}))

import { review, reviewToHandOff, type HandOffPolicy } from "./review.js"

const setup = () => {
  const calls: string[] = []
  const p: HandOffPolicy = {
    file: "r.md",
    isCode: (path) => !path.startsWith(".gtd/"),
    reviewing: async (base) => {
      calls.push(`reviewing:${base}`)
      state.head = "h2"
      state.files["r.md"] = "## 🔍 Chunk\n\n- [ ] ./a.ts#1\n"
    },
    awaitReview: async () => {
      calls.push("await")
      state.head = "h3"
    },
    keepGreen: async () => void calls.push("green"),
    close: async (round) => void calls.push(`close:${round}`),
    handOff: async (reviewed) => void calls.push(`handOff:${reviewed}`),
    deleted: "keep r.md",
  }
  return { p, calls }
}

beforeEach(() => {
  state.head = "h1"
  state.files = {}
  state.annotations = []
  state.since = []
})

describe("review", () => {
  it("signs off and closes when the person annotated nothing", async () => {
    const { p, calls } = setup()
    expect(await review("b", p)).toEqual({ verdict: "signoff" })
    expect(calls).toEqual(["reviewing:b", "await", "close:h3"])
  })

  it("keeps the suite green when the person edited code and signed off", async () => {
    const { p, calls } = setup()
    state.since = [
      { path: "src/a.ts", status: "modified" },
      { path: ".gtd/r.md", status: "modified" },
    ]
    await review("b", p)
    expect(calls).toEqual(["reviewing:b", "await", "green", "close:h3"])
  })

  it("returns feedback when the person annotated the review", async () => {
    const { p, calls } = setup()
    state.annotations = ["fn1"]
    state.since = [{ path: "src/a.ts", status: "modified" }]
    expect(await review("b", p)).toEqual({
      verdict: "feedback",
      base: "b",
      restoreFrom: "h2",
      edited: [{ path: "src/a.ts", status: "modified" }],
    })
    expect(calls).toEqual(["reviewing:b", "await"])
  })

  it("refuses a gate that deleted the review", async () => {
    const { p } = setup()
    const deleting = { ...p, awaitReview: async () => void delete state.files["r.md"] }
    await expect(review("b", deleting)).rejects.toThrow("keep r.md")
  })
})

describe("reviewToHandOff", () => {
  it("hands an annotated review on", async () => {
    const { p, calls } = setup()
    state.annotations = ["fn1"]
    await reviewToHandOff("b", p)
    expect(calls).toEqual(["reviewing:b", "await", "handOff:h2"])
  })

  it("closes a signed-off review", async () => {
    const { p, calls } = setup()
    await reviewToHandOff("b", p)
    expect(calls).toEqual(["reviewing:b", "await", "close:h3"])
  })
})
