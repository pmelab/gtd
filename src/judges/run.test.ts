import { describe, expect, it } from "vitest"
import { runJudge } from "./run.js"

const doc = JSON.stringify({
  state: {},
  questions: [{ id: "q", primitive: "noul", instructions: "i", criteria: "c" }],
})
const env = { GTD_JUDGE_ANSWERS: '[{"id":"q","answer":true,"p":0.7}]' }

describe("runJudge", () => {
  it("writes the verdict as newline-terminated JSON", async () => {
    expect(await runJudge({ provider: "fixed", env, input: doc })).toBe(
      '[{"id":"q","answer":true,"p":0.7}]\n',
    )
  })
  it("rejects invalid JSON and a missing questions array, naming gtd judge run", async () => {
    await expect(runJudge({ provider: "fixed", env, input: "x" })).rejects.toThrow(/gtd judge run/)
    await expect(runJudge({ provider: "fixed", env, input: "{}" })).rejects.toThrow(/gtd judge run/)
  })
  it("jev without TYPESAFE_API_KEY rejects before any request", async () => {
    await expect(runJudge({ provider: "jev", env: {}, input: doc })).rejects.toThrow(
      "gtd judge run: --provider jev needs TYPESAFE_API_KEY",
    )
  })
})
