import { describe, expect, test } from "vitest"

import type { Stop } from "../types"
import { wakePrompt, wakes } from "./assist"
import { TOOL } from "./tools"
import { RELOAD_CUT_SCRIPT } from "./wording"

const qa: Stop = {
  kind: "gate",
  text: "Tick exactly one box per question.",
  state: "design.gate.answer",
  label: "Awaiting your product answers",
  file: ".gtd/REQUIREMENTS.md",
  mode: "qa",
}

describe("which stops wake the model", () => {
  test("gates and problems do; a stop the person asked for does not", () => {
    expect(wakes(qa, undefined)).toBe(true)
    expect(wakes({ kind: "error", text: "boom" }, undefined)).toBe(true)
    expect(wakes({ kind: "stalled", text: "" }, undefined)).toBe(true)
    expect(wakes({ kind: "stopped", text: "stopped on request" }, undefined)).toBe(false)
    expect(wakes({ kind: "stopped", text: RELOAD_CUT_SCRIPT }, undefined)).toBe(true)
  })

  test("a finished process only with a pull request to offer", () => {
    expect(wakes({ kind: "done", text: "" }, "feat/x")).toBe(true)
    expect(wakes({ kind: "done", text: "" }, undefined)).toBe(false)
  })
})

describe("the wake prompt", () => {
  test("a qa gate carries gtd's message verbatim, the walk, and the rest id", () => {
    const p = wakePrompt({ stop: qa, rest: "abc:design" })
    expect(p).toContain("~~~~text\nTick exactly one box per question.\n~~~~")
    expect(p).toContain('"Awaiting your product answers"')
    expect(p).toContain("walk them one at a time")
    expect(p).toContain("only to .gtd/REQUIREMENTS.md")
    expect(p).toContain(`call ${TOOL.continue} with rest "abc:design"`)
    expect(p).toContain("explicitly says so")
  })

  test("a review gate starts with an overview and ends on sign-off or send-back", () => {
    const p = wakePrompt({
      stop: { ...qa, mode: "review", file: ".gtd/REVIEW.md" },
      rest: "r",
    })
    expect(p).toContain("chunk by chunk")
    expect(p).toContain("sign off")
    expect(p).not.toContain("walk them one at a time")
  })

  test("a repeat says gtd is still waiting on the same thing", () => {
    expect(wakePrompt({ stop: qa, rest: "r", isRepeat: true })).toContain("same step again")
  })

  test("an undecided judge gate lists each question with its answers", () => {
    const p = wakePrompt({
      stop: { ...qa, isJudge: true, text: "Judging each note." },
      rest: "j",
      questions: [
        {
          id: "n1",
          instructions: "Classify note 1",
          criteria: ["edit: change"],
          options: ["edit", "nit"],
        },
      ],
    })
    expect(p).toContain(
      'Question "n1": Classify note 1\n  - edit: change\n  Answers: "edit", "nit"',
    )
    expect(p).toContain("verdicts")
    expect(p).toContain("without verdicts")
  })

  test("pending notes are handed to the next rest", () => {
    const p = wakePrompt({ stop: qa, rest: "r", notes: ["also handle empty input"] })
    expect(p).toContain("- also handle empty input")
  })

  test("a problem asks for a diagnosis before a fix, and consent", () => {
    const p = wakePrompt({
      stop: { kind: "error", text: "landing script exited 1", label: "Building" },
      rest: "e",
    })
    expect(p).toContain("landing script exited 1")
    expect(p).toContain("only with the person's consent")
    expect(p).toContain('with rest "e"')
  })

  test("a finished process offers its pull request", () => {
    const p = wakePrompt({ stop: { kind: "done", text: "" }, rest: "d", branch: "feat/x" })
    expect(p).toContain("feat/x")
    expect(p).toContain(TOOL.ship)
    expect(p).not.toContain(`call ${TOOL.continue}`)
  })
})
