import { Effect } from "effect"
import { GtdConfigService, type GtdConfig } from "./Config.js"
import { AgentService } from "./Agent.js"
import { QuietMode } from "./QuietMode.js"
import type { Step } from "./InferStep.js"

export interface RunInfo {
  readonly agent: string
  readonly step: Step
  readonly planFile: string
  readonly configSources: ReadonlyArray<string>
  readonly model?: string | undefined
}

export const formatBanner = (info: RunInfo): string => {
  const configs = info.configSources.length > 0 ? info.configSources.join(",") : "<none>"
  const model = info.model ? ` model=${info.model}` : ""
  return `[gtd] agent=${info.agent} step=${info.step}${model} file=${info.planFile} configs=${configs}`
}

const resolveModelForStep = (step: Step, config: GtdConfig): string | undefined => {
  switch (step) {
    case "plan":
    case "commit-feedback":
      return config.modelPlan
    case "build":
      return config.modelBuild
    case "learn":
      return config.modelLearn
    case "explore":
    case "cleanup":
    case "idle":
      return undefined
  }
}

export const gatherRunInfo = (
  step: Step,
): Effect.Effect<RunInfo, never, GtdConfigService | AgentService> =>
  Effect.gen(function* () {
    const config = yield* GtdConfigService
    const agent = yield* AgentService
    const model = resolveModelForStep(step, config)

    return {
      agent: agent.resolvedName,
      step,
      planFile: config.file,
      configSources: config.configSources,
      model,
    }
  })

export const printBanner = (
  step: Step,
): Effect.Effect<void, never, GtdConfigService | AgentService | QuietMode> =>
  Effect.gen(function* () {
    const { isQuiet } = yield* QuietMode
    if (isQuiet) return

    const info = yield* gatherRunInfo(step)
    process.stderr.write(formatBanner(info) + "\n")
  })
