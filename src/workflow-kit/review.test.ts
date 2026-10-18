import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  feedback: undefined as string | undefined,
  head: "h1",
  pending: [] as unknown[],
}))

vi.mock("../flows/index.js", () => ({
  changes: () => state.pending,
  changesSince: () => [],
  hasThreadFor: () => false,
  head: () => state.head,
  read: () => state.feedback,
  refuse: (m: string) => {
    throw new Error(m)
  },
  requireReplies: () => {},
  requireThreadsClosed: () => {},
}))

import { routeNotes, type Requested, type ReviewPolicy, type Verdict } from "./review.js"
import type { ReviewNote } from "../steering/index.js"

const note = (id: string) => ({ id }) as unknown as ReviewNote

const setup = (verdicts: Record<string, Verdict>, silent = false, dropped = false) => {
  const calls: string[] = []
  const deferred: string[][] = []
  const collected: ReviewNote[][] = []
  const p = {
    file: "r.md",
    feedback: "f.md",
    triage: async () => new Map(Object.entries(verdicts)),
    answerQuestions: async () => void calls.push("answer"),
    fixNits: async () => void calls.push("nits"),
    keepGreen: async () => void calls.push("green"),
    collecting: async () => {
      calls.push("collect")
      if (!silent) state.feedback = "x"
    },
    captures: {
      editNotes: (_r: string, edits: readonly ReviewNote[]) => {
        collected.push([...edits])
        return "cap"
      },
    },
    refusals: dropped
      ? {
          dropped: (r: Requested) =>
            `dropped: ${r.notes.map((n) => n.id).join(",")} / ${r.paths.join(",")}`,
        }
      : {},
    defer: async (ns: readonly ReviewNote[]) => {
      calls.push("defer")
      deferred.push(ns.map((n) => n.id))
    },
  } as unknown as ReviewPolicy
  const r = {
    round: "r1",
    close: async () => void calls.push("close"),
    outcome: (verdict: "signoff" | "feedback") => ({ verdict }) as never,
    unfolded: async () => ({ verdict: "signoff" }) as never,
  }
  return { p, r, calls, deferred, collected }
}

beforeEach(() => {
  state.feedback = undefined
  state.pending = []
})

describe("routeNotes defer", () => {
  it("defer-only round awaits again, no collecting turn", async () => {
    const t = setup({ a: "defer", b: "defer" })
    const res = await routeNotes(t.p, [note("a"), note("b")], t.r)
    expect(res).toEqual({ next: "await", reviewed: "r1" })
    expect(t.deferred).toEqual([["a", "b"]])
    expect(t.calls).toEqual(["defer"])
  })

  it("defer + edit collects only the edits and ends feedback", async () => {
    const t = setup({ a: "defer", b: "edit" })
    const res = await routeNotes(t.p, [note("a"), note("b")], t.r)
    expect(res).toEqual({ verdict: "feedback" })
    expect(t.calls).toEqual(["defer", "close", "collect"])
    expect(t.collected[0]!.map((n) => n.id)).toEqual(["b"])
  })

  it("runs after nit fixes and before the collecting turn", async () => {
    const t = setup({ a: "nit", b: "defer", c: "edit" })
    await routeNotes(t.p, [note("a"), note("b"), note("c")], t.r)
    expect(t.calls).toEqual(["nits", "green", "defer", "close", "collect"])
  })
})

describe("routeNotes dropped", () => {
  it("an edit note whose collecting turn writes nothing is refused naming the note", async () => {
    const t = setup({ a: "edit" }, true, true)
    await expect(routeNotes(t.p, [note("a")], t.r)).rejects.toThrow("dropped: a / ")
  })

  it("signs off when no dropped refusal is set", async () => {
    const t = setup({ a: "edit" }, true)
    expect(await routeNotes(t.p, [note("a")], t.r)).toEqual({ verdict: "signoff" })
  })

  it("a collecting turn that changed something else is unmatched, not dropped", async () => {
    const t = setup({ a: "edit" }, true, true)
    Object.assign(t.p.refusals, { unmatched: "unmatched" })
    state.pending = [{ path: "x" }]
    await expect(routeNotes(t.p, [note("a")], t.r)).rejects.toThrow("unmatched")
  })

  it("a praise-only round never collects, so signs off", async () => {
    const t = setup({ a: "praise" }, true, true)
    expect(await routeNotes(t.p, [note("a")], t.r)).toEqual({ verdict: "signoff" })
  })
})
