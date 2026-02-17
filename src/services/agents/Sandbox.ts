import { Effect } from "effect"
import type { AgentProvider, AgentInvocation, AgentResult } from "../Agent.js"
import { AgentEvents } from "../AgentEvent.js"

export const isSandboxRuntimeAvailable: Effect.Effect<boolean> = Effect.try({
  try: () => {
    const mod = "@anthropic-ai/sandbox-runtime"
    require.resolve(mod)
    return true
  },
  catch: () => false,
}).pipe(Effect.catchAll(() => Effect.succeed(false)))

export const SandboxAgent = (inner: AgentProvider): AgentProvider => ({
  name: `${inner.name} (sandbox)`,
  providerType: inner.providerType,
  isAvailable: () => inner.isAvailable(),
  invoke: (params: AgentInvocation): Effect.Effect<AgentResult, import("../Agent.js").AgentError> =>
    Effect.gen(function* () {
      params.onEvent?.(AgentEvents.sandboxStarted())

      return yield* inner.invoke(params).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            params.onEvent?.(AgentEvents.sandboxStopped())
          }),
        ),
      )
    }),
})
