import { describe, expect, it } from "vitest"
import { escalation, untilSettled } from "./health.js"

describe("escalation", () => {
  it("describes and stops until `limit` rounds are spent, then reports exhaustion", async () => {
    const log: string[] = []
    const steps = {
      limit: 2,
      describe: async () => void log.push("describe"),
      stop: async () => void log.push("stop"),
      exhausted: async () => void log.push("exhausted"),
    }
    const count = { rounds: 0 }
    for (let i = 0; i < 3; i++) await escalation(count, steps)
    expect(log).toEqual(["describe", "stop", "describe", "stop", "exhausted"])
    expect(count.rounds).toBe(2)
  })
})

describe("untilSettled", () => {
  it("reruns while pending and resolves the first run that counts", async () => {
    const results = [false, false, true]
    let pending = 2
    const green = await untilSettled(
      async () => results.shift()!,
      () => pending-- > 0,
    )
    expect(green).toBe(true)
  })
})
