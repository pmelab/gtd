import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { AgentService, AgentError, resolveAgent } from "./Agent.js"
import type { AgentProvider } from "./Agent.js"
import { GtdConfigService } from "./Config.js"

const mockAgent: AgentProvider = {
  name: "mock",
  providerType: "pi",
  invoke: () => Effect.succeed({ sessionId: undefined }),
  isAvailable: () => Effect.succeed(true),
}

const mockAgentLayer = Layer.succeed(AgentService, { ...mockAgent, resolvedName: "mock", providerType: "pi" as const })

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

describe("resolveAgent", () => {
  it.effect("auto resolution sets name with (auto) suffix", () =>
    Effect.gen(function* () {
      const provider = yield* resolveAgent("auto")
      expect(provider.name).toContain("(auto)")
    }),
  )

  it.effect("pi resolution sets name to 'pi'", () =>
    Effect.gen(function* () {
      const provider = yield* resolveAgent("pi")
      expect(provider.name).toBe("pi")
    }),
  )

  it.effect("opencode resolution sets name to 'opencode'", () =>
    Effect.gen(function* () {
      const provider = yield* resolveAgent("opencode")
      expect(provider.name).toBe("opencode")
    }),
  )

  it.effect("claude resolution sets name to 'claude'", () =>
    Effect.gen(function* () {
      const provider = yield* resolveAgent("claude")
      expect(provider.name).toBe("claude")
    }),
  )
})

describe("AgentService.Live", () => {
  it.effect("exposes resolved agent name with auto config", () =>
    Effect.gen(function* () {
      const agent = yield* AgentService
      expect(typeof agent.resolvedName).toBe("string")
      expect(agent.resolvedName.length).toBeGreaterThan(0)
    }).pipe(
      Effect.provide(
        AgentService.Live.pipe(
          Layer.provide(
            Layer.succeed(GtdConfigService, {
              file: "TODO.md",
              agent: "auto",
              agentPlan: "auto",
              agentBuild: "auto",
              agentLearn: "auto",
              testCmd: "",
              testRetries: 0,
              commitPrompt: "",
              agentInactivityTimeout: 300,
              configSources: [],
            }),
          ),
        ),
      ),
    ),
  )
})
