import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { AgentService, AgentError } from "./Agent.js"
import type { AgentProvider } from "./Agent.js"

const mockAgent: AgentProvider = {
  invoke: () => Effect.void,
  isAvailable: () => Effect.succeed(true),
}

const mockAgentLayer = Layer.succeed(AgentService, mockAgent)

describe("AgentService", () => {
  it.effect("invoke calls the provider", () =>
    Effect.gen(function* () {
      const agent = yield* AgentService
      yield* agent.invoke({
        prompt: "test prompt",
        systemPrompt: "you are a test agent",
        mode: "plan",
        cwd: "/tmp",
      })
    }).pipe(Effect.provide(mockAgentLayer)),
  )

  it.effect("isAvailable returns true for mock", () =>
    Effect.gen(function* () {
      const agent = yield* AgentService
      const available = yield* agent.isAvailable()
      expect(available).toBe(true)
    }).pipe(Effect.provide(mockAgentLayer)),
  )

  it("AgentError has correct tag", () => {
    const err = new AgentError("test")
    expect(err._tag).toBe("AgentError")
    expect(err.message).toBe("test")
    expect(err.reason).toBe("general")
  })

  it("AgentError supports reason field", () => {
    const timeout = new AgentError("timed out", undefined, "inactivity_timeout")
    expect(timeout.reason).toBe("inactivity_timeout")
    const input = new AgentError("input requested", undefined, "input_requested")
    expect(input.reason).toBe("input_requested")
  })
})
