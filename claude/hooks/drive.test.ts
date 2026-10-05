import { describe, expect, test } from "vitest"

import { afterReload, drive } from "./drive"
import type { Beat, Io, Landing } from "./drive"

const fake = (beats: Beat[], landings: Landing[] = [], over: Partial<Io> = {}) => {
  const calls: string[] = []
  const io: Io = {
    next: async () => beats.shift() ?? { kind: "message", idle: true },
    plain: async () => "plain",
    land: async (verdict) => {
      calls.push(verdict ? `land:${verdict}` : "land")
      return landings.shift() ?? { script: "true" }
    },
    sh: async (script) => (calls.push(`sh:${script}`), 0),
    check: async () => ({ ok: true, out: "" }),
    judge: async () => undefined,
    turn: async (t) => (calls.push(`turn:${t.memory}:${t.resume}:${t.prompt}`), { ok: true }),
    resume: async (memory, text) => (calls.push(`resume:${memory}:${text}`), { ok: true }),
    progress: () => {},
    stopped: () => false,
    ...over,
  }
  return { io, calls }
}

describe("drive", () => {
  test("lands the opening gate, stops at the next one", async () => {
    const { io, calls } = fake([
      { kind: "message", state: "plan" },
      { kind: "message", state: "review", content: "read it" },
    ])
    expect(await drive(io)).toEqual({
      kind: "gate",
      text: "read it",
      state: "review",
      label: undefined,
    })
    expect(calls).toEqual(["land", "sh:true"])
  })

  test("runs an agent turn, feeds validation output back to the same scope", async () => {
    const checks = [
      { ok: false, out: "fix line 3" },
      { ok: true, out: "" },
    ]
    const { io, calls } = fake(
      [
        {
          kind: "prompt",
          content: "do it",
          memory: "build#abc",
          session: { resume: "true" },
          validate: "v",
        },
      ],
      [{ script: "commit", settled: true, idle: true }],
      { check: async () => checks.shift()! },
    )
    expect(await drive(io)).toMatchObject({ kind: "done", text: "plain" })
    expect(calls).toEqual([
      "turn:build#abc:true:do it",
      "resume:build#abc:fix line 3",
      "land",
      "sh:commit",
    ])
  })

  test("gives up after three failed fixes", async () => {
    const { io, calls } = fake([{ kind: "prompt", memory: "m", validate: "v" }], [], {
      check: async () => ({ ok: false, out: "bad" }),
    })
    expect(await drive(io)).toMatchObject({ kind: "error" })
    expect(calls.filter((c) => c.startsWith("resume"))).toHaveLength(3)
    expect(calls).not.toContain("land")
  })

  test("a failed agent turn lands nothing", async () => {
    const { io, calls } = fake([{ kind: "prompt", memory: "m" }], [], {
      turn: async () => ({ ok: false, why: "agent turn ended: aborted" }),
    })
    expect(await drive(io)).toMatchObject({ kind: "error", text: "agent turn ended: aborted" })
    expect(calls).toEqual([])
  })

  test("runs script beats and stops at idle after the opening beat", async () => {
    const { io, calls } = fake([
      { kind: "script", content: "npm test" },
      { kind: "capture" },
      { kind: "message", idle: "true" },
    ])
    expect(await drive(io)).toMatchObject({ kind: "done" })
    expect(calls).toEqual(["sh:npm test", "land", "sh:true", "land", "sh:true"])
  })

  test("stalled stops with the diagnosis", async () => {
    const { io } = fake([{ kind: "capture" }, { kind: "stalled", content: "why" }])
    expect(await drive(io)).toMatchObject({ kind: "stalled", text: "why" })
  })

  test("a judged gate lands with the verdict, but never twice in a row", async () => {
    const gate: Beat = { kind: "message", state: "judge-review", judge: { questions: [] } }
    const { io, calls } = fake([{ kind: "capture" }, gate, { ...gate }], [], {
      judge: async () => "[v]",
    })
    expect(await drive(io)).toMatchObject({ kind: "gate", state: "judge-review" })
    expect(calls).toEqual(["land", "sh:true", "land:[v]", "sh:true"])
  })

  test("a failing landing script stops the loop", async () => {
    const { io } = fake([{ kind: "capture" }], [], { sh: async () => 1 })
    expect(await drive(io)).toMatchObject({ kind: "error", text: "landing script exited 1" })
  })

  test("a stop request ends the loop between beats", async () => {
    const { io, calls } = fake([{ kind: "capture" }], [], { stopped: () => true })
    expect(await drive(io)).toMatchObject({ kind: "stopped" })
    expect(calls).toEqual([])
  })

  test("after a reload, the turn that already ran is landed, not repeated", async () => {
    const { io, calls } = fake(
      [
        { kind: "prompt", memory: "build#a", content: "do it" },
        { kind: "prompt", memory: "build#a" },
      ],
      [{ script: "commit" }, { script: "next", settled: true }],
    )
    await drive(io, "build#a")
    expect(calls).toEqual(["land", "sh:commit", "turn:build#a:false:", "land", "sh:next"])
  })
})

describe("after a reload", () => {
  test("lands only a turn the agent finished", () => {
    expect(afterReload({ agentStatus: "completed" })).toBe("land")
    expect(afterReload({ agentStatus: "running" })).toBe("wait")
    for (const agentStatus of ["failed", "killed", "aborted", undefined])
      expect(afterReload({ agentStatus })).toBe("rerun")
  })

  test("never runs a cut-off script again on its own", () => {
    expect(afterReload({ isScripting: true, agentStatus: "completed" })).toBe("halt")
  })
})
