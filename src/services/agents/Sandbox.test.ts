import { describe, it, expect } from "@effect/vitest"
import { Effect } from "effect"
import type { AgentProvider, AgentInvocation } from "../Agent.js"
import { AgentError } from "../Agent.js"
import type { AgentEvent } from "../AgentEvent.js"
import { AgentEvents } from "../AgentEvent.js"
import { SandboxAgent, isSandboxRuntimeAvailable } from "./Sandbox.js"

const makeInvocation = (overrides?: Partial<AgentInvocation>): AgentInvocation => ({
  prompt: "test prompt",
  systemPrompt: "test system",
  mode: "plan",
  cwd: "/tmp",
  ...overrides,
})

const makeMockProvider = (
  overrides?: Partial<AgentProvider>,
): AgentProvider & { readonly getInvokedWith: () => AgentInvocation | undefined } => {
  let invokedWith: AgentInvocation | undefined
  return {
    name: "mock",
    providerType: "pi",
    isAvailable: () => Effect.succeed(true),
    invoke: (params) => {
      invokedWith = params
      return Effect.succeed({ sessionId: undefined })
    },
    ...overrides,
    getInvokedWith: () => invokedWith,
  }
}

describe("SandboxAgent", () => {
  it("wraps inner provider name", () => {
    const inner = makeMockProvider()
    const sandbox = SandboxAgent(inner)
    expect(sandbox.name).toBe("mock (sandbox)")
  })

  it("preserves inner provider type", () => {
    const inner = makeMockProvider({ providerType: "claude" })
    const sandbox = SandboxAgent(inner)
    expect(sandbox.providerType).toBe("claude")
  })

  it("delegates invoke to inner provider", async () => {
    const inner = makeMockProvider()
    const sandbox = SandboxAgent(inner)
    const invocation = makeInvocation()
    await Effect.runPromise(sandbox.invoke(invocation))
    const invokedWith = inner.getInvokedWith()
    expect(invokedWith).toBeDefined()
    expect(invokedWith!.prompt).toBe("test prompt")
    expect(invokedWith!.systemPrompt).toBe("test system")
    expect(invokedWith!.mode).toBe("plan")
    expect(invokedWith!.cwd).toBe("/tmp")
  })

  it("returns inner provider result", async () => {
    const inner = makeMockProvider({
      invoke: () => Effect.succeed({ sessionId: "session-123" }),
    })
    const sandbox = SandboxAgent(inner)
    const result = await Effect.runPromise(sandbox.invoke(makeInvocation()))
    expect(result.sessionId).toBe("session-123")
  })

  it("forwards events from inner provider", async () => {
    const events: AgentEvent[] = []
    const inner = makeMockProvider({
      invoke: (params) => {
        params.onEvent?.(AgentEvents.agentStart())
        params.onEvent?.(AgentEvents.textDelta("hello"))
        params.onEvent?.(AgentEvents.agentEnd())
        return Effect.succeed({ sessionId: undefined })
      },
    })
    const sandbox = SandboxAgent(inner)
    await Effect.runPromise(sandbox.invoke(makeInvocation({ onEvent: (e) => events.push(e) })))
    const tags = events.map((e) => e._tag)
    expect(tags).toContain("AgentStart")
    expect(tags).toContain("TextDelta")
    expect(tags).toContain("AgentEnd")
  })

  it("emits sandbox lifecycle events", async () => {
    const events: AgentEvent[] = []
    const inner = makeMockProvider()
    const sandbox = SandboxAgent(inner)
    await Effect.runPromise(sandbox.invoke(makeInvocation({ onEvent: (e) => events.push(e) })))
    const tags = events.map((e) => e._tag)
    expect(tags[0]).toBe("SandboxStarted")
    expect(tags[tags.length - 1]).toBe("SandboxStopped")
  })

  it("tears down sandbox on inner provider error", async () => {
    const events: AgentEvent[] = []
    const inner = makeMockProvider({
      invoke: () => Effect.fail(new AgentError("inner failed")),
    })
    const sandbox = SandboxAgent(inner)
    const result = await Effect.runPromise(
      sandbox.invoke(makeInvocation({ onEvent: (e) => events.push(e) })).pipe(Effect.either),
    )
    expect(result._tag).toBe("Left")
    const tags = events.map((e) => e._tag)
    expect(tags).toContain("SandboxStarted")
    expect(tags).toContain("SandboxStopped")
  })

  it("delegates isAvailable to inner provider", async () => {
    const inner = makeMockProvider({ isAvailable: () => Effect.succeed(false) })
    const sandbox = SandboxAgent(inner)
    const available = await Effect.runPromise(sandbox.isAvailable())
    expect(available).toBe(false)
  })

  it("passes through resumeSessionId", async () => {
    const inner = makeMockProvider()
    const sandbox = SandboxAgent(inner)
    await Effect.runPromise(sandbox.invoke(makeInvocation({ resumeSessionId: "resume-456" })))
    expect(inner.getInvokedWith()!.resumeSessionId).toBe("resume-456")
  })
})

describe("isSandboxRuntimeAvailable", () => {
  it("returns a boolean", async () => {
    const result = await Effect.runPromise(isSandboxRuntimeAvailable)
    expect(typeof result).toBe("boolean")
  })
})
