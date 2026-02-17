import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Effect, Layer } from "effect"
import { AgentService } from "./services/Agent.js"
import { QuietMode } from "./services/QuietMode.js"
import { mockConfig } from "./test-helpers.js"
import { printDecisionTree, formatDecisionTrace } from "./services/DecisionTree.js"
import type { InferStepInput } from "./services/InferStep.js"

describe("decision tree logging", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  })

  afterEach(() => {
    stderrSpy.mockRestore()
  })

  it("prints decision tree to stderr", async () => {
    const quietLayer = QuietMode.layer(false)

    const state: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: "🤖",
      hasUncheckedItems: true,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }

    await Effect.runPromise(
      printDecisionTree(state, "build").pipe(Effect.provide(quietLayer)),
    )

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("")
    expect(output).toContain("[gtd] decision:")
    expect(output).toContain("step=build")
  })

  it("suppresses decision tree when --quiet is set", async () => {
    const quietLayer = QuietMode.layer(true)

    const state: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: "🤖",
      hasUncheckedItems: true,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }

    await Effect.runPromise(
      printDecisionTree(state, "build").pipe(Effect.provide(quietLayer)),
    )

    expect(stderrSpy).not.toHaveBeenCalled()
  })

  it("decision trace reflects the actual step chosen", () => {
    const buildState: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: "🤖",
      hasUncheckedItems: true,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    const trace = formatDecisionTrace(buildState, "build")
    expect(trace).toContain("step=build")

    const commitFeedbackState: InferStepInput = {
      hasUncommittedChanges: true,
      lastCommitPrefix: undefined,
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    const trace2 = formatDecisionTrace(commitFeedbackState, "commit-feedback")
    expect(trace2).toContain("step=commit-feedback")
    expect(trace2).toContain("has uncommitted changes? yes")

    const idleState: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: "🧹",
      hasUncheckedItems: false,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    const trace3 = formatDecisionTrace(idleState, "idle")
    expect(trace3).toContain("step=idle")
  })

  it("formatDecisionTrace with lastCommitPrefix: SEED includes 🌱 seed", () => {
    const state: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: "🌱",
      hasUncheckedItems: true,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    const trace = formatDecisionTrace(state, "plan")
    expect(trace).toContain("🌱 seed")
  })

  it("formatDecisionTrace with lastCommitPrefix: FEEDBACK includes 💬 feedback", () => {
    const state: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: "💬",
      hasUncheckedItems: true,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    const trace = formatDecisionTrace(state, "plan")
    expect(trace).toContain("💬 feedback")
  })

  it("trace includes decision chain arrows", () => {
    const state: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: "🤖",
      hasUncheckedItems: true,
      onlyLearningsModified: false,
      todoFileIsNew: false,
    }
    const trace = formatDecisionTrace(state, "build")
    expect(trace).toContain("→")
    expect(trace).toMatch(/^\[gtd\] decision:/)
  })
})
