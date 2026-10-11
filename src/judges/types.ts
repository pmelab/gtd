import type { JudgeQuestion } from "../wire/index.js"

export type Question = JudgeQuestion

export interface Verdict {
  readonly id: string
  readonly answer: string | number | boolean
  readonly p: number
}

export type Answerer = (
  questions: readonly Question[],
  state: Readonly<Record<string, string>>,
) => Promise<readonly Verdict[]>
