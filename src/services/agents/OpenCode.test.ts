import { describe, it, expect } from "@effect/vitest"
import { Effect } from "effect"
import { OpenCodeAgent, parseOpenCodeEvent, buildOpenCodeArgs } from "./OpenCode.js"

describe("OpenCodeAgent", () => {
  it("exposes name as 'opencode'", () => {
    expect(OpenCodeAgent.name).toBe("opencode")
  })

  describe("isAvailable", () => {
    it.effect("returns boolean when checking opencode executable", () =>
      Effect.gen(function* () {
        const available = yield* OpenCodeAgent.isAvailable()
        expect(typeof available).toBe("boolean")
      }),
    )
  })

  describe("parseOpenCodeEvent", () => {
    it("parses step_start as TurnStart", () => {
      const event = parseOpenCodeEvent(
        JSON.stringify({
          type: "step_start",
          part: { type: "step-start" },
        }),
      )
      expect(event).toEqual({ _tag: "TurnStart" })
    })

    it("parses text as TextDelta", () => {
      const event = parseOpenCodeEvent(
        JSON.stringify({
          type: "text",
          part: { type: "text", text: "hello" },
        }),
      )
      expect(event).toEqual({ _tag: "TextDelta", delta: "hello" })
    })

    it("parses tool_call as ToolStart", () => {
      const event = parseOpenCodeEvent(
        JSON.stringify({
          type: "tool_call",
          part: { type: "tool-call", tool: "bash" },
        }),
      )
      expect(event).toEqual({ _tag: "ToolStart", toolName: "bash" })
    })

    it("parses tool_result success as ToolEnd", () => {
      const event = parseOpenCodeEvent(
        JSON.stringify({
          type: "tool_result",
          part: { type: "tool-result", tool: "read", error: false },
        }),
      )
      expect(event).toEqual({ _tag: "ToolEnd", toolName: "read", isError: false })
    })

    it("parses tool_result error as ToolEnd", () => {
      const event = parseOpenCodeEvent(
        JSON.stringify({
          type: "tool_result",
          part: { type: "tool-result", tool: "bash", error: true },
        }),
      )
      expect(event).toEqual({ _tag: "ToolEnd", toolName: "bash", isError: true })
    })

    it("parses step_finish as TurnEnd", () => {
      const event = parseOpenCodeEvent(
        JSON.stringify({
          type: "step_finish",
          part: { type: "step-finish", reason: "stop" },
        }),
      )
      expect(event).toEqual({ _tag: "TurnEnd", text: "" })
    })

    it("returns undefined for unknown events", () => {
      const event = parseOpenCodeEvent(JSON.stringify({ type: "unknown" }))
      expect(event).toBeUndefined()
    })

    it("returns undefined for malformed JSON", () => {
      const event = parseOpenCodeEvent("not json")
      expect(event).toBeUndefined()
    })
  })

  describe("buildOpenCodeArgs", () => {
    it("includes --model when model is provided", () => {
      const args = buildOpenCodeArgs({ model: "gpt-4o" })
      const idx = args.indexOf("--model")
      expect(idx).toBeGreaterThan(-1)
      expect(args[idx + 1]).toBe("gpt-4o")
    })

    it("omits --model when model is undefined", () => {
      const args = buildOpenCodeArgs({})
      expect(args).not.toContain("--model")
    })
  })
})
