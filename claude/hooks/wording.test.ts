import { describe, expect, test } from "vitest"

import { headline, jobHeadline, jobPushText, pushText, restartLine, runningLine } from "./wording"

const gate = {
  kind: "gate" as const,
  text: "",
  state: "build.review.await-review",
  label: "Awaiting your review",
}

describe("wording", () => {
  test("a gate names the step by its label, never its state id", () => {
    expect(headline(gate)).toBe("● needs your input — Awaiting your review")
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

test("restartLine names the scope and the cause", () => {
  expect(restartLine("build")).toBe("build: skills or system changed — started a fresh subagent")
})

describe("job reports", () => {
  const good = { ok: true, text: "Opened https://github.com/o/r/pull/7" }
  const bad = { ok: false, text: "git push failed." }

  test("success and failure headlines differ per job, a failure never reads as success", () => {
    const all = (["ship", "handoff"] as const).flatMap((j) => [
      jobHeadline(j, good),
      jobHeadline(j, bad),
    ])
    expect(new Set(all).size).toBe(4)
    expect(jobHeadline("ship", bad)).toMatch(/fail/i)
    expect(jobHeadline("handoff", bad)).toMatch(/fail/i)
    expect(jobHeadline("ship", good)).not.toMatch(/fail/i)
  })

  test("the push names the repository and the outcome", () => {
    expect(jobPushText("ship", good, "llm-judge")).toContain("llm-judge")
    expect(jobPushText("ship", good, "llm-judge")).toContain("pull/7")
    expect(jobPushText("handoff", bad, "llm-judge")).toContain("llm-judge")
    expect(jobPushText("handoff", bad, "llm-judge")).toContain("git push failed.")
  })
})
