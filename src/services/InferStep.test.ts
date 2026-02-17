import { describe, it, expect } from "@effect/vitest"
import { inferStep, type InferStepInput } from "./InferStep.js"
import { HUMAN, PLAN, BUILD, LEARN, CLEANUP, FIX, SEED, FEEDBACK } from "./CommitPrefix.js"

describe("inferStep", () => {
  it("returns commit-feedback when uncommitted changes exist", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: true,
      lastCommitPrefix: undefined,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("commit-feedback")
  })

  it("returns commit-feedback when uncommitted changes are only in Learnings section", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: true,
      lastCommitPrefix: undefined,
      hasUncheckedItems: false,
      onlyLearningsModified: true,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("commit-feedback")
  })

  it("returns commit-feedback when uncommitted changes include non-Learnings", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: true,
      lastCommitPrefix: BUILD,
      hasUncheckedItems: true,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("commit-feedback")
  })

  it("returns plan when last commit prefix is HUMAN and not only learnings", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns learn when last commit prefix is HUMAN and only learnings modified", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: false,
      onlyLearningsModified: true,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("learn")
  })

  it("returns build when last commit prefix is PLAN", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: PLAN,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("build")
  })

  it("returns build when last commit prefix is BUILD and unchecked items remain", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: BUILD,
      hasUncheckedItems: true,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("build")
  })

  it("returns learn when last commit prefix is BUILD and all items checked", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: BUILD,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("learn")
  })

  it("returns cleanup when last commit prefix is LEARN", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: LEARN,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("cleanup")
  })

  it("returns idle when last commit prefix is CLEANUP", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: CLEANUP,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("idle")
  })

  it("returns idle when prefix is unknown (undefined)", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: undefined,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("idle")
  })

  it("returns idle when no commits exist (undefined prefix)", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: undefined,
      hasUncheckedItems: true,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("idle")
  })

  it("uncommitted changes take priority over prefix", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: true,
      lastCommitPrefix: PLAN,
      hasUncheckedItems: true,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("commit-feedback")
  })

  it("returns build when last commit prefix is FIX and unchecked items remain", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: FIX,
      hasUncheckedItems: true,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("build")
  })

  it("returns learn when last commit prefix is FIX and all items checked", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: FIX,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("learn")
  })

  it("returns plan when FIX + todoFileIsNew", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: FIX,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: true,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan when BUILD + todoFileIsNew", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: BUILD,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: true,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan when no prefix + todoFileIsNew", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: undefined,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: true,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan when last commit prefix is SEED and not only learnings", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: SEED,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns learn when last commit prefix is SEED and only learnings modified", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: SEED,
      hasUncheckedItems: false,
      onlyLearningsModified: true,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("learn")
  })

  it("returns plan when last commit prefix is FEEDBACK and not only learnings", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: FEEDBACK,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns learn when last commit prefix is FEEDBACK and only learnings modified", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: FEEDBACK,
      hasUncheckedItems: false,
      onlyLearningsModified: true,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("learn")
  })

  it("uncommitted + onlyLearnings still returns commit-feedback", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: true,
      lastCommitPrefix: BUILD,
      hasUncheckedItems: true,
      onlyLearningsModified: true,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("commit-feedback")
  })

  it("returns plan for unified commit with SEED prefix (seed + fix bundled together)", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: SEED,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: true,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan for unified commit with SEED prefix and unchecked items", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: SEED,
      hasUncheckedItems: true,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan for unified commit with FEEDBACK prefix (feedback + fix bundled)", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: FEEDBACK,
      hasUncheckedItems: true,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan for unified commit with HUMAN prefix (human edits + fix bundled)", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: true,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("plan")
  })
})
