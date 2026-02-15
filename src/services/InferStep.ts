import {
  HUMAN,
  PLAN,
  BUILD,
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
      return input.hasUncheckedItems ? "build" : "learn"
    case LEARN:
      return "cleanup"
    case CLEANUP:
      return "idle"
    default:
      return "idle"
  }
}
