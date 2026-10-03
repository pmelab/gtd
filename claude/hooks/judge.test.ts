import { describe, expect, test } from "vitest"

import { SYSTEM_PROMPT, toPrompt } from "../../src/judges/providers/llm.js"
import type { Question } from "../../src/judges/types.js"
import { JUDGE_SYSTEM, judgePrompt, toVerdicts } from "./judge"

const questions: Question[] = [
  { id: "safe", primitive: "noul", instructions: "Is the diff safe?", criteria: "No secrets." },
  {
    id: "kind",
    primitive: "choice",
    instructions: "What changed?",
    criteria: "identical: nothing. progress: some tests pass. new-failure: a test broke.",
  },
  {
    id: "size",
    primitive: "score",
    instructions: "How big?",
    criteria: "small: one file. big: many files.",
  },
]
const state = { diff: "+a\n-b" }

describe("judge", () => {
  test("asks exactly what gtd's own llm provider asks", () => {
    expect(judgePrompt({ state, questions })).toBe(toPrompt(questions, state))
    expect(JUDGE_SYSTEM).toBe(SYSTEM_PROMPT)
  })

  test("a reply becomes gtd's verdict array", () => {
    const reply = {
      safe: { answer: "yes", p: 0.9 },
      kind: { answer: "progress", p: 0.6 },
      size: { answer: 1, p: 0.7 },
    }
    expect(toVerdicts({ questions }, reply)).toEqual([
      { id: "safe", answer: "yes", p: 0.9 },
      { id: "kind", answer: "progress", p: 0.6 },
      { id: "size", answer: 1, p: 0.7 },
    ])
  })

  test("an answer outside a question's options, or a missing one, is refused", () => {
    expect(toVerdicts({ questions }, { safe: { answer: "maybe", p: 1 } })).toMatch(
      /not one of its options/,
    )
    expect(toVerdicts({ questions }, { safe: { answer: "yes", p: 1 } })).toMatch(/"kind" has no p/)
  })

  test("criteria a model cannot be asked about are refused before asking", () => {
    const bad = [{ id: "x", primitive: "choice", instructions: "?", criteria: "only: one." }]
    expect(() => judgePrompt({ questions: bad })).toThrow(/at least 2 labelled options/)
  })
})
