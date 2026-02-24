import { Context, Effect, Layer } from "effect"
import { GtdConfigService } from "./Config.js"
import { AgentEvents, type AgentEvent } from "./AgentEvent.js"
import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  createCodingTools,
} from "@mariozechner/pi-coding-agent"
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent"

export interface AgentInvocation {
  readonly prompt: string
  readonly systemPrompt: string
  readonly mode: "plan" | "build" | "learn" | "commit"
  readonly cwd: string
  readonly model?: string
  readonly onEvent?: (event: AgentEvent) => void
  readonly resumeSessionId?: string
}

export interface ModelConfig {
  readonly modelPlan: string | undefined
  readonly modelBuild: string | undefined
  readonly modelLearn: string | undefined
  readonly modelCommit: string | undefined
}

export const resolveModelForMode = (
  mode: AgentInvocation["mode"],
  config: ModelConfig,
): string | undefined => {
  switch (mode) {
    case "plan":
      return config.modelPlan
    case "build":
      return config.modelBuild
    case "learn":
      return config.modelLearn
    case "commit":
      return config.modelCommit
  }
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

export interface AgentServiceShape {
  readonly resolvedName: string
  readonly invoke: (
    params: AgentInvocation,
  ) => Effect.Effect<AgentResult, AgentError>
}

export class AgentService extends Context.Tag("AgentService")<AgentService, AgentServiceShape>() {
  static Live = Layer.effect(
    AgentService,
    Effect.gen(function* () {
      const config = yield* GtdConfigService
      const authStorage = AuthStorage.create()
      const modelRegistry = new ModelRegistry(authStorage)

      return {
        resolvedName: "pi",
        invoke: (params) =>
          Effect.gen(function* () {
            const model = resolveModelForMode(params.mode, config)
            const modelStr = params.model ?? model

            // Resolve model from registry
            let resolvedModel = undefined
            if (modelStr) {
              const parts = modelStr.split("/")
              if (parts.length === 2) {
                resolvedModel = modelRegistry.find(parts[0]!, parts[1]!)
              } else {
                // Try common providers
                resolvedModel =
                  modelRegistry.find("anthropic", modelStr) ??
                  modelRegistry.find("openai", modelStr) ??
                  modelRegistry.find("google", modelStr)
              }
            }

            // Session management
            const sessionManager = params.resumeSessionId
              ? SessionManager.open(params.resumeSessionId)
              : SessionManager.inMemory(params.cwd)

            const tools = createCodingTools(params.cwd)

            const sessionOpts: Parameters<typeof createAgentSession>[0] = {
              cwd: params.cwd,
              authStorage,
              modelRegistry,
              tools,
              sessionManager,
            }
            if (resolvedModel) sessionOpts.model = resolvedModel

            const { session } = yield* Effect.tryPromise({
              try: () => createAgentSession(sessionOpts),
              catch: (err) => new AgentError("Failed to create agent session", err),
            })

            // Override system prompt
            if (params.systemPrompt) {
              session.agent.state.systemPrompt = params.systemPrompt
            }

            // Event mapping
            const mapEvent = (event: AgentSessionEvent): AgentEvent | undefined => {
              switch (event.type) {
                case "agent_start":
                  return AgentEvents.agentStart()
                case "agent_end":
                  return AgentEvents.agentEnd()
                case "turn_start":
                  return AgentEvents.turnStart()
                case "turn_end": {
                  const msg = event.message
                  let text = ""
                  if (msg && "content" in msg && Array.isArray(msg.content)) {
                    for (const c of msg.content) {
                      if ("type" in c && c.type === "text" && "text" in c) {
                        text += (c as { text: string }).text
                      }
                    }
                  }
                  return AgentEvents.turnEnd(text)
                }
                case "message_update": {
                  const ame = event.assistantMessageEvent
                  if (ame.type === "text_delta") {
                    return AgentEvents.textDelta(ame.delta)
                  }
                  if (ame.type === "thinking_delta") {
                    return AgentEvents.thinkingDelta(ame.delta)
                  }
                  return undefined
                }
                case "tool_execution_start":
                  return AgentEvents.toolStart(event.toolName, event.args)
                case "tool_execution_end": {
                  const output =
                    typeof event.result === "string"
                      ? event.result
                      : event.result != null
                        ? JSON.stringify(event.result)
                        : undefined
                  return AgentEvents.toolEnd(event.toolName, event.isError, output)
                }
                default:
                  return undefined
              }
            }

            // Subscribe to events with inactivity timeout
            let lastEventTime = Date.now()
            const timeoutSeconds = config.agentInactivityTimeout

            session.subscribe((event: AgentSessionEvent) => {
              lastEventTime = Date.now()
              const mapped = mapEvent(event)
              if (mapped) {
                params.onEvent?.(mapped)
              }
            })

            // Run prompt with inactivity timeout
            const promptEffect = Effect.tryPromise({
              try: () => session.prompt(params.prompt, { source: "noninteractive" as any }),
              catch: (err) => new AgentError("Agent prompt failed", err),
            })

            const timeoutEffect =
              timeoutSeconds > 0
                ? Effect.async<AgentResult, AgentError>((resume) => {
                    const pollMs = Math.min(timeoutSeconds * 1000, 5000)
                    const timer = setInterval(() => {
                      const elapsed = (Date.now() - lastEventTime) / 1000
                      if (elapsed >= timeoutSeconds) {
                        clearInterval(timer)
                        session.abort().catch(() => {})
                        resume(
                          Effect.fail(
                            new AgentError(
                              `Agent timed out after ${timeoutSeconds}s of inactivity`,
                              undefined,
                              "inactivity_timeout",
                            ),
                          ),
                        )
                      }
                    }, pollMs)
                    return Effect.sync(() => clearInterval(timer))
                  })
                : undefined

            if (timeoutEffect) {
              yield* Effect.raceFirst(
                promptEffect.pipe(Effect.map(() => ({ sessionId: session.sessionFile }))),
                timeoutEffect,
              )
            } else {
              yield* promptEffect
            }

            session.dispose()

            return { sessionId: session.sessionFile }
          }),
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
