import { Effect } from "effect"
import { homedir } from "node:os"
import { GtdConfigService } from "./Config.js"
import { AgentService } from "./Agent.js"
import { QuietMode } from "./QuietMode.js"
import { resolveAllConfigs } from "./ConfigResolver.js"
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

    const home = homedir()
    const xdgConfigHome = process.env.XDG_CONFIG_HOME ?? `${home}/.config`
    const configs = yield* resolveAllConfigs({
      cwd: process.cwd(),
      home,
      xdgConfigHome,
    }).pipe(Effect.catchAll(() => Effect.succeed([] as const)))

    return {
      agent: agent.resolvedName,
      step,
      planFile: config.file,
      configSources: configs.map((c) => c.filepath),
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
