import { describe, expect, test } from "vitest"

import type { Run, Stop } from "../types"
import { decideCommand, decideContinue, decideJob, restId, TOOL, TOOLS } from "./tools"
import type { ContinueIo } from "./tools"

const judgment = {
  questions: [
    { id: "kind", primitive: "choice", instructions: "?", criteria: "edit: change. nit: small." },
  ],
}

const fake = (over: Partial<ContinueIo> = {}) => {
  const calls: string[] = []
  const io: ContinueIo = {
    current: async () => "abc:design.gate",
    validate: async () => (calls.push("validate"), { ok: true, out: "" }),
    judgment: async () => (calls.push("judgment"), judgment),
    ...over,
  }
  return { io, calls }
}

const at = (stop: Stop, over: Partial<Run> = {}): Run => ({
  isRunning: false,
  beat: 3,
  stop,
  rest: "abc:design.gate",
  ...over,
})
const gate: Stop = { kind: "gate", text: "", state: "design.gate", mode: "qa", file: "R.md" }
const judge: Stop = { ...gate, isJudge: true }

describe("continue", () => {
  test("validates the rest's file, then goes", async () => {
    const { io, calls } = fake()
    expect(await decideContinue(at(gate), "abc:design.gate", undefined, io)).toEqual({})
    expect(calls).toEqual(["validate"])
  })

  test("validation findings come back and nothing moves", async () => {
    const { io } = fake({ validate: async () => ({ ok: false, out: "line 3: two ticks" }) })
    const r = await decideContinue(at(gate), "abc:design.gate", undefined, io)
    expect(r.refuse).toContain("line 3: two ticks")
  })

  test("an answer for a rest gtd has left is refused before anything runs", async () => {
    const { io, calls } = fake()
    const r = await decideContinue(at(gate), "old:design.gate", undefined, io)
    expect(r.refuse).toContain("moved on")
    expect(calls).toEqual([])
  })

  test("a rest gtd left outside this session is refused, the band's Continue too", async () => {
    const { io, calls } = fake({ current: async () => "def:building" })
    for (const rest of ["abc:design.gate", undefined]) {
      const r = await decideContinue(at(gate), rest, undefined, io)
      expect(r.refuse).toContain("no longer at that step")
    }
    expect(calls).toEqual([])
  })

  test("when gtd cannot say where it is, nothing is checked against it", async () => {
    const { io } = fake({ current: async () => undefined })
    expect(await decideContinue(at(gate), "abc:design.gate", undefined, io)).toEqual({})
  })

  test("the band's Continue always means the rest on screen", async () => {
    expect(await decideContinue(at(gate), undefined, undefined, fake().io)).toEqual({})
  })

  test("refused while running, with no rest, or once finished", async () => {
    const { io } = fake()
    const refusals = await Promise.all([
      decideContinue(at(gate, { isRunning: true }), undefined, undefined, io),
      decideContinue({ isRunning: false, beat: 0 }, undefined, undefined, io),
      decideContinue(at({ kind: "done", text: "" }), undefined, undefined, io),
    ])
    expect(refusals.map((r) => r.refuse)).toEqual([
      "gtd is already running a step.",
      "Nothing is waiting: gtd has no rest open. /gtd drives it.",
      `The process is finished: ${TOOL.ship} opens its pull request.`,
    ])
  })

  test("a judge gate takes the person's verdicts, checked against the judgment", async () => {
    const { io } = fake()
    expect(await decideContinue(at(judge), undefined, { kind: "nit" }, io)).toEqual({
      verdict: JSON.stringify([{ id: "kind", answer: "nit", p: 1 }]),
    })
    const r = await decideContinue(at(judge), undefined, { kind: "praise" }, io)
    expect(r.refuse).toContain('"kind" answer is not one of its options')
  })

  test("a judge gate without verdicts lands untouched, unvalidated", async () => {
    const { io, calls } = fake()
    expect(await decideContinue(at(judge), undefined, undefined, io)).toEqual({})
    expect(calls).toEqual([])
  })

  test("verdicts anywhere else are refused", async () => {
    const r = await decideContinue(at(gate), undefined, { kind: "nit" }, fake().io)
    expect(r.refuse).toBe("This step takes no verdicts.")
  })

  test("a problem stop continues without validating", async () => {
    const { io, calls } = fake()
    const stop: Stop = { kind: "error", text: "boom", state: "design.gate" }
    expect(await decideContinue(at(stop), undefined, undefined, io)).toEqual({})
    expect(calls).toEqual([])
  })
})

describe("ship and hand-off", () => {
  const stalled: Stop = { kind: "stalled", text: "stuck", state: "design.gate" }
  const error: Stop = { kind: "error", text: "boom", state: "design.gate" }
  const done: Stop = { kind: "done", text: "finished" }

  test.each([
    ["gate", gate],
    ["stuck step", stalled],
    ["failure", error],
  ])("ship at a %s is refused without touching the run", async (_n, stop) => {
    const run = at(stop)
    const before = structuredClone(run)
    expect(decideJob(run, "ship")).toEqual(expect.any(String))
    expect(run).toEqual(before)
  })

  test.each(["ship", "handoff"] as const)("%s is refused while a continue is queued", (job) => {
    expect(decideJob(at(gate, { pending: { rest: "abc:design.gate" } }), job)).toEqual(
      expect.any(String),
    )
  })

  test("continue is refused while a ship or hand-off runs or is queued", async () => {
    const next = await decideContinue(at(gate), undefined, undefined, {
      ...fake().io,
      busy: "handoff",
    })
    expect(next.refuse).toMatch(/hand-off/)
  })

  test.each(["ship", "handoff"] as const)("%s is refused while a step runs", (job) => {
    expect(decideJob(at(gate, { isRunning: true }), job)).toEqual(expect.any(String))
  })

  test("ship is allowed at a done stop and with no stop", () => {
    expect(decideJob(at(done), "ship")).toBeUndefined()
    expect(decideJob(at(undefined as unknown as Stop, { stop: undefined }), "ship")).toBeUndefined()
  })

  test("hand-off is allowed at a gate", () => {
    expect(decideJob(at(gate), "handoff")).toBeUndefined()
  })
})

test("a rest is its HEAD and state", () => {
  expect(restId("0123456789abcdef", "design.gate")).toBe("0123456789ab:design.gate")
})

test("every tool is served under the gtd plugin's name", () => {
  expect(TOOLS.map((t) => `mcp__gtd__${t.name}`).sort()).toEqual(Object.values(TOOL).sort())
})

describe("decideCommand", () => {
  const refused = [
    "catch 12",
    "catch feature/x",
    "fix",
    "review main",
    "review",
    "add a --json flag",
    "",
    "bogus",
    "stop now",
    "ui",
  ]
  const allowed = ["status", "throw @dev", "throw", "ship", "ship -n"]

  test.each(refused)("refuses %j while a ship runs", (arg) => {
    expect(decideCommand(arg, "ship")).toBe("A ship is still running: wait for its report.")
  })
  test("names a running hand-off", () => {
    expect(decideCommand("catch 12", "handoff")).toBe(
      "A hand-off is still running: wait for its report.",
    )
  })
  test.each(allowed)("lets %j through while busy", (arg) => {
    expect(decideCommand(arg, "ship")).toBeUndefined()
  })
  test("lets everything through when idle", () => {
    expect(decideCommand("catch 12", undefined)).toBeUndefined()
  })
})
