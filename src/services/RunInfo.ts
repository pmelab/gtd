import { Effect } from "effect"
import { GtdConfigService } from "./Config.js"
import { AgentService } from "./Agent.js"
import { QuietMode } from "./QuietMode.js"
import type { Step } from "./InferStep.js"

export interface RunInfo {
  readonly agent: string
  readonly step: Step
  readonly planFile: string
  readonly configSources: ReadonlyArray<string>
}

export const formatBanner = (info: RunInfo): string => {
  const configs = info.configSources.length > 0 ? info.configSources.join(",") : "<none>"
  return `[gtd] agent=${info.agent} step=${info.step} file=${info.planFile} configs=${configs}`
}

export const gatherRunInfo = (
  step: Step,
): Effect.Effect<RunInfo, never, GtdConfigService | AgentService> =>
  Effect.gen(function* () {
    const config = yield* GtdConfigService
    const agent = yield* AgentService

    return {
      agent: agent.resolvedName,
      step,
      planFile: config.file,
      configSources: config.configSources,
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
