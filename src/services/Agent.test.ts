import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { AgentService, AgentError, resolveModelForMode } from "./Agent.js"

const mockAgentLayer = Layer.succeed(AgentService, {
  resolvedName: "mock",
  invoke: () => Effect.succeed({ sessionId: undefined }),
})

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

  it.effect("exposes resolvedName", () =>
    Effect.gen(function* () {
      const agent = yield* AgentService
      expect(agent.resolvedName).toBe("mock")
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

describe("resolveModelForMode", () => {
  const configWithModels = {
    modelPlan: "sonnet-4",
    modelBuild: "opus",
    modelCommit: "flash",
  }

  const configNoModels = {
    modelPlan: undefined,
    modelBuild: undefined,
    modelCommit: undefined,
  }

  it("returns modelPlan for plan mode", () => {
    expect(resolveModelForMode("plan", configWithModels)).toBe("sonnet-4")
  })

  it("returns modelBuild for build mode", () => {
    expect(resolveModelForMode("build", configWithModels)).toBe("opus")
  })

  it("returns modelCommit for commit mode", () => {
    expect(resolveModelForMode("commit", configWithModels)).toBe("flash")
  })

  it("returns undefined when modelPlan is not set", () => {
    expect(resolveModelForMode("plan", configNoModels)).toBeUndefined()
  })

  it("returns undefined when modelCommit is not set", () => {
    expect(resolveModelForMode("commit", configNoModels)).toBeUndefined()
  })
})
