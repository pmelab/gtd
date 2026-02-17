import { Effect } from "effect"
import { AgentError } from "./Agent.js"
import type { AgentProvider, AgentInvocation, AgentResult } from "./Agent.js"
import type { AgentEvent } from "./AgentEvent.js"

export interface AgentGuardsConfig {
  readonly inactivityTimeoutSeconds: number
  readonly forbiddenTools: ReadonlyArray<string>
}

export const withAgentGuards = (
  provider: AgentProvider,
  config: AgentGuardsConfig,
): AgentProvider => {
  const hasTimeout = config.inactivityTimeoutSeconds > 0
  const hasForbidden = config.forbiddenTools.length > 0

  if (!hasTimeout && !hasForbidden) return provider

  return {
    name: provider.name,
    providerType: provider.providerType,
    isAvailable: () => provider.isAvailable(),
    invoke: (params) =>
      Effect.gen(function* () {
        let lastEventTime = Date.now()
        let forbiddenToolDetected: string | undefined

        const wrappedOnEvent = (event: AgentEvent) => {
          lastEventTime = Date.now()
          if (
            hasForbidden &&
            event._tag === "ToolStart" &&
            config.forbiddenTools.includes(event.toolName)
          ) {
            forbiddenToolDetected = event.toolName
          }
          params.onEvent?.(event)
        }

        const wrappedParams: AgentInvocation = {
          ...params,
          onEvent: wrappedOnEvent,
        }

        // Invocation with post-completion forbidden tool check
        // (catches synchronous agents where polling can't intervene)
        const invocation = provider.invoke(wrappedParams).pipe(
          Effect.flatMap((result) => {
            if (forbiddenToolDetected) {
              return Effect.fail(
                new AgentError(
                  `Agent invoked forbidden tool: ${forbiddenToolDetected}`,
                  undefined,
                  "input_requested",
                ),
              )
            }
            return Effect.succeed(result)
          }),
        )

        if (!hasTimeout) {
          // No timeout — just run with the post-completion check
          return yield* invocation
        }

        // Guard: polls for inactivity timeout and forbidden tools
        const guardEffect = Effect.async<AgentResult, AgentError>((resume) => {
          const pollIntervalMs = Math.min(config.inactivityTimeoutSeconds * 1000, 5000)

          const timer = setInterval(() => {
            if (forbiddenToolDetected) {
              clearInterval(timer)
              resume(
                Effect.fail(
                  new AgentError(
                    `Agent invoked forbidden tool: ${forbiddenToolDetected}`,
                    undefined,
                    "input_requested",
                  ),
                ),
              )
              return
            }

            const elapsed = (Date.now() - lastEventTime) / 1000
            if (elapsed >= config.inactivityTimeoutSeconds) {
              clearInterval(timer)
              resume(
                Effect.fail(
                  new AgentError(
                    `Agent timed out after ${config.inactivityTimeoutSeconds}s of inactivity`,
                    undefined,
                    "inactivity_timeout",
                  ),
                ),
              )
            }
          }, pollIntervalMs)

          return Effect.sync(() => {
            clearInterval(timer)
          })
        })

        return yield* Effect.raceFirst(invocation, guardEffect)
      }),
  }
}
