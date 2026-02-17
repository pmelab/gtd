import { Context, Effect, Layer } from "effect"
import { homedir } from "node:os"
import { resolveAllConfigs, mergeConfigs, type ResolveOptions } from "./ConfigResolver.js"

import type { BoundaryLevel, WorkflowPhase, FilesystemUserOverrides, NetworkUserOverrides } from "./SandboxBoundaries.js"

export interface EscalationRule {
  readonly from: BoundaryLevel
  readonly to: BoundaryLevel
}

export interface SandboxBoundariesConfig {
  readonly plan?: BoundaryLevel
  readonly build?: BoundaryLevel
  readonly learn?: BoundaryLevel
  readonly filesystem?: FilesystemUserOverrides
  readonly network?: NetworkUserOverrides
}

export interface GtdConfig {
  readonly file: string
  readonly agent: string
  readonly agentPlan: string
  readonly agentBuild: string
  readonly agentLearn: string
  readonly testCmd: string
  readonly testRetries: number
  readonly commitPrompt: string
  readonly agentInactivityTimeout: number
  readonly sandboxEnabled: boolean
  readonly sandboxBoundaries: SandboxBoundariesConfig
  readonly sandboxEscalationPolicy: "auto" | "prompt"
  readonly sandboxApprovedEscalations: ReadonlyArray<EscalationRule>
  readonly configSources: ReadonlyArray<string>
}

export class GtdConfigService extends Context.Tag("GtdConfigService")<
  GtdConfigService,
  GtdConfig
>() {
  static make = (options: ResolveOptions): Layer.Layer<GtdConfigService> =>
    Layer.effect(
      GtdConfigService,
      Effect.gen(function* () {
        const configs = yield* resolveAllConfigs(options)
        return mergeConfigs(configs)
      }),
    )

  static Live = GtdConfigService.make({
    cwd: process.cwd(),
    home: homedir(),
    xdgConfigHome: process.env.XDG_CONFIG_HOME ?? `${homedir()}/.config`,
  })
}
