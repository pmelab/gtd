import { WIRE_SCHEMA } from "./constants.js"

export type JudgePrimitive = "noul" | "choice" | "score"

export interface JudgeQuestion {
  readonly id: string
  readonly primitive: JudgePrimitive
  readonly instructions: string
  readonly criteria: string
}

/** Everything a judge needs: a judge gate's beat carries it, stringified, in `judge`; `gtd judge run` reads it on stdin. */
export interface JudgeDocument {
  readonly schema: number
  readonly state: Readonly<Record<string, string>>
  readonly questions: readonly JudgeQuestion[]
}

export const judgeJson = (
  state: JudgeDocument["state"],
  questions: JudgeDocument["questions"],
): string => JSON.stringify({ schema: WIRE_SCHEMA, state, questions } satisfies JudgeDocument)
