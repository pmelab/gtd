import { fixed } from "./providers/fixed.js"
import { jev } from "./providers/jev.js"
import type { Answerer, Question } from "./types.js"

export interface RunJudgeInput {
  readonly provider: "fixed" | "jev"
  readonly answers?: string | undefined
  readonly env: Readonly<Record<string, string | undefined>>
  readonly input: string
}

const fail = (message: string): never => {
  throw new Error(`gtd judge run: ${message}`)
}

const answererFor = ({ provider, answers, env }: RunJudgeInput): Answerer => {
  if (provider === "fixed") return fixed({ answersPath: answers, env })
  return jev({ env })
}

export const runJudge = async (opts: RunJudgeInput): Promise<string> => {
  let doc: unknown
  try {
    doc = JSON.parse(opts.input)
  } catch {
    return fail("stdin is not valid JSON")
  }
  const { questions, state } = (doc ?? {}) as { questions?: unknown; state?: unknown }
  if (!Array.isArray(questions)) return fail('stdin has no "questions" array')
  const verdicts = await answererFor(opts)(
    questions as readonly Question[],
    (typeof state === "object" && state !== null ? state : {}) as Record<string, string>,
  )
  return JSON.stringify(verdicts) + "\n"
}
