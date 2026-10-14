import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ feedback: undefined as string | undefined, head: "h1" }))

vi.mock("../flows/index.js", () => ({
  changes: () => [],
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

import { routeNotes, type ReviewPolicy, type Verdict } from "./review.js"
import type { ReviewNote } from "../steering/index.js"

const note = (id: string) => ({ id }) as unknown as ReviewNote

const setup = (verdicts: Record<string, Verdict>) => {
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
      state.feedback = "x"
    },
    captures: {
      editNotes: (_r: string, edits: readonly ReviewNote[]) => {
        collected.push([...edits])
        return "cap"
      },
    },
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
