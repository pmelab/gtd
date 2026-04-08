import { describe, it, expect } from "@effect/vitest"
import { inferStep, type InferStepInput } from "./InferStep.js"
import { HUMAN, PLAN, BUILD, LEARN, CLEANUP, FIX, SEED, GRILL, GRILL_ANSWER } from "./CommitPrefix.js"

describe("inferStep", () => {
  it("returns commit-feedback when uncommitted changes exist", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: true,
      lastCommitPrefix: undefined,
      hasUncheckedItems: false,
      hasOpenQuestions: false,
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
      hasOpenQuestions: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("commit-feedback")
  })

  it("returns plan when last commit prefix is HUMAN and no prevPhasePrefix", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: false,
      hasOpenQuestions: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns build when last commit prefix is PLAN", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: PLAN,
      hasUncheckedItems: false,
      hasOpenQuestions: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("build")
  })

  it("returns build when last commit prefix is BUILD and unchecked items remain", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: BUILD,
      hasUncheckedItems: true,
      hasOpenQuestions: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("build")
  })

  it("returns cleanup when last commit prefix is BUILD and all items checked", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: BUILD,
      hasUncheckedItems: false,
      hasOpenQuestions: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("cleanup")
  })

  it("returns idle when last commit prefix is LEARN (backward compat)", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: LEARN,
      hasUncheckedItems: false,
      hasOpenQuestions: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("idle")
  })

  it("returns idle when last commit prefix is CLEANUP", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: CLEANUP,
      hasUncheckedItems: false,
      hasOpenQuestions: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("idle")
  })

  it("returns test-fix when prefix is unknown (undefined)", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: undefined,
      hasUncheckedItems: false,
      hasOpenQuestions: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("test-fix")
  })

  it("returns test-fix when no commits exist (undefined prefix)", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: undefined,
      hasUncheckedItems: true,
      hasOpenQuestions: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("test-fix")
  })

  it("uncommitted changes take priority over prefix", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: true,
      lastCommitPrefix: PLAN,
      hasUncheckedItems: true,
      hasOpenQuestions: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("commit-feedback")
  })

  it("returns test-fix when last commit prefix is FIX and unchecked items remain", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: FIX,
      hasUncheckedItems: true,
      hasOpenQuestions: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("test-fix")
  })

  it("returns test-fix when last commit prefix is FIX and all items checked", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: FIX,
      hasUncheckedItems: false,
      hasOpenQuestions: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("test-fix")
  })

  it("returns plan when FIX + todoFileIsNew", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: FIX,
      hasUncheckedItems: false,
      hasOpenQuestions: false,
      todoFileIsNew: true,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan when BUILD + todoFileIsNew", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: BUILD,
      hasUncheckedItems: false,
      hasOpenQuestions: false,
      todoFileIsNew: true,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan when no prefix + todoFileIsNew", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: undefined,
      hasUncheckedItems: false,
      hasOpenQuestions: false,
      todoFileIsNew: true,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns grill when last commit prefix is SEED", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: SEED,
      hasUncheckedItems: false,
      hasOpenQuestions: false,
      todoFileIsNew: false,
      prevPhasePrefix: undefined,
    }
    expect(inferStep(input)).toBe("grill")
  })

  it("returns grill for unified commit with SEED prefix (seed + fix bundled together)", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: SEED,
      hasUncheckedItems: false,
      hasOpenQuestions: false,
      todoFileIsNew: true,
      prevPhasePrefix: undefined,
    }
    expect(inferStep(input)).toBe("grill")
  })

  it("returns grill for unified commit with SEED prefix and unchecked items", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: SEED,
      hasUncheckedItems: true,
      hasOpenQuestions: false,
      todoFileIsNew: false,
      prevPhasePrefix: undefined,
    }
    expect(inferStep(input)).toBe("grill")
  })

  it("returns plan when HUMAN and prevPhasePrefix is SEED", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: false,
      hasOpenQuestions: false,
      todoFileIsNew: false,
      prevPhasePrefix: SEED,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan when HUMAN and prevPhasePrefix is PLAN", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: false,
      hasOpenQuestions: false,
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
      hasOpenQuestions: false,
      todoFileIsNew: false,
      prevPhasePrefix: BUILD,
    }
    expect(inferStep(input)).toBe("build")
  })

  it("returns plan when HUMAN and prevPhasePrefix is BUILD with all checked", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: false,
      hasOpenQuestions: false,
      todoFileIsNew: false,
      prevPhasePrefix: BUILD,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns cleanup when HUMAN and prevPhasePrefix is LEARN", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: false,
      hasOpenQuestions: false,
      todoFileIsNew: false,
      prevPhasePrefix: LEARN,
    }
    expect(inferStep(input)).toBe("cleanup")
  })

  // Grill-specific tests
  it("returns grill when GRILL + open questions remain", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: GRILL,
      hasUncheckedItems: false,
      hasOpenQuestions: true,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("grill")
  })

  it("returns plan when GRILL + no open questions", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: GRILL,
      hasUncheckedItems: false,
      hasOpenQuestions: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns grill when GRILL_ANSWER + open questions remain", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: GRILL_ANSWER,
      hasUncheckedItems: false,
      hasOpenQuestions: true,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("grill")
  })

  it("returns plan when GRILL_ANSWER + no open questions", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: GRILL_ANSWER,
      hasUncheckedItems: false,
      hasOpenQuestions: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns grill (not commit-feedback) when uncommitted changes + lastPrefix is GRILL", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: true,
      lastCommitPrefix: GRILL,
      hasUncheckedItems: false,
      hasOpenQuestions: true,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("grill")
  })
})
