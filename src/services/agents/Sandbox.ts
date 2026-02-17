import { Effect } from "effect"
import type { AgentProvider, AgentInvocation, AgentResult } from "../Agent.js"
import { AgentEvents } from "../AgentEvent.js"
import {
  defaultFilesystemConfig,
  defaultNetworkConfig,
  type FilesystemConfig,
  type NetworkConfig,
  type FilesystemUserOverrides,
  type NetworkUserOverrides,
} from "../SandboxBoundaries.js"

export const isSandboxRuntimeAvailable: Effect.Effect<boolean> = Effect.try({
  try: () => {
    const mod = "@anthropic-ai/sandbox-runtime"
    require.resolve(mod)
    return true
  },
  catch: () => false,
}).pipe(Effect.catchAll(() => Effect.succeed(false)))

export interface SandboxConfig {
  readonly filesystem: FilesystemConfig
  readonly network: NetworkConfig
}

export interface SandboxOverrides {
  readonly filesystem?: FilesystemUserOverrides | undefined
  readonly network?: NetworkUserOverrides | undefined
}

export const buildSandboxConfig = (
  params: AgentInvocation,
  providerType: import("../ForbiddenTools.js").AgentProviderType,
  overrides?: SandboxOverrides,
): SandboxConfig => ({
  filesystem: defaultFilesystemConfig(params.cwd, overrides?.filesystem),
  network: defaultNetworkConfig(providerType, overrides?.network),
})

export const SandboxAgent = (inner: AgentProvider, overrides?: SandboxOverrides): AgentProvider => ({
  name: `${inner.name} (sandbox)`,
  providerType: inner.providerType,
  isAvailable: () => inner.isAvailable(),
  invoke: (params: AgentInvocation): Effect.Effect<AgentResult, import("../Agent.js").AgentError> =>
    Effect.gen(function* () {
      const _sandboxConfig = buildSandboxConfig(params, inner.providerType, overrides)
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
