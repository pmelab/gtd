import { describe, it, expect } from "@effect/vitest"
import { Effect } from "effect"
import { PiAgent, parsePiEvent, buildPiArgs } from "./Pi.js"
import type { AgentEvent } from "../AgentEvent.js"

describe("PiAgent", () => {
  it("exposes name as 'pi'", () => {
    expect(PiAgent.name).toBe("pi")
  })

  describe("isAvailable", () => {
    it.effect("returns boolean when checking pi executable", () =>
      Effect.gen(function* () {
        const available = yield* PiAgent.isAvailable()
        expect(typeof available).toBe("boolean")
      }),
    )
  })

  describe("parsePiEvent", () => {
    it("parses agent_start", () => {
      const event = parsePiEvent(JSON.stringify({ type: "agent_start" }))
      expect(event).toEqual({ _tag: "AgentStart" })
    })

    it("parses agent_end", () => {
      const event = parsePiEvent(JSON.stringify({ type: "agent_end", messages: [] }))
      expect(event).toEqual({ _tag: "AgentEnd" })
    })

    it("parses turn_start", () => {
      const event = parsePiEvent(JSON.stringify({ type: "turn_start" }))
      expect(event).toEqual({ _tag: "TurnStart" })
    })

    it("parses text_delta", () => {
      const event = parsePiEvent(
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "hello" },
        }),
      )
      expect(event).toEqual({ _tag: "TextDelta", delta: "hello" })
    })

    it("parses turn_end with full text", () => {
      const event = parsePiEvent(
        JSON.stringify({
          type: "turn_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "full response" }],
          },
        }),
      )
      expect(event).toEqual({ _tag: "TurnEnd", text: "full response" })
    })

    it("parses turn_end with multiple text blocks", () => {
      const event = parsePiEvent(
        JSON.stringify({
          type: "turn_end",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "first " },
              { type: "text", text: "second" },
            ],
          },
        }),
      )
      expect(event).toEqual({ _tag: "TurnEnd", text: "first second" })
    })

    it("parses tool_execution_start", () => {
      const event = parsePiEvent(
        JSON.stringify({
          type: "tool_execution_start",
          toolName: "bash",
        }),
      )
      expect(event).toEqual({ _tag: "ToolStart", toolName: "bash" })
    })

    it("parses tool_execution_end success", () => {
      const event = parsePiEvent(
        JSON.stringify({
          type: "tool_execution_end",
          toolName: "read",
          isError: false,
        }),
      )
      expect(event).toEqual({ _tag: "ToolEnd", toolName: "read", isError: false })
    })

    it("parses tool_execution_end error", () => {
      const event = parsePiEvent(
        JSON.stringify({
          type: "tool_execution_end",
          toolName: "bash",
          isError: true,
        }),
      )
      expect(event).toEqual({ _tag: "ToolEnd", toolName: "bash", isError: true })
    })

    it("returns undefined for unknown events", () => {
      const event = parsePiEvent(JSON.stringify({ type: "session" }))
      expect(event).toBeUndefined()
    })

    it("returns undefined for malformed JSON", () => {
      const event = parsePiEvent("not json")
      expect(event).toBeUndefined()
    })

    it("returns undefined for message_update without text_delta", () => {
      const event = parsePiEvent(
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: { type: "text_start" },
        }),
      )
      expect(event).toBeUndefined()
    })
  })

  describe("buildPiArgs", () => {
    it("includes --model when model is provided", () => {
      const args = buildPiArgs({ systemPrompt: "", prompt: "hello", model: "some-model" })
      const idx = args.indexOf("--model")
      expect(idx).toBeGreaterThan(-1)
      expect(args[idx + 1]).toBe("some-model")
    })

    it("omits --model when model is undefined", () => {
      const args = buildPiArgs({ systemPrompt: "", prompt: "hello" })
      expect(args).not.toContain("--model")
    })
  })
})
