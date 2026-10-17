import { describe, expect, test } from "vitest"

import { collectAnswer } from "./delegate"
import type { AnswerIo } from "./delegate"

const settle = () => new Promise((r) => setTimeout(r, 0))

const setup = (over: Partial<AnswerIo> = {}) => {
  const calls: string[] = []
  let end!: (e: { ok: boolean }) => void
  let time!: () => void
  const io: AnswerIo = {
    ended: new Promise((r) => (end = r)),
    deadline: new Promise<void>((r) => (time = r)),
    read: async () => (calls.push("read"), "answer"),
    remove: async () => void calls.push("remove"),
    ...over,
  }
  return { io, calls, end: (ok: boolean) => end({ ok }), time: () => time() }
}

describe("collectAnswer", () => {
  test("ok in time reads, then removes once", async () => {
    const s = setup()
    const p = collectAnswer(s.io)
    s.end(true)
    expect(await p).toBe("answer")
    expect(s.calls).toEqual(["read", "remove"])
  })
  test("not ok in time removes without reading", async () => {
    const s = setup()
    const p = collectAnswer(s.io)
    s.end(false)
    expect(await p).toBeUndefined()
    expect(s.calls).toEqual(["remove"])
  })
  test("a throwing read yields undefined and removes once", async () => {
    const calls: string[] = []
    const s = setup({
      read: async () => {
        throw new Error("gone")
      },
      remove: async () => void calls.push("remove"),
    })
    const p = collectAnswer(s.io)
    s.end(true)
    expect(await p).toBeUndefined()
    expect(calls).toEqual(["remove"])
  })
  test("timeout answers at once; remove waits for the turn to end", async () => {
    for (const ok of [true, false]) {
      const s = setup()
      const p = collectAnswer(s.io)
      s.time()
      expect(await p).toBeUndefined()
      expect(s.calls).toEqual([])
      s.end(ok)
      await settle()
      expect(s.calls).toEqual(["remove"])
    }
  })
  test("timed out and never ended: remove never runs", async () => {
    const s = setup()
    const p = collectAnswer(s.io)
    s.time()
    await p
    await settle()
    expect(s.calls).toEqual([])
  })
  test("a rejecting remove after timeout is swallowed", async () => {
    const seen: unknown[] = []
    const h = (e: unknown) => void seen.push(e)
    process.on("unhandledRejection", h)
    const s = setup({
      remove: async () => {
        throw new Error("rm failed")
      },
    })
    const p = collectAnswer(s.io)
    s.time()
    await p
    s.end(true)
    await settle()
    await settle()
    process.off("unhandledRejection", h)
    expect(seen).toEqual([])
  })
})
