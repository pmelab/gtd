import { describe, expect, test } from "vitest"

import { classicResult, decide, guardOf } from "./context"

describe("guardOf", () => {
  test("merges the beat's limits over the defaults", () => {
    expect(guardOf({ hard: 0.9 }, "opus", undefined)).toEqual({
      limit: { soft: 0.6, hard: 0.9 },
      window: 200000,
    })
  })

  test("takes a positive window override, else the model's window", () => {
    expect(guardOf(undefined, "opus[1m]", undefined)?.window).toBe(1000000)
    expect(guardOf(undefined, "opus", "500000")?.window).toBe(500000)
    expect(guardOf(undefined, "opus", "lots")?.window).toBe(200000)
  })

  test("guards nothing under limits it cannot use", () => {
    expect(guardOf({ soft: 0.9 }, "opus", undefined)).toBeUndefined()
  })
})

describe("decide", () => {
  const guard = guardOf(undefined, undefined, "1000")
  const never = async () => {
    throw new Error("read nothing")
  }

  test("leaves the main session and an unguarded worker alone", async () => {
    expect(
      await decide({ hook_event_name: "PreCompact", transcript_path: "/t.jsonl" }, guard, never),
    ).toBeUndefined()
    const worker = { hook_event_name: "PreCompact", transcript_path: "/t.jsonl", agent_id: "w" }
    expect(await decide(worker, undefined, never)).toBeUndefined()
  })
})

test("a hard stop only blocks the call: the mod stops the worker itself", () => {
  expect(classicResult({ kind: "hard", stopReason: "gtd: context limit: x" })).toEqual({
    block: "gtd: context limit: x",
  })
})
