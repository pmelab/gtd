export type Primitive = "noul" | "choice" | "score"

export interface Question {
  readonly id: string
  readonly primitive: Primitive
  readonly instructions: string
  readonly criteria: string
}

export interface Verdict {
  readonly id: string
  readonly answer: string | number | boolean
  readonly p: number
}

export type Answerer = (
  questions: readonly Question[],
  state: Readonly<Record<string, string>>,
) => Promise<readonly Verdict[]>
