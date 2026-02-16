import { describe, it, expect } from "@effect/vitest"
import { Effect } from "effect"
import { ClaudeAgent, parseClaudeEvent, extractSessionId, buildClaudeArgs } from "./Claude.js"

describe("ClaudeAgent", () => {
  it("exposes name as 'claude'", () => {
    expect(ClaudeAgent.name).toBe("claude")
  })

  describe("isAvailable", () => {
    it.effect("returns boolean when checking claude executable", () =>
      Effect.gen(function* () {
        const available = yield* ClaudeAgent.isAvailable()
        expect(typeof available).toBe("boolean")
      }),
    )
  })

  describe("parseClaudeEvent", () => {
    it("parses system init as AgentStart", () => {
      const event = parseClaudeEvent(JSON.stringify({ type: "system", subtype: "init" }))
      expect(event).toEqual({ _tag: "AgentStart" })
    })

    it("parses assistant message text_delta", () => {
      const event = parseClaudeEvent(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "hello world" }],
          },
        }),
      )
      expect(event).toEqual({ _tag: "TextDelta", delta: "hello world" })
    })

    it("parses assistant message with multiple text blocks", () => {
      const event = parseClaudeEvent(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "first " },
              { type: "text", text: "second" },
            ],
          },
        }),
      )
      expect(event).toEqual({ _tag: "TextDelta", delta: "first second" })
    })

    it("parses assistant message with tool_use as ToolStart", () => {
      const event = parseClaudeEvent(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "tool_use", name: "bash" }],
          },
        }),
      )
      expect(event).toEqual({ _tag: "ToolStart", toolName: "bash" })
    })

    it("parses result success as AgentEnd", () => {
      const event = parseClaudeEvent(
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: "done",
        }),
      )
      expect(event).toEqual({ _tag: "AgentEnd" })
    })

    it("parses result error as AgentEnd", () => {
      const event = parseClaudeEvent(
        JSON.stringify({
          type: "result",
          subtype: "error",
        }),
      )
      expect(event).toEqual({ _tag: "AgentEnd" })
    })

    it("returns undefined for unknown types", () => {
      const event = parseClaudeEvent(JSON.stringify({ type: "unknown" }))
      expect(event).toBeUndefined()
    })

    it("returns undefined for malformed JSON", () => {
      const event = parseClaudeEvent("not json")
      expect(event).toBeUndefined()
    })

    it("parses result event with session_id", () => {
      const event = parseClaudeEvent(
        JSON.stringify({
          type: "result",
          subtype: "success",
          session_id: "abc-123",
          result: "done",
        }),
      )
      expect(event).toEqual({ _tag: "AgentEnd" })
    })

    it("ignores non-text content blocks in assistant messages", () => {
      const event = parseClaudeEvent(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "image", source: {} }],
          },
        }),
      )
      expect(event).toBeUndefined()
    })
  })

  describe("extractSessionId", () => {
    it("extracts session_id from result event", () => {
      const id = extractSessionId(
        JSON.stringify({
          type: "result",
          session_id: "abc-123",
        }),
      )
      expect(id).toBe("abc-123")
    })

    it("returns undefined for non-result events", () => {
      const id = extractSessionId(
        JSON.stringify({
          type: "assistant",
          message: { content: [] },
        }),
      )
      expect(id).toBeUndefined()
    })

    it("returns undefined when session_id missing", () => {
      const id = extractSessionId(
        JSON.stringify({
          type: "result",
          subtype: "success",
        }),
      )
      expect(id).toBeUndefined()
    })

    it("returns undefined for malformed JSON", () => {
      const id = extractSessionId("not json")
      expect(id).toBeUndefined()
    })
  })

  describe("buildClaudeArgs", () => {
    it("builds default args without system prompt or resume", () => {
      const args = buildClaudeArgs({ systemPrompt: "", resumeSessionId: undefined })
      expect(args).toEqual([
        "claude",
        "-p",
        "--verbose",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--dangerously-skip-permissions",
      ])
      expect(args).not.toContain("--system-prompt")
      expect(args).not.toContain("--resume")
    })

    it("includes --system-prompt when provided", () => {
      const args = buildClaudeArgs({ systemPrompt: "be helpful", resumeSessionId: undefined })
      const idx = args.indexOf("--system-prompt")
      expect(idx).toBeGreaterThan(-1)
      expect(args[idx + 1]).toBe("be helpful")
    })

    it("includes --resume when resumeSessionId provided", () => {
      const args = buildClaudeArgs({ systemPrompt: "", resumeSessionId: "ses-123" })
      const idx = args.indexOf("--resume")
      expect(idx).toBeGreaterThan(-1)
      expect(args[idx + 1]).toBe("ses-123")
    })

    it("skips --system-prompt when resuming", () => {
      const args = buildClaudeArgs({ systemPrompt: "be helpful", resumeSessionId: "ses-123" })
      expect(args).not.toContain("--system-prompt")
      expect(args).toContain("--resume")
    })
  })
})
