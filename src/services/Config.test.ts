import { describe, it, expect } from "@effect/vitest"
import { Effect, ConfigProvider, Layer } from "effect"
import { GtdConfigService } from "./Config.js"

const runWithEnv = (env: Record<string, string>) =>
  Effect.gen(function* () {
    return yield* GtdConfigService
  }).pipe(
    Effect.provide(
      GtdConfigService.Live.pipe(
        Layer.provide(
          Layer.setConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(env)))),
        ),
      ),
    ),
  )

const runWithDefaults = runWithEnv({})

describe("GtdConfigService", () => {
  it.effect("provides default values", () =>
    Effect.gen(function* () {
      const config = yield* runWithDefaults
      expect(config.file).toBe("TODO.md")
      expect(config.agent).toBe("auto")
      expect(config.agentPlan).toBe("plan")
      expect(config.agentBuild).toBe("code")
      expect(config.agentLearn).toBe("plan")
      expect(config.testCmd).toBe("npm test")
      expect(config.testRetries).toBe(10)
      expect(config.commitPrompt).toContain("{{diff}}")
      expect(config.agentInactivityTimeout).toBe(300)
      expect(config.agentForbiddenTools).toEqual(["AskUserQuestion"])
    }),
  )

  it.effect("reads env var overrides", () =>
    Effect.gen(function* () {
      const config = yield* runWithEnv({
        GTD_FILE: "PLAN.md",
        GTD_AGENT: "claude",
        GTD_AGENT_PLAN: "architect",
        GTD_AGENT_BUILD: "coder",
        GTD_AGENT_LEARN: "teacher",
        GTD_TEST_CMD: "bun test",
        GTD_TEST_RETRIES: "5",
        GTD_COMMIT_PROMPT: "custom prompt",
        GTD_AGENT_INACTIVITY_TIMEOUT: "60",
        GTD_AGENT_FORBIDDEN_TOOLS: "AskUserQuestion,UserInput",
      })
      expect(config.file).toBe("PLAN.md")
      expect(config.agent).toBe("claude")
      expect(config.agentPlan).toBe("architect")
      expect(config.agentBuild).toBe("coder")
      expect(config.agentLearn).toBe("teacher")
      expect(config.testCmd).toBe("bun test")
      expect(config.testRetries).toBe(5)
      expect(config.commitPrompt).toBe("custom prompt")
      expect(config.agentInactivityTimeout).toBe(60)
      expect(config.agentForbiddenTools).toEqual(["AskUserQuestion", "UserInput"])
    }),
  )

  it.effect("disables timeout when set to 0", () =>
    Effect.gen(function* () {
      const config = yield* runWithEnv({
        GTD_AGENT_INACTIVITY_TIMEOUT: "0",
        GTD_AGENT_FORBIDDEN_TOOLS: "",
      })
      expect(config.agentInactivityTimeout).toBe(0)
      expect(config.agentForbiddenTools).toEqual([])
    }),
  )
})
