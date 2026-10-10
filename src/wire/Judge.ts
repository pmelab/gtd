import { WIRE_SCHEMA } from "./constants.js"

interface JudgeQuestionDocument {
  readonly id: string
  readonly primitive: string
  readonly instructions: string
  readonly criteria: string
}

export const judgeJson = (
  state: Readonly<Record<string, string>>,
  questions: readonly JudgeQuestionDocument[],
): string => JSON.stringify({ schema: WIRE_SCHEMA, state, questions })
