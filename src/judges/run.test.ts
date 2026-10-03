import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { runJudge } from "./run.js"
import { claudeShim as shimDir } from "./shim.fixture.js"

const doc = JSON.stringify({
  state: {},
  questions: [{ id: "q", primitive: "noul", instructions: "i", criteria: "c" }],
})
const cwd = tmpdir()
const env = { GTD_JUDGE_ANSWERS: '[{"id":"q","answer":true,"p":0.7}]' }

describe("runJudge", () => {
  it("writes the verdict as newline-terminated JSON", async () => {
    expect(await runJudge({ provider: "fixed", env, input: doc, cwd })).toBe(
      '[{"id":"q","answer":true,"p":0.7}]\n',
    )
  })
  it("rejects invalid JSON and a missing questions array, naming gtd judge run", async () => {
    await expect(runJudge({ provider: "fixed", env, input: "x", cwd })).rejects.toThrow(
      /gtd judge run/,
    )
    await expect(runJudge({ provider: "fixed", env, input: "{}", cwd })).rejects.toThrow(
      /gtd judge run/,
    )
  })
  it("jev without TYPESAFE_API_KEY rejects before any request", async () => {
    await expect(runJudge({ provider: "jev", env: {}, input: doc, cwd })).rejects.toThrow(
      "gtd judge run: --provider jev needs TYPESAFE_API_KEY",
    )
  })

  const answer = JSON.stringify({ structured_output: { q: { answer: "yes", p: 0.8 } } })

  it("auto selects jev when keyed and never falls back to the llm", async () => {
    const marker = join(mkdtempSync(join(tmpdir(), "gtd-run-marker-")), "ran")
    const dir = shimDir(`touch ${marker}; echo '${answer}'`)
    await expect(
      runJudge({
        provider: undefined,
        env: {
          PATH: `${dir}:/bin:/usr/bin`,
          TYPESAFE_API_KEY: "k",
          JEV_BASE_URL: "http://127.0.0.1:1/x",
        },
        input: doc,
        cwd,
      }),
    ).rejects.toThrow(/gtd judge run: jev request failed/)
    expect(existsSync(marker)).toBe(false)
  })

  it("refuses --model alongside a provider that is not the llm", async () => {
    await expect(
      runJudge({
        provider: "jev",
        model: "sonnet",
        env: { TYPESAFE_API_KEY: "k" },
        input: doc,
        cwd,
      }),
    ).rejects.toThrow("gtd judge run: --model only applies to --provider llm, not jev")
  })

  it("auto selects the llm when --model is given, even with TYPESAFE_API_KEY set", async () => {
    const dir = shimDir(`echo '${answer}'`)
    expect(
      await runJudge({
        provider: undefined,
        model: "sonnet",
        env: { PATH: `${dir}:/bin:/usr/bin`, TYPESAFE_API_KEY: "k" },
        input: doc,
        cwd,
      }),
    ).toBe('[{"id":"q","answer":"yes","p":0.8}]\n')
  })
})
