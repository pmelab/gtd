import { HUMAN, PLAN, BUILD, FIX, LEARN, CLEANUP, SEED, GRILL, GRILL_ANSWER, type CommitPrefix } from "./CommitPrefix.js"

export type Step = "commit-feedback" | "grill" | "plan" | "build" | "cleanup" | "idle" | "test-fix"

export interface InferStepInput {
  readonly hasUncommittedChanges: boolean
  readonly lastCommitPrefix: CommitPrefix | undefined
  readonly hasUncheckedItems: boolean
  readonly hasOpenQuestions: boolean
  readonly todoFileIsNew: boolean
  readonly prevPhasePrefix?: CommitPrefix | undefined
}

export const inferStep = (input: InferStepInput): Step => {
  if (input.hasUncommittedChanges) {
    if (input.lastCommitPrefix === GRILL) return "grill"
    return "commit-feedback"
  }

  switch (input.lastCommitPrefix) {
    case SEED:
      return "grill"
    case GRILL:
      return input.hasOpenQuestions ? "grill" : "plan"
    case GRILL_ANSWER:
      return input.hasOpenQuestions ? "grill" : "plan"
    case HUMAN: {
      switch (input.prevPhasePrefix) {
        case SEED:
          return "plan"
        case PLAN:
          return "plan"
        case BUILD:
        case FIX:
          return input.hasUncheckedItems ? "build" : "plan"
        case LEARN:
          return "cleanup"
        default:
          return "plan"
      }
    }
    case PLAN:
      return "build"
    case BUILD:
      if (input.todoFileIsNew) return "plan"
      return input.hasUncheckedItems ? "build" : "cleanup"
    case FIX:
      if (input.todoFileIsNew) return "plan"
      return "test-fix"
    case LEARN:
      return "idle"
    case CLEANUP:
      return "idle"
    default:
      return input.todoFileIsNew ? "plan" : "test-fix"
  }
}
