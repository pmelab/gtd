import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Effect, Layer } from "effect"
import { AgentService } from "./services/Agent.js"
import { QuietMode } from "./services/QuietMode.js"
import { mockConfig } from "./test-helpers.js"
import { printStartupMessage, formatStartupMessage, type StartupInfo } from "./services/DecisionTree.js"
import type { InferStepInput } from "./services/InferStep.js"

const makeInfo = (state: InferStepInput, step: InferStepInput extends never ? never : string, agent = "claude"): StartupInfo => ({
  agent,
  step: step as StartupInfo["step"],
  model: undefined,
  state,
})

describe("startup message", () => {
  let stderrSpy: { mock: { calls: unknown[][] }; mockRestore: () => void }

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  })

  afterEach(() => {
    stderrSpy.mockRestore()
  })

  it("prints startup message to stderr", async () => {
    const agentLayer = Layer.succeed(AgentService, {
      resolvedName: "claude",
      invoke: () => Effect.succeed({ sessionId: undefined }),
    })
    const quietLayer = QuietMode.layer(false)
    const configLayer = mockConfig({ file: "TODO.md" })

    const state: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: "🤖",
      hasUncheckedItems: true,
      todoFileIsNew: false,
    }

    await Effect.runPromise(
      printStartupMessage(state, "build").pipe(
        Effect.provide(Layer.mergeAll(agentLayer, configLayer, quietLayer)),
      ),
    )

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("")
    expect(output).toContain("build")
    expect(output).toContain("claude")
  })

  it("suppresses message when --quiet is set", async () => {
    const agentLayer = Layer.succeed(AgentService, {
      resolvedName: "claude",
      invoke: () => Effect.succeed({ sessionId: undefined }),
    })
    const quietLayer = QuietMode.layer(true)
    const configLayer = mockConfig({ file: "TODO.md" })

    const state: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: "🤖",
      hasUncheckedItems: true,
      todoFileIsNew: false,
    }

    await Effect.runPromise(
      printStartupMessage(state, "build").pipe(
        Effect.provide(Layer.mergeAll(agentLayer, configLayer, quietLayer)),
      ),
    )

    expect(stderrSpy).not.toHaveBeenCalled()
  })

  it("non-interactive format includes [gtd] prefix and step", () => {
    const state: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: "🤖",
      hasUncheckedItems: true,
      todoFileIsNew: false,
    }
    const msg = formatStartupMessage(makeInfo(state, "build"), false)
    expect(msg).toContain("[gtd]")
    expect(msg).toContain("build")
  })

  it("reflects uncommitted changes", () => {
    const state: InferStepInput = {
      hasUncommittedChanges: true,
      lastCommitPrefix: undefined,
      hasUncheckedItems: false,
      todoFileIsNew: false,
    }
    const msg = formatStartupMessage(makeInfo(state, "commit-feedback"), false)
    expect(msg).toContain("commit-feedback")
    expect(msg).toContain("Uncommitted changes")
  })

  it("includes seed prefix in message", () => {
    const state: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: "🌱",
      hasUncheckedItems: true,
      todoFileIsNew: false,
    }
    const msg = formatStartupMessage(makeInfo(state, "plan"), false)
    expect(msg).toContain("seed")
  })

  it("includes feedback prefix in message", () => {
    const state: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: "💬",
      hasUncheckedItems: true,
      todoFileIsNew: false,
    }
    const msg = formatStartupMessage(makeInfo(state, "plan"), false)
    expect(msg).toContain("feedback")
  })

  it("shows model when provided", () => {
    const state: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: "🤖",
      hasUncheckedItems: true,
      todoFileIsNew: false,
    }
    const info: StartupInfo = { agent: "claude", step: "build", model: "sonnet-4", state }
    const msg = formatStartupMessage(info, false)
    expect(msg).toContain("with model sonnet-4")
  })

  it("idle step shows idle message", () => {
    const state: InferStepInput = {
      hasUncommittedChanges: false,
      lastCommitPrefix: "🧹",
      hasUncheckedItems: false,
      todoFileIsNew: false,
    }
    const msg = formatStartupMessage(makeInfo(state, "idle"), false)
    expect(msg).toContain("Nothing to do")
  })
})
