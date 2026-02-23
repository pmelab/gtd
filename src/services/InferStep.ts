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
  type CommitPrefix,
} from "./CommitPrefix.js"

export type Step =
  | "commit-feedback"
  | "explore"
  | "plan"
  | "build"
  | "learn"
  | "cleanup"
  | "idle"

export interface InferStepInput {
  readonly hasUncommittedChanges: boolean
  readonly lastCommitPrefix: CommitPrefix | undefined
  readonly hasUncheckedItems: boolean
  readonly onlyLearningsModified: boolean
  readonly todoFileIsNew: boolean
  readonly prevPhasePrefix?: CommitPrefix | undefined
}

export const inferStep = (input: InferStepInput): Step => {
  if (input.hasUncommittedChanges) {
    return "commit-feedback"
  }

  switch (input.lastCommitPrefix) {
    case SEED:
      return "explore"
    case EXPLORE:
      return "plan"
    case HUMAN: {
      switch (input.prevPhasePrefix) {
        case SEED:
        case EXPLORE: return "explore"
        case PLAN: return "plan"
        case BUILD:
        case FIX:
          if (input.todoFileIsNew) return "plan"
          return input.hasUncheckedItems ? "build" : "learn"
        case LEARN: return "learn"
        default: return input.onlyLearningsModified ? "learn" : "plan"
      }
    }
    case FEEDBACK: {
      switch (input.prevPhasePrefix) {
        case SEED:
        case EXPLORE: return "explore"
        default: return input.onlyLearningsModified ? "learn" : "plan"
      }
    }
    case PLAN:
      return "build"
    case BUILD:
    case FIX:
      if (input.todoFileIsNew) return "plan"
      return input.hasUncheckedItems ? "build" : "learn"
    case LEARN:
      return "cleanup"
    case CLEANUP:
      return "idle"
    default:
      return input.todoFileIsNew ? "plan" : "idle"
  }
}
