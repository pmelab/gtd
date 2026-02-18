import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Effect, Layer } from "effect"
import { AgentService } from "./services/Agent.js"
import { QuietMode } from "./services/QuietMode.js"
import { mockConfig, mockGit, mockFs } from "./test-helpers.js"
import { printBanner } from "./services/RunInfo.js"

describe("run info banner in CLI", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  })

  afterEach(() => {
    stderrSpy.mockRestore()
  })

  it("prints banner to stderr containing agent name, step, and file path", async () => {
    const agentLayer = Layer.succeed(AgentService, {
      name: "pi",
      resolvedName: "pi (auto)",
      providerType: "pi",
      invoke: () => Effect.succeed({ sessionId: undefined }),
      isAvailable: () => Effect.succeed(true),
    })

    const configLayer = mockConfig({ file: "TODO.md" })
    const quietLayer = QuietMode.layer(false)

    await Effect.runPromise(
      printBanner("build").pipe(
        Effect.provide(Layer.mergeAll(agentLayer, configLayer, quietLayer)),
      ),
    )

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("")
    expect(output).toContain("agent=pi (auto)")
    expect(output).toContain("step=build")
    expect(output).toContain("file=TODO.md")
  })

  it("prints banner with model info when configured", async () => {
    const agentLayer = Layer.succeed(AgentService, {
      name: "pi",
      resolvedName: "pi (auto)",
      providerType: "pi",
      invoke: () => Effect.succeed({ sessionId: undefined }),
      isAvailable: () => Effect.succeed(true),
    })

    const configLayer = mockConfig({ file: "TODO.md", modelPlan: "sonnet-4" })
    const quietLayer = QuietMode.layer(false)

    await Effect.runPromise(
      printBanner("plan").pipe(
        Effect.provide(Layer.mergeAll(agentLayer, configLayer, quietLayer)),
      ),
    )

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("")
    expect(output).toContain("model=sonnet-4")
  })

  it("omits model from banner when not configured", async () => {
    const agentLayer = Layer.succeed(AgentService, {
      name: "pi",
      resolvedName: "pi (auto)",
      providerType: "pi",
      invoke: () => Effect.succeed({ sessionId: undefined }),
      isAvailable: () => Effect.succeed(true),
    })

    const configLayer = mockConfig({ file: "TODO.md" })
    const quietLayer = QuietMode.layer(false)

    await Effect.runPromise(
      printBanner("plan").pipe(
        Effect.provide(Layer.mergeAll(agentLayer, configLayer, quietLayer)),
      ),
    )

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("")
    expect(output).not.toContain("model=")
  })

  it("suppresses banner when --quiet is set", async () => {
    const agentLayer = Layer.succeed(AgentService, {
      name: "pi",
      resolvedName: "pi (auto)",
      providerType: "pi",
      invoke: () => Effect.succeed({ sessionId: undefined }),
      isAvailable: () => Effect.succeed(true),
    })

    const configLayer = mockConfig({ file: "TODO.md" })
    const quietLayer = QuietMode.layer(true)

    await Effect.runPromise(
      printBanner("build").pipe(
        Effect.provide(Layer.mergeAll(agentLayer, configLayer, quietLayer)),
      ),
    )

    expect(stderrSpy).not.toHaveBeenCalled()
  })
})
