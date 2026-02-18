import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { type RunInfo, formatBanner, gatherRunInfo } from "./RunInfo.js"
import { GtdConfigService } from "./Config.js"
import { AgentService } from "./Agent.js"
import { mockConfig } from "../test-helpers.js"

describe("RunInfo type", () => {
  it("formatBanner includes agent name, step, and file path", () => {
    const info: RunInfo = {
      agent: "pi (auto)",
      step: "build",
      planFile: "TODO.md",
      configSources: [".gtdrc.json", "~/.config/gtd/.gtdrc.json"],
    }
    const banner = formatBanner(info)
    expect(banner).toContain("agent=pi (auto)")
    expect(banner).toContain("step=build")
    expect(banner).toContain("file=TODO.md")
    expect(banner).toContain("configs=.gtdrc.json,~/.config/gtd/.gtdrc.json")
    expect(banner).toMatch(/^\[gtd\]/)
  })

  it("formatBanner handles empty configSources", () => {
    const info: RunInfo = {
      agent: "claude",
      step: "plan",
      planFile: "TODO.md",
      configSources: [],
    }
    const banner = formatBanner(info)
    expect(banner).toContain("agent=claude")
    expect(banner).toContain("configs=<none>")
  })

  it("formatBanner includes model when configured", () => {
    const info: RunInfo = {
      agent: "pi (auto)",
      step: "build",
      planFile: "TODO.md",
      configSources: [],
      model: "opus",
    }
    const banner = formatBanner(info)
    expect(banner).toContain("model=opus")
  })

  it("formatBanner omits model when not configured", () => {
    const info: RunInfo = {
      agent: "pi (auto)",
      step: "build",
      planFile: "TODO.md",
      configSources: [],
    }
    const banner = formatBanner(info)
    expect(banner).not.toContain("model=")
  })

  it("gatherRunInfo collects agent, step, file, and configSources", async () => {
    const agentLayer = Layer.succeed(AgentService, {
      name: "pi",
      resolvedName: "pi (auto)",
      providerType: "pi",
      invoke: () => Effect.succeed({ sessionId: undefined }),
      isAvailable: () => Effect.succeed(true),
    })

    const configLayer = mockConfig({ file: "PLAN.md" })

    const info = await Effect.runPromise(
      gatherRunInfo("build").pipe(Effect.provide(Layer.mergeAll(agentLayer, configLayer))),
    )

    expect(info.agent).toBe("pi (auto)")
    expect(info.step).toBe("build")
    expect(info.planFile).toBe("PLAN.md")
    expect(Array.isArray(info.configSources)).toBe(true)
  })

  it("gatherRunInfo resolves model from config for the given step", async () => {
    const agentLayer = Layer.succeed(AgentService, {
      name: "pi",
      resolvedName: "pi (auto)",
      providerType: "pi",
      invoke: () => Effect.succeed({ sessionId: undefined }),
      isAvailable: () => Effect.succeed(true),
    })

    const configLayer = mockConfig({ file: "PLAN.md", modelBuild: "opus" })

    const info = await Effect.runPromise(
      gatherRunInfo("build").pipe(Effect.provide(Layer.mergeAll(agentLayer, configLayer))),
    )

    expect(info.model).toBe("opus")
  })

  it("gatherRunInfo leaves model undefined when not configured", async () => {
    const agentLayer = Layer.succeed(AgentService, {
      name: "pi",
      resolvedName: "pi (auto)",
      providerType: "pi",
      invoke: () => Effect.succeed({ sessionId: undefined }),
      isAvailable: () => Effect.succeed(true),
    })

    const configLayer = mockConfig({ file: "PLAN.md" })

    const info = await Effect.runPromise(
      gatherRunInfo("build").pipe(Effect.provide(Layer.mergeAll(agentLayer, configLayer))),
    )

    expect(info.model).toBeUndefined()
  })
})
