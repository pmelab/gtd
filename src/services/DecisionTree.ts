import { Effect } from "effect"
import { QuietMode } from "./QuietMode.js"
import type { InferStepInput } from "./InferStep.js"
import type { Step } from "./InferStep.js"
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
      return "🤦 human"
    case PLAN:
      return "🤖 plan"
    case BUILD:
      return "🔨 build"
    case FIX:
      return "👷 fix"
    case LEARN:
      return "🎓 learn"
    case CLEANUP:
      return "🧹 cleanup"
    case SEED:
      return "🌱 seed"
    case FEEDBACK:
      return "💬 feedback"
    case EXPLORE:
      return "🧭 explore"
    default:
      return "none"
  }
}

const yn = (v: boolean): string => (v ? "yes" : "no")

export const formatDecisionTrace = (state: InferStepInput, step: Step): string => {
  const parts: string[] = []

  parts.push(`has uncommitted changes? ${yn(state.hasUncommittedChanges)}`)

  if (state.hasUncommittedChanges) {
    parts.push(`step=${step}`)
    return `[gtd] decision: ${parts.join(" → ")}`
  }

  parts.push(`last commit prefix=${prefixLabel(state.lastCommitPrefix)}`)

  switch (state.lastCommitPrefix) {
    case HUMAN:
      parts.push(`only learnings modified? ${yn(state.onlyLearningsModified)}`)
      break
    case PLAN:
      break
    case BUILD:
    case FIX:
      if (state.todoFileIsNew) {
        parts.push(`todo file is new? yes`)
      } else {
        parts.push(`has unchecked items? ${yn(state.hasUncheckedItems)}`)
      }
      break
    case LEARN:
      break
    case CLEANUP:
      break
    case SEED:
      break
    case FEEDBACK:
      break
    case EXPLORE:
      break
    default:
      if (state.todoFileIsNew) {
        parts.push(`todo file is new? yes`)
      }
      break
  }

  parts.push(`step=${step}`)
  return `[gtd] decision: ${parts.join(" → ")}`
}

export const printDecisionTree = (
  state: InferStepInput,
  step: Step,
): Effect.Effect<void, never, QuietMode> =>
  Effect.gen(function* () {
    const { isQuiet } = yield* QuietMode
    if (isQuiet) return

    process.stderr.write(formatDecisionTrace(state, step) + "\n")
  })
