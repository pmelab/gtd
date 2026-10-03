import { describe, expect, test } from "vitest"

import {
  CONTINUE,
  gateOptions,
  HANDOFF,
  headline,
  parseReply,
  pushText,
  question,
  SAFE,
} from "./wording"

const gate = {
  kind: "gate" as const,
  text: "",
  state: "build.review.await-review",
  label: "Awaiting your review",
}

describe("wording", () => {
  test("a gate names the step by its label, never its state id", () => {
    const q = question({ isRunning: false, beat: 0, stop: gate, url: "https://x/" })
    expect(q).toContain("Awaiting your review")
    expect(q).toContain("Open it in your browser: https://x/")
    expect(q).not.toContain("build.review")
    expect(q).not.toMatch(/\bui\b/)
    expect(headline(gate)).toBe("● needs your input — Awaiting your review")
  })

  test("without a browser link it names the file to edit", () => {
    const q = question({ isRunning: false, beat: 0, stop: { ...gate, file: ".gtd/QA.md" } })
    expect(q).toContain("Make your changes in .gtd/QA.md.")
  })

  test("a repeat says nothing has changed yet", () => {
    expect(question({ isRunning: false, beat: 0, stop: gate, isRepeat: true })).toMatch(
      /^You haven't changed anything yet/,
    )
  })

  test("a judge gate offers the safe choice instead of done", () => {
    expect(gateOptions({ ...gate, isJudge: true })).toEqual([SAFE, HANDOFF, "Not now"])
    expect(gateOptions(gate)[0]).toBe(CONTINUE)
  })

  test("a push says what waits and how to act on it from a phone", () => {
    expect(pushText(gate, "llm-judge", "https://x/")).toBe(
      "llm-judge: needs your input — Awaiting your review. Open: https://x/",
    )
    expect(pushText(gate, "llm-judge")).toContain('Reply "continue"')
  })

  test("typed phone replies at a gate", () => {
    expect(parseReply("Continue")).toEqual({ act: "continue" })
    expect(parseReply("not now")).toEqual({ act: "later" })
    expect(parseReply("hand off to @dev")).toEqual({ act: "handoff", to: "dev" })
    expect(parseReply("hand off")).toEqual({ act: "handoff", to: undefined })
    expect(parseReply("why did the tests fail?")).toBeUndefined()
  })
})
