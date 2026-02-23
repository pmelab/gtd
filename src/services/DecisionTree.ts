import { Effect } from "effect"
import { GtdConfigService, type GtdConfig } from "./Config.js"
import { AgentService } from "./Agent.js"
import { QuietMode } from "./QuietMode.js"
import type { InferStepInput } from "./InferStep.js"
import type { Step } from "./InferStep.js"
import { isInteractive, ANSI } from "./Renderer.js"
import {
  HUMAN,
  PLAN,
  BUILD,
  FIX,
  LEARN,
  CLEANUP,
  SEED,
  FEEDBACK,
  EXPLORE,
} from "./CommitPrefix.js"

const prefixLabel = (prefix: string | undefined): string => {
  switch (prefix) {
    case HUMAN:
      return "human edit"
    case PLAN:
      return "plan"
    case BUILD:
      return "build"
    case FIX:
      return "fix"
    case LEARN:
      return "learn"
    case CLEANUP:
      return "cleanup"
    case SEED:
      return "seed"
    case FEEDBACK:
      return "feedback"
    case EXPLORE:
      return "explore"
    default:
      return "none"
  }
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
      return config.modelExplore
    case "cleanup":
    case "idle":
      return undefined
  }
}

export interface StartupInfo {
  readonly agent: string
  readonly step: Step
  readonly model: string | undefined
  readonly state: InferStepInput
}

export const gatherStartupInfo = (
  state: InferStepInput,
  step: Step,
): Effect.Effect<StartupInfo, never, GtdConfigService | AgentService> =>
  Effect.gen(function* () {
    const config = yield* GtdConfigService
    const agent = yield* AgentService
    const model = resolveModelForStep(step, config)

    return { agent: agent.resolvedName, step, model, state }
  })

const describeReason = (state: InferStepInput, step: Step): string => {
  if (state.hasUncommittedChanges) {
    return "Uncommitted changes detected, committing feedback first."
  }

  const last = prefixLabel(state.lastCommitPrefix)

  switch (state.lastCommitPrefix) {
    case PLAN:
      return `Last commit was a ${last} step, so proceeding to ${step}.`
    case BUILD:
    case FIX:
      if (state.todoFileIsNew) return `Last commit was a ${last} step with a new todo file, so proceeding to ${step}.`
      if (state.hasUncheckedItems) return `Last commit was a ${last} step with unchecked items, so proceeding to ${step}.`
      return `Last commit was a ${last} step with all items checked, so proceeding to ${step}.`
    case HUMAN:
      if (state.onlyLearningsModified) return `Last commit was a ${last} (learnings only), so proceeding to ${step}.`
      return `Last commit was a ${last}, so proceeding to ${step}.`
    case FEEDBACK:
      if (state.onlyLearningsModified) return `Last commit was ${last} (learnings only), so proceeding to ${step}.`
      return `Last commit was ${last}, so proceeding to ${step}.`
    case SEED:
    case EXPLORE:
    case LEARN:
    case CLEANUP:
      return `Last commit was a ${last} step, so proceeding to ${step}.`
    default:
      if (state.todoFileIsNew) return `New todo file detected, so proceeding to ${step}.`
      return `No recognized commit prefix. Next step: ${step}.`
  }
}

export const formatStartupMessage = (info: StartupInfo, interactive: boolean): string => {
  const { agent, step, model, state } = info

  if (step === "idle") {
    if (interactive) {
      return `  ${ANSI.dim}Nothing to do. Create a TODO.md or add in-code comments to start.${ANSI.reset}`
    }
    return `[gtd] Nothing to do. Create a TODO.md or add in-code comments to start.`
  }

  const modelPart = model ? ` with model ${interactive ? ANSI.cyan + model + ANSI.reset : model}` : ""
  const agentPart = interactive ? ANSI.cyan + agent + ANSI.reset : agent
  const stepPart = interactive ? ANSI.cyan + step + ANSI.reset : step

  const line1 = `Using ${agentPart} to ${stepPart}${modelPart}.`
  const reason = describeReason(state, step)

  if (interactive) {
    return `  ${ANSI.dim}${line1}${ANSI.reset}\n  ${ANSI.dim}${reason}${ANSI.reset}`
  }
  return `[gtd] ${line1}\n[gtd] ${reason}`
}

// Kept for backwards compatibility with existing tests
export const formatDecisionTrace = (state: InferStepInput, step: Step): string => {
  const info: StartupInfo = { agent: "unknown", step, model: undefined, state }
  return formatStartupMessage(info, false)
}

export const printStartupMessage = (
  state: InferStepInput,
  step: Step,
): Effect.Effect<void, never, GtdConfigService | AgentService | QuietMode> =>
  Effect.gen(function* () {
    const { isQuiet } = yield* QuietMode
    if (isQuiet) return

    const info = yield* gatherStartupInfo(state, step)
    const interactive = isInteractive()
    process.stderr.write(formatStartupMessage(info, interactive) + "\n")
  })
