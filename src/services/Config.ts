import { Context, Effect, Layer } from "effect"
import { homedir } from "node:os"
import { resolveAllConfigs, mergeConfigs, type ResolveOptions } from "./ConfigResolver.js"

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
  readonly agentForbiddenTools: ReadonlyArray<string>
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
