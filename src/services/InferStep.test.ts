import { describe, it, expect } from "@effect/vitest"
import { inferStep, type InferStepInput } from "./InferStep.js"
import { HUMAN, PLAN, BUILD, LEARN, CLEANUP, FIX, SEED, FEEDBACK, EXPLORE } from "./CommitPrefix.js"

describe("inferStep", () => {
  it("returns commit-feedback when uncommitted changes exist", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: true,
      lastCommitPrefix: undefined,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
      prevPhasePrefix: undefined,
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
      prevPhasePrefix: undefined,
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

  it("returns explore when last commit prefix is SEED", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: SEED,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
      prevPhasePrefix: undefined,
    }
    expect(inferStep(input)).toBe("explore")
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

  it("returns explore for unified commit with SEED prefix (seed + fix bundled together)", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: SEED,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: true,
      prevPhasePrefix: undefined,
    }
    expect(inferStep(input)).toBe("explore")
  })

  it("returns explore for unified commit with SEED prefix and unchecked items", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: SEED,
      hasUncheckedItems: true,
      onlyLearningsModified: false,
      todoFileIsNew: false,
      prevPhasePrefix: undefined,
    }
    expect(inferStep(input)).toBe("explore")
  })

  it("returns plan when last commit prefix is EXPLORE", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: EXPLORE,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
      prevPhasePrefix: undefined,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns explore when HUMAN and prevPhasePrefix is EXPLORE", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
      prevPhasePrefix: EXPLORE,
    }
    expect(inferStep(input)).toBe("explore")
  })

  it("returns plan when HUMAN and prevPhasePrefix is not EXPLORE", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
      prevPhasePrefix: PLAN,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns explore when FEEDBACK and prevPhasePrefix is EXPLORE", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: FEEDBACK,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
      prevPhasePrefix: EXPLORE,
    }
    expect(inferStep(input)).toBe("explore")
  })

  it("returns plan when HUMAN and prevPhasePrefix is PLAN", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
      prevPhasePrefix: PLAN,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan when FEEDBACK and prevPhasePrefix is PLAN", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: FEEDBACK,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
      prevPhasePrefix: PLAN,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns build when HUMAN and prevPhasePrefix is BUILD with unchecked items", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: true,
      onlyLearningsModified: false,
      todoFileIsNew: false,
      prevPhasePrefix: BUILD,
    }
    expect(inferStep(input)).toBe("build")
  })

  it("returns learn when HUMAN and prevPhasePrefix is BUILD with all checked", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
      prevPhasePrefix: BUILD,
    }
    expect(inferStep(input)).toBe("learn")
  })

  it("returns plan when HUMAN and prevPhasePrefix is BUILD with todoFileIsNew", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: true,
      prevPhasePrefix: BUILD,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan when FEEDBACK and prevPhasePrefix is BUILD with unchecked items", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: FEEDBACK,
      hasUncheckedItems: true,
      onlyLearningsModified: false,
      todoFileIsNew: false,
      prevPhasePrefix: BUILD,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns learn when HUMAN and prevPhasePrefix is LEARN", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
      prevPhasePrefix: LEARN,
    }
    expect(inferStep(input)).toBe("learn")
  })

  it("returns plan when FEEDBACK and prevPhasePrefix is LEARN", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: FEEDBACK,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
      prevPhasePrefix: LEARN,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan when FEEDBACK with no prevPhasePrefix and not only learnings", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: FEEDBACK,
      hasUncheckedItems: true,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan when HUMAN with no prevPhasePrefix and not only learnings", () => {
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
