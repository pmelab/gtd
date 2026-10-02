import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { fixed } from "./fixed.js"
import type { Question } from "../types.js"

const q = (id: string): Question => ({ id, primitive: "noul", instructions: "i", criteria: "c" })
const file = (content: string): string => {
  const path = join(mkdtempSync(join(tmpdir(), "fixed-")), "answers.json")
  writeFileSync(path, content)
  return path
}
const run = (opts: Parameters<typeof fixed>[0], ids: string[]) => fixed(opts)(ids.map(q), {})

describe("fixed provider", () => {
  it("drops entries for unasked questions and leaves uncovered ones out", async () => {
    const env = {
      GTD_JUDGE_ANSWERS: JSON.stringify([
        { id: "a", answer: true, p: 0.9 },
        { id: "other", answer: "junk", p: 99 },
      ]),
    }
    expect(await run({ env }, ["a", "b"])).toEqual([{ id: "a", answer: true, p: 0.9 }])
  })

  it("--answers wins over GTD_JUDGE_ANSWERS", async () => {
    const answersPath = file(JSON.stringify([{ id: "a", answer: 1, p: 1 }]))
    const env = { GTD_JUDGE_ANSWERS: JSON.stringify([{ id: "a", answer: 2, p: 0 }]) }
    expect(await run({ answersPath, env }, ["a"])).toEqual([{ id: "a", answer: 1, p: 1 }])
  })

  it("rejects when neither source is present", async () => {
    await expect(run({ env: {} }, ["a"])).rejects.toThrow(/gtd judge run.*--answers/)
  })

  it.each([
    [{ id: "a", answer: null, p: 0.5 }],
    [{ id: "a", answer: true, p: 1.5 }],
    [{ id: "a", answer: true, p: -0.1 }],
    [{ id: "a", answer: true, p: "0.5" }],
    [{ id: "a", answer: true }],
  ])("rejects a malformed entry, naming the id: %j", async (entry) => {
    const env = { GTD_JUDGE_ANSWERS: JSON.stringify([entry]) }
    await expect(run({ env }, ["a"])).rejects.toThrow(/"a"/)
  })

  it("rejects invalid JSON and non-arrays", async () => {
    await expect(run({ env: { GTD_JUDGE_ANSWERS: "{" } }, ["a"])).rejects.toThrow(/valid JSON/)
    await expect(run({ env: { GTD_JUDGE_ANSWERS: "{}" } }, ["a"])).rejects.toThrow(/array/)
  })
})
