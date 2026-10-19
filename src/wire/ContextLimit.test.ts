import { describe, expect, it } from "vitest"
import {
  CONTEXT_LIMIT_MARKER,
  DEFAULT_CONTEXT_LIMIT,
  contextHook,
  contextLimitFault,
  contextWindowFor,
  hookOutput,
  subagentTranscriptPath,
  transcriptTokens,
} from "./ContextLimit.js"
import { transcriptAt } from "./ContextLimit.fixture.js"

const at = (tokens: number, event: "PostToolUse" | "PreCompact" = "PostToolUse") =>
  contextHook({
    event,
    tokens: transcriptTokens(transcriptAt(tokens)),
    window: 200_000,
    limit: DEFAULT_CONTEXT_LIMIT,
  })

describe("transcriptTokens", () => {
  it("counts the latest assistant message's input, cache-read and cache-creation tokens", () => {
    expect(transcriptTokens(transcriptAt(50_000))).toBe(50_000)
  })

  it("is undefined for a transcript with no assistant usage yet", () => {
    expect(transcriptTokens('{"type":"user"}\nnot json\n')).toBeUndefined()
  })
})

describe("contextHook", () => {
  it("lets a run below the soft limit go on", () => {
    expect(at(119_999)).toBeUndefined()
  })

  it("blocks with a handoff-note request at the soft limit", () => {
    const decision = at(120_000)
    expect(decision?.kind).toBe("soft")
    expect(hookOutput(decision!)).toEqual({
      decision: "block",
      reason: expect.stringContaining("short handoff note"),
    })
  })

  it("stops the run at the hard limit, behind the marker", () => {
    const decision = at(140_000)
    expect(hookOutput(decision!)).toEqual({
      continue: false,
      stopReason: expect.stringMatching(new RegExp(`^${CONTEXT_LIMIT_MARKER}: 140000 of 200000`)),
    })
  })

  it("stops the run on PreCompact, whatever the count", () => {
    expect(hookOutput(at(1_000, "PreCompact")!)).toEqual({
      continue: false,
      stopReason: expect.stringContaining(
        `${CONTEXT_LIMIT_MARKER}: the context is about to be compacted`,
      ),
    })
  })

  it("lets a run with no usage yet go on", () => {
    const limit = DEFAULT_CONTEXT_LIMIT
    expect(
      contextHook({ event: "PostToolUse", tokens: undefined, window: 1, limit }),
    ).toBeUndefined()
  })
})

describe("contextLimitFault", () => {
  it("accepts shares in (0, 1] with soft below hard", () => {
    expect(contextLimitFault({ soft: 0.5, hard: 1 })).toBeUndefined()
    expect(contextLimitFault({ hard: 0.9 })).toBeUndefined()
  })

  it("refuses a share outside (0, 1] and a soft limit at or above the hard one", () => {
    expect(contextLimitFault({ soft: 0 })).toMatch(/context\.soft must be/)
    expect(contextLimitFault({ hard: 70 })).toMatch(/context\.hard must be/)
    expect(contextLimitFault({ soft: 0.8 })).toMatch(/below context\.hard \(0\.7\)/)
    const misspelt: { hard: number } = Object.assign({ hard: 0.8 }, { sotf: 0.5 })
    expect(contextLimitFault(misspelt)).toBe("unknown key(s) sotf in context")
  })
})

it("reads the long window from Claude Code's [1m] suffix only", () => {
  expect(contextWindowFor("opus[1m]")).toBe(1_000_000)
  expect(contextWindowFor("opus")).toBe(200_000)
  expect(contextWindowFor(undefined)).toBe(200_000)
})

it("finds a worker's own transcript beside the main session's", () => {
  expect(subagentTranscriptPath("/p/session.jsonl", "a1")).toBe(
    "/p/session/subagents/agent-a1.jsonl",
  )
})
