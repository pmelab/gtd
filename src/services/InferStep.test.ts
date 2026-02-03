import { describe, it, expect } from "@effect/vitest"
import { inferStep, type InferStepInput } from "./InferStep.js"
import { HUMAN, PLAN, BUILD, LEARN, CLEANUP } from "./CommitPrefix.js"

describe("inferStep", () => {
  it("returns commit-feedback when uncommitted changes exist", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: true,
      lastCommitPrefix: undefined,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
    }
    expect(inferStep(input)).toBe("commit-feedback")
  })

  it("returns learn when uncommitted changes are only in Learnings section", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: true,
      lastCommitPrefix: undefined,
      hasUncheckedItems: false,
      onlyLearningsModified: true,
    }
    expect(inferStep(input)).toBe("learn")
  })

  it("returns commit-feedback when uncommitted changes include non-Learnings", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: true,
      lastCommitPrefix: BUILD,
      hasUncheckedItems: true,
      onlyLearningsModified: false,
    }
    expect(inferStep(input)).toBe("commit-feedback")
  })

  it("returns plan when last commit prefix is HUMAN", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns build when last commit prefix is PLAN", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: PLAN,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
    }
    expect(inferStep(input)).toBe("build")
  })

  it("returns build when last commit prefix is BUILD and unchecked items remain", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: BUILD,
      hasUncheckedItems: true,
      onlyLearningsModified: false,
    }
    expect(inferStep(input)).toBe("build")
  })

  it("returns learn when last commit prefix is BUILD and all items checked", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: BUILD,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
    }
    expect(inferStep(input)).toBe("learn")
  })

  it("returns cleanup when last commit prefix is LEARN", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: LEARN,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
    }
    expect(inferStep(input)).toBe("cleanup")
  })

  it("returns idle when last commit prefix is CLEANUP", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: CLEANUP,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
    }
    expect(inferStep(input)).toBe("idle")
  })

  it("returns idle when prefix is unknown (undefined)", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: undefined,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
    }
    expect(inferStep(input)).toBe("idle")
  })

  it("returns idle when no commits exist (undefined prefix)", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: undefined,
      hasUncheckedItems: true,
      onlyLearningsModified: false,
    }
    expect(inferStep(input)).toBe("idle")
  })

  it("uncommitted changes take priority over prefix", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: true,
      lastCommitPrefix: PLAN,
      hasUncheckedItems: true,
      onlyLearningsModified: false,
    }
    expect(inferStep(input)).toBe("commit-feedback")
  })

  it("learn from uncommitted takes priority over prefix", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: true,
      lastCommitPrefix: BUILD,
      hasUncheckedItems: true,
      onlyLearningsModified: true,
    }
    expect(inferStep(input)).toBe("learn")
  })
})
