import { Context, Effect, Layer } from "effect"
import { GtdConfigService } from "./Config.js"
import { withAgentGuards } from "./AgentGuards.js"
import type { AgentEvent } from "./AgentEvent.js"

export interface AgentInvocation {
  readonly prompt: string
  readonly systemPrompt: string
  readonly mode: "plan" | "build" | "learn"
  readonly cwd: string
  readonly onEvent?: (event: AgentEvent) => void
  readonly resumeSessionId?: string
}

export interface AgentResult {
  readonly sessionId: string | undefined
}

export type AgentErrorReason = "general" | "inactivity_timeout" | "input_requested"

export class AgentError {
  readonly _tag = "AgentError"
  constructor(
    readonly message: string,
    readonly cause?: unknown,
    readonly reason: AgentErrorReason = "general",
  ) {}
}

export interface AgentProvider {
  readonly name: string
  readonly invoke: (params: AgentInvocation) => Effect.Effect<AgentResult, AgentError>
  readonly isAvailable: () => Effect.Effect<boolean>
}

export interface AgentServiceShape extends AgentProvider {
  readonly resolvedName: string
}

export class AgentService extends Context.Tag("AgentService")<AgentService, AgentServiceShape>() {
  static Live = Layer.effect(
    AgentService,
    Effect.gen(function* () {
      const config = yield* GtdConfigService
      const provider = yield* resolveAgent(config.agent)

      const guardsConfig = {
        inactivityTimeoutSeconds: config.agentInactivityTimeout,
        forbiddenTools: config.agentForbiddenTools,
      }

      return {
        name: provider.name,
        resolvedName: provider.name,
        invoke: (params) =>
          Effect.gen(function* () {
            const guarded = withAgentGuards(provider, guardsConfig)
            return yield* guarded.invoke(params)
          }),
        isAvailable: () => Effect.succeed(true),
      }
    }),
  )
}

export const catchAgentError = <A, R>(
  effect: Effect.Effect<A, AgentError | Error, R>,
): Effect.Effect<A, Error, R> =>
  effect.pipe(
    Effect.catchAll((err) => {
      if (err instanceof AgentError) {
        if (err.reason === "inactivity_timeout") {
          console.error(`[gtd] Agent timed out (no activity)`)
          return Effect.void as Effect.Effect<A>
        }
        if (err.reason === "input_requested") {
          console.error(`[gtd] Agent requested user input, aborting`)
          return Effect.void as Effect.Effect<A>
        }
      }
      return Effect.fail(err as Error)
    }),
  )

export const resolveAgent = (agentId: string): Effect.Effect<AgentProvider, AgentError> =>
  Effect.gen(function* () {
    if (agentId === "pi") {
      const { PiAgent } = yield* Effect.promise(() => import("./agents/Pi.js"))
      return PiAgent
    }
    if (agentId === "opencode") {
      const { OpenCodeAgent } = yield* Effect.promise(() => import("./agents/OpenCode.js"))
      return OpenCodeAgent
    }
    if (agentId === "claude") {
      const { ClaudeAgent } = yield* Effect.promise(() => import("./agents/Claude.js"))
      return ClaudeAgent
    }
    if (agentId === "auto") {
      const { PiAgent } = yield* Effect.promise(() => import("./agents/Pi.js"))
      const { OpenCodeAgent } = yield* Effect.promise(() => import("./agents/OpenCode.js"))
      const { ClaudeAgent } = yield* Effect.promise(() => import("./agents/Claude.js"))
      const piAvailable = yield* PiAgent.isAvailable()
      const openCodeAvailable = yield* OpenCodeAgent.isAvailable()
      const claudeAvailable = yield* ClaudeAgent.isAvailable()

      const available: AgentProvider[] = []
      if (piAvailable) available.push(PiAgent)
      if (openCodeAvailable) available.push(OpenCodeAgent)
      if (claudeAvailable) available.push(ClaudeAgent)

      if (available.length === 0) {
        return yield* Effect.fail(
          new AgentError("No agent available. Install pi, opencode, or claude."),
        )
      }

      const first = available[0]!
      const firstName = first.name
      const autoName = `${firstName} (auto)`

      if (available.length === 1) {
        const provider: AgentProvider = {
          name: autoName,
          invoke: (params) => first.invoke(params),
          isAvailable: () => first.isAvailable(),
        }
        return provider
      }

      const provider: AgentProvider = {
        name: autoName,
        isAvailable: () => Effect.succeed(true),
        invoke: (params) =>
          available
            .slice(1)
            .reduce(
              (eff, agent) => eff.pipe(Effect.catchAll(() => agent.invoke(params))),
              first.invoke(params),
            ),
      }
      return provider
    }
    return yield* Effect.fail(new AgentError(`Unknown agent: ${agentId}`))
  })
