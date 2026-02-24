import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Effect, Layer } from "effect"
import { AgentService } from "./services/Agent.js"
import { QuietMode } from "./services/QuietMode.js"
import { mockConfig } from "./test-helpers.js"
import { printStartupMessage } from "./services/DecisionTree.js"
import type { InferStepInput } from "./services/InferStep.js"

describe("startup message in CLI", () => {
  let stderrSpy: { mock: { calls: unknown[][] }; mockRestore: () => void }

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  })

  afterEach(() => {
    stderrSpy.mockRestore()
  })

  const state: InferStepInput = {
    hasUncommittedChanges: false,
    lastCommitPrefix: "🤖",
    hasUncheckedItems: true,
    onlyLearningsModified: false,
    todoFileIsNew: false,
  }

  it("prints startup message to stderr containing agent name and step", async () => {
    const agentLayer = Layer.succeed(AgentService, {
      resolvedName: "pi (auto)",
      invoke: () => Effect.succeed({ sessionId: undefined }),
    })

    const configLayer = mockConfig({ file: "TODO.md" })
    const quietLayer = QuietMode.layer(false)

    await Effect.runPromise(
      printStartupMessage(state, "build").pipe(
        Effect.provide(Layer.mergeAll(agentLayer, configLayer, quietLayer)),
      ),
    )

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("")
    expect(output).toContain("pi (auto)")
    expect(output).toContain("build")
  })

  it("prints startup message with model info when configured", async () => {
    const agentLayer = Layer.succeed(AgentService, {
      resolvedName: "pi (auto)",
      invoke: () => Effect.succeed({ sessionId: undefined }),
    })

    const configLayer = mockConfig({ file: "TODO.md", modelPlan: "sonnet-4" })
    const quietLayer = QuietMode.layer(false)

    await Effect.runPromise(
      printStartupMessage(state, "plan").pipe(
        Effect.provide(Layer.mergeAll(agentLayer, configLayer, quietLayer)),
      ),
    )

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("")
    expect(output).toContain("sonnet-4")
  })

  it("omits model from message when not configured", async () => {
    const agentLayer = Layer.succeed(AgentService, {
      resolvedName: "pi (auto)",
      invoke: () => Effect.succeed({ sessionId: undefined }),
    })

    const configLayer = mockConfig({ file: "TODO.md" })
    const quietLayer = QuietMode.layer(false)

    await Effect.runPromise(
      printStartupMessage(state, "plan").pipe(
        Effect.provide(Layer.mergeAll(agentLayer, configLayer, quietLayer)),
      ),
    )

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("")
    expect(output).not.toContain("with model")
  })

  it("suppresses message when --quiet is set", async () => {
    const agentLayer = Layer.succeed(AgentService, {
      resolvedName: "pi (auto)",
      invoke: () => Effect.succeed({ sessionId: undefined }),
    })

    const configLayer = mockConfig({ file: "TODO.md" })
    const quietLayer = QuietMode.layer(true)

    await Effect.runPromise(
      printStartupMessage(state, "build").pipe(
        Effect.provide(Layer.mergeAll(agentLayer, configLayer, quietLayer)),
      ),
    )

    expect(stderrSpy).not.toHaveBeenCalled()
  })
})
