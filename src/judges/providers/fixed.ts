import { readFile } from "node:fs/promises"
import type { Answerer, Verdict } from "../types.js"

export interface FixedOptions {
  readonly answersPath?: string | undefined
  readonly env: Readonly<Record<string, string | undefined>>
}

const fail = (message: string): never => {
  throw new Error(`gtd judge run: ${message}`)
}

const isAnswer = (v: unknown): v is Verdict["answer"] =>
  ["string", "number", "boolean"].includes(typeof v)

const isProbability = (v: unknown): v is number => typeof v === "number" && v >= 0 && v <= 1 // NaN and ±Infinity fail both bounds

const validate = (entry: unknown, index: number): Verdict => {
  const e = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>
  const { id, answer, p } = e
  if (typeof id !== "string") return fail(`answers entry ${index} has no string "id"`)
  if (!isAnswer(answer)) {
    return fail(`answers entry "${id}": "answer" must be a string, number or boolean`)
  }
  if (!isProbability(p)) return fail(`answers entry "${id}": "p" must be a number in [0, 1]`)
  return { id, answer, p }
}

export const fixed =
  ({ answersPath, env }: FixedOptions): Answerer =>
  async (questions) => {
    const inline = env["GTD_JUDGE_ANSWERS"]
    let raw: string
    if (answersPath !== undefined) {
      raw = await readFile(answersPath, "utf8").catch((e: unknown) =>
        fail(`cannot read --answers ${answersPath}: ${e instanceof Error ? e.message : String(e)}`),
      )
    } else if (inline !== undefined && inline !== "") {
      raw = inline
    } else {
      return fail('provider "fixed" needs --answers <path> or GTD_JUDGE_ANSWERS')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return fail("the fixed answers are not valid JSON")
    }
    if (!Array.isArray(parsed)) return fail("the fixed answers must be a JSON array")
    const asked = new Set(questions.map((q) => q.id))
    return parsed.flatMap((entry, i) => {
      const id = (entry as { id?: unknown } | null)?.id
      // Entries for questions this judgment did not ask are dropped unvalidated: one file serves every gate.
      if (typeof id === "string" && !asked.has(id)) return []
      return [validate(entry, i)]
    })
  }
