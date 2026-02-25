import { describe, it, expect } from "@effect/vitest"
import { inferStep, type InferStepInput } from "./InferStep.js"
import { HUMAN, PLAN, BUILD, LEARN, CLEANUP, FIX, SEED, FEEDBACK } from "./CommitPrefix.js"

describe("inferStep", () => {
  it("returns commit-feedback when uncommitted changes exist", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: true,
      lastCommitPrefix: undefined,
      hasUncheckedItems: false,
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
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("commit-feedback")
  })

  it("returns plan when last commit prefix is HUMAN and no prevPhasePrefix", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns build when last commit prefix is PLAN", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: PLAN,
      hasUncheckedItems: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("build")
  })

  it("returns build when last commit prefix is BUILD and unchecked items remain", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: BUILD,
      hasUncheckedItems: true,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("build")
  })

  it("returns cleanup when last commit prefix is BUILD and all items checked", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: BUILD,
      hasUncheckedItems: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("cleanup")
  })

  it("returns idle when last commit prefix is LEARN (backward compat)", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: LEARN,
      hasUncheckedItems: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("idle")
  })

  it("returns idle when last commit prefix is CLEANUP", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: CLEANUP,
      hasUncheckedItems: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("idle")
  })

  it("returns idle when prefix is unknown (undefined)", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: undefined,
      hasUncheckedItems: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("idle")
  })

  it("returns idle when no commits exist (undefined prefix)", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: undefined,
      hasUncheckedItems: true,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("idle")
  })

  it("uncommitted changes take priority over prefix", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: true,
      lastCommitPrefix: PLAN,
      hasUncheckedItems: true,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("commit-feedback")
  })

  it("returns build when last commit prefix is FIX and unchecked items remain", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: FIX,
      hasUncheckedItems: true,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("build")
  })

  it("returns cleanup when last commit prefix is FIX and all items checked", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: FIX,
      hasUncheckedItems: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("cleanup")
  })

  it("returns plan when FIX + todoFileIsNew", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: FIX,
      hasUncheckedItems: false,
      todoFileIsNew: true,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan when BUILD + todoFileIsNew", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: BUILD,
      hasUncheckedItems: false,
      todoFileIsNew: true,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan when no prefix + todoFileIsNew", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: undefined,
      hasUncheckedItems: false,
      todoFileIsNew: true,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan when last commit prefix is SEED", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: SEED,
      hasUncheckedItems: false,
      todoFileIsNew: false,
      prevPhasePrefix: undefined,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan when last commit prefix is FEEDBACK and not only learnings", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: FEEDBACK,
      hasUncheckedItems: false,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan for unified commit with SEED prefix (seed + fix bundled together)", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: SEED,
      hasUncheckedItems: false,
      todoFileIsNew: true,
      prevPhasePrefix: undefined,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan for unified commit with SEED prefix and unchecked items", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: SEED,
      hasUncheckedItems: true,
      todoFileIsNew: false,
      prevPhasePrefix: undefined,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan when HUMAN and prevPhasePrefix is SEED", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: false,
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
      todoFileIsNew: false,
      prevPhasePrefix: BUILD,
    }
    expect(inferStep(input)).toBe("build")
  })

  it("returns cleanup when HUMAN and prevPhasePrefix is BUILD with all checked", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: false,
      todoFileIsNew: false,
      prevPhasePrefix: BUILD,
    }
    expect(inferStep(input)).toBe("cleanup")
  })

  it("returns plan when HUMAN and prevPhasePrefix is BUILD with todoFileIsNew", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: false,
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
      todoFileIsNew: false,
      prevPhasePrefix: LEARN,
    }
    expect(inferStep(input)).toBe("cleanup")
  })

  it("returns plan when FEEDBACK and prevPhasePrefix is LEARN", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: FEEDBACK,
      hasUncheckedItems: false,
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
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("plan")
  })

  it("returns plan when HUMAN with no prevPhasePrefix and not only learnings", () => {
    const input: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: HUMAN,
      hasUncheckedItems: true,
      todoFileIsNew: false,
    }
    expect(inferStep(input)).toBe("plan")
  })
})
