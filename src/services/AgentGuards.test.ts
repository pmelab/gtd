import { describe, it, expect } from "@effect/vitest"
import { Effect } from "effect"
import { AgentError } from "./Agent.js"
import type { AgentProvider, AgentInvocation } from "./Agent.js"
import { AgentEvents, type AgentEvent } from "./AgentEvent.js"
import { withAgentGuards } from "./AgentGuards.js"

const noop = () => {}

const makeSlowAgent = (
  delayMs: number,
  opts?: { emitEvents?: AgentEvent[]; emitIntervalMs?: number },
): AgentProvider => ({
  name: "slow-mock",
  providerType: "pi",
  invoke: (params) =>
    Effect.async<{ sessionId: string | undefined }, AgentError>((resume) => {
      const timers: ReturnType<typeof setTimeout>[] = []
      if (opts?.emitEvents && params.onEvent) {
        for (const [i, event] of opts.emitEvents.entries()) {
          const timer = setTimeout(
            () => params.onEvent?.(event),
            (opts.emitIntervalMs ?? 100) * (i + 1),
          )
          timers.push(timer)
        }
      }
      const main = setTimeout(() => {
        resume(Effect.succeed({ sessionId: undefined }))
      }, delayMs)
      timers.push(main)
      return Effect.sync(() => {
        for (const t of timers) clearTimeout(t)
      })
    }),
  isAvailable: () => Effect.succeed(true),
})

const makeInstantAgent = (events?: AgentEvent[]): AgentProvider => ({
  name: "instant-mock",
  providerType: "pi",
  invoke: (params) =>
    Effect.sync(() => {
      if (events) {
        for (const event of events) params.onEvent?.(event)
      }
      return { sessionId: undefined }
    }),
  isAvailable: () => Effect.succeed(true),
})

const baseParams: AgentInvocation = {
  prompt: "test",
  systemPrompt: "",
  mode: "build",
  cwd: "/tmp",
  onEvent: noop,
}

describe("withAgentGuards", () => {
  it.effect("normal completion unaffected when guards disabled", () =>
    Effect.gen(function* () {
      const agent = makeInstantAgent()
      const guarded = withAgentGuards(agent, {
        inactivityTimeoutSeconds: 0,
        forbiddenTools: [],
      })
      const result = yield* guarded.invoke(baseParams)
      expect(result.sessionId).toBeUndefined()
    }),
  )

  it.effect("normal completion unaffected with guards enabled", () =>
    Effect.gen(function* () {
      const agent = makeInstantAgent([
        AgentEvents.agentStart(),
        AgentEvents.toolStart("Read"),
        AgentEvents.toolEnd("Read", false),
        AgentEvents.agentEnd(),
      ])
      const guarded = withAgentGuards(agent, {
        inactivityTimeoutSeconds: 5,
        forbiddenTools: ["AskUserQuestion"],
      })
      const result = yield* guarded.invoke(baseParams)
      expect(result.sessionId).toBeUndefined()
    }),
  )

  it.effect("inactivity timeout fires when no events arrive", () =>
    Effect.gen(function* () {
      const agent = makeSlowAgent(10000) // would take 10s
      const guarded = withAgentGuards(agent, {
        inactivityTimeoutSeconds: 1,
        forbiddenTools: [],
      })
      const result = yield* guarded.invoke(baseParams).pipe(Effect.either)
      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left.reason).toBe("inactivity_timeout")
      }
    }),
  )

  it.effect("inactivity timeout resets on events", () =>
    Effect.gen(function* () {
      // Agent takes 3s but emits events every 500ms — timeout is 2s, should NOT fire
      const events = Array.from({ length: 6 }, (_, i) =>
        AgentEvents.textDelta(`chunk${i}`),
      )
      const agent = makeSlowAgent(3000, { emitEvents: events, emitIntervalMs: 500 })
      const guarded = withAgentGuards(agent, {
        inactivityTimeoutSeconds: 2,
        forbiddenTools: [],
      })
      const result = yield* guarded.invoke(baseParams)
      expect(result.sessionId).toBeUndefined()
    }),
  )

  it.effect("forbidden tool detected via ToolStart event", () =>
    Effect.gen(function* () {
      const agent = makeInstantAgent([
        AgentEvents.agentStart(),
        AgentEvents.toolStart("AskUserQuestion"),
      ])
      const guarded = withAgentGuards(agent, {
        inactivityTimeoutSeconds: 0,
        forbiddenTools: ["AskUserQuestion"],
      })
      const result = yield* guarded.invoke(baseParams).pipe(Effect.either)
      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left.reason).toBe("input_requested")
        expect(result.left.message).toContain("AskUserQuestion")
      }
    }),
  )

  it.effect("allowed tools pass through", () =>
    Effect.gen(function* () {
      const agent = makeInstantAgent([
        AgentEvents.agentStart(),
        AgentEvents.toolStart("Read"),
        AgentEvents.toolEnd("Read", false),
        AgentEvents.agentEnd(),
      ])
      const guarded = withAgentGuards(agent, {
        inactivityTimeoutSeconds: 0,
        forbiddenTools: ["AskUserQuestion"],
      })
      const result = yield* guarded.invoke(baseParams)
      expect(result.sessionId).toBeUndefined()
    }),
  )

  it.effect("events are forwarded to original onEvent callback", () =>
    Effect.gen(function* () {
      const received: AgentEvent[] = []
      const agent = makeInstantAgent([
        AgentEvents.agentStart(),
        AgentEvents.textDelta("hello"),
        AgentEvents.agentEnd(),
      ])
      const guarded = withAgentGuards(agent, {
        inactivityTimeoutSeconds: 5,
        forbiddenTools: [],
      })
      const result = yield* guarded.invoke({
        ...baseParams,
        onEvent: (e) => received.push(e),
      })
      expect(received.length).toBe(3)
      expect(received[0]!._tag).toBe("AgentStart")
      expect(received[1]!._tag).toBe("TextDelta")
      expect(received[2]!._tag).toBe("AgentEnd")
    }),
  )

  it.effect("isAvailable delegates to wrapped provider", () =>
    Effect.gen(function* () {
      const agent: AgentProvider = {
        name: "test-mock",
        providerType: "pi",
        invoke: () => Effect.succeed({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(false),
      }
      const guarded = withAgentGuards(agent, {
        inactivityTimeoutSeconds: 0,
        forbiddenTools: [],
      })
      const available = yield* guarded.isAvailable()
      expect(available).toBe(false)
    }),
  )
})
