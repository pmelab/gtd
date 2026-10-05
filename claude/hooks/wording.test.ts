import { describe, expect, test } from "vitest"

import {
  CONTINUE,
  gateOptions,
  HANDOFF,
  headline,
  pushText,
  question,
  runningLine,
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
    expect(pushText(gate, "llm-judge")).toBe("llm-judge: needs your input — Awaiting your review")
  })

  test("the running band reads as working to herdr", () => {
    // herdr's live_turn_working rule for Claude (agent-detection claude.toml)
    const working =
      /^\s*[\u002A\u00B7\u2722\u2733\u2736\u273B\u273D]\s+\S.*…(?:\s+\(\d+[smh](?:\s|·)|\s*$)/
    for (const ms of [5_000, 180_000, 7_200_000]) {
      const line = runningLine("Checking the baseline", 3, ms)
      expect(working.test(`${line}   [ Stop ]   [-]`)).toBe(true)
    }
    expect(runningLine("Building", 2, 65_000)).toBe("✳ gtd ▸ Building… (1m · step 2)")
  })
})
