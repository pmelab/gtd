import {
  HUMAN,
  PLAN,
  BUILD,
  FIX,
  LEARN,
  CLEANUP,
  SEED,
  FEEDBACK,
  type CommitPrefix,
} from "./CommitPrefix.js"

export type Step =
  | "commit-feedback"
  | "plan"
  | "build"
  | "cleanup"
  | "idle"

export interface InferStepInput {
  readonly hasUncommittedChanges: boolean
  readonly lastCommitPrefix: CommitPrefix | undefined
  readonly hasUncheckedItems: boolean
  readonly todoFileIsNew: boolean
  readonly prevPhasePrefix?: CommitPrefix | undefined
}

export const inferStep = (input: InferStepInput): Step => {
  if (input.hasUncommittedChanges) {
    return "commit-feedback"
  }

  switch (input.lastCommitPrefix) {
    case SEED:
      return "plan"
    case HUMAN: {
      switch (input.prevPhasePrefix) {
        case SEED: return "plan"
        case PLAN: return "plan"
        case BUILD:
        case FIX:
          if (input.todoFileIsNew) return "plan"
          return input.hasUncheckedItems ? "build" : "cleanup"
        case LEARN: return "cleanup"
        default: return "plan"
      }
    }
    case FEEDBACK: {
      return "plan"
    }
    case PLAN:
      return "build"
    case BUILD:
    case FIX:
      if (input.todoFileIsNew) return "plan"
      return input.hasUncheckedItems ? "build" : "cleanup"
    case LEARN:
      return "idle"
    case CLEANUP:
      return "idle"
    default:
      return input.todoFileIsNew ? "plan" : "idle"
  }
}
