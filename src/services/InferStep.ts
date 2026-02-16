import {
  HUMAN,
  PLAN,
  BUILD,
  FIX,
  LEARN,
  CLEANUP,
  type CommitPrefix,
} from "./CommitPrefix.js"

export type Step =
  | "commit-feedback"
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
}

export const inferStep = (input: InferStepInput): Step => {
  if (input.hasUncommittedChanges) {
    return "commit-feedback"
  }

  switch (input.lastCommitPrefix) {
    case HUMAN:
      return input.onlyLearningsModified ? "learn" : "plan"
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
