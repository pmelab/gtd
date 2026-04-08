import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { AgentService } from "../services/Agent.js"
import type { AgentInvocation, AgentResult } from "../services/Agent.js"
import { testFixCommand } from "./test-fix.js"
import type { TestResult } from "./build.js"
import { mockConfig, mockGit, mockFs, nodeLayer } from "../test-helpers.js"

describe("testFixCommand", () => {
  it.effect("returns false and skips agent when testCmd is empty", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      const agentLayer = Layer.succeed(AgentService, {
        resolvedName: "mock",
        invoke: (p) =>
          Effect.succeed<AgentResult>({ sessionId: undefined }).pipe(
            Effect.tap(() => Effect.sync(() => calls.push(p))),
          ),
      })
      const result = yield* testFixCommand(mockFs("")).pipe(
        Effect.provide(Layer.mergeAll(mockConfig({ testCmd: "" }), mockGit(), agentLayer, nodeLayer)),
      )
      expect(result).toBe(false)
      expect(calls.length).toBe(0)
    }),
  )

  it.effect("returns false when tests pass immediately", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      const agentLayer = Layer.succeed(AgentService, {
        resolvedName: "mock",
        invoke: (p) =>
          Effect.succeed<AgentResult>({ sessionId: undefined }).pipe(
            Effect.tap(() => Effect.sync(() => calls.push(p))),
          ),
      })
      const fs = {
        ...mockFs(""),
        runTests: (_cmd: string): Effect.Effect<TestResult> =>
          Effect.succeed({ exitCode: 0, output: "" }),
      }
      const result = yield* testFixCommand(fs).pipe(
        Effect.provide(
          Layer.mergeAll(mockConfig({ testCmd: "npm test" }), mockGit(), agentLayer, nodeLayer),
        ),
      )
      expect(result).toBe(false)
      expect(calls.length).toBe(0)
    }),
  )

  it.effect("invokes agent and returns true when tests fail then pass", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      const agentLayer = Layer.succeed(AgentService, {
        resolvedName: "mock",
        invoke: (p) =>
          Effect.succeed<AgentResult>({ sessionId: "fix-ses" }).pipe(
            Effect.tap(() => Effect.sync(() => calls.push(p))),
          ),
      })
      let runCount = 0
      const fs = {
        ...mockFs(""),
        runTests: (_cmd: string): Effect.Effect<TestResult> =>
          Effect.succeed({ exitCode: runCount++ === 0 ? 1 : 0, output: "FAIL: broken" }),
      }
      const gitWithDiff = mockGit({ getDiff: () => Effect.succeed("diff --git a/src/foo.ts") })
      const result = yield* testFixCommand(fs).pipe(
        Effect.provide(
          Layer.mergeAll(
            mockConfig({ testCmd: "npm test", testRetries: 3 }),
            gitWithDiff,
            agentLayer,
            nodeLayer,
          ),
        ),
      )
      const fixCalls = calls.filter((c) => c.mode === "build")
      expect(result).toBe(true)
      expect(fixCalls.length).toBe(1)
      expect(fixCalls[0]!.prompt).toContain("Tests failed:")
      expect(fixCalls[0]!.prompt).toContain("FAIL: broken")
    }),
  )

  it.effect("exits with code 1 and returns false when retries exhausted", () =>
    Effect.gen(function* () {
      const agentLayer = Layer.succeed(AgentService, {
        resolvedName: "mock",
        invoke: () => Effect.succeed<AgentResult>({ sessionId: undefined }),
      })
      const fs = {
        ...mockFs(""),
        runTests: (_cmd: string): Effect.Effect<TestResult> =>
          Effect.succeed({ exitCode: 1, output: "FAIL: always broken" }),
      }
      const originalExitCode = process.exitCode
      const result = yield* testFixCommand(fs).pipe(
        Effect.provide(
          Layer.mergeAll(
            mockConfig({ testCmd: "npm test", testRetries: 1 }),
            mockGit(),
            agentLayer,
            nodeLayer,
          ),
        ),
      )
      expect(process.exitCode).toBe(1)
      expect(result).toBe(false)
      process.exitCode = originalExitCode
    }),
  )

  it.effect("resumes agent session across retries", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      const agentLayer = Layer.succeed(AgentService, {
        resolvedName: "mock",
        invoke: (p) =>
          Effect.succeed<AgentResult>({ sessionId: "ses-1" }).pipe(
            Effect.tap(() => Effect.sync(() => calls.push(p))),
          ),
      })
      let runCount = 0
      const fs = {
        ...mockFs(""),
        runTests: (_cmd: string): Effect.Effect<TestResult> =>
          Effect.succeed({ exitCode: runCount++ < 2 ? 1 : 0, output: "FAIL" }),
      }
      const gitWithDiff = mockGit({ getDiff: () => Effect.succeed("diff --git a/src/foo.ts") })
      yield* testFixCommand(fs).pipe(
        Effect.provide(
          Layer.mergeAll(
            mockConfig({ testCmd: "npm test", testRetries: 3 }),
            gitWithDiff,
            agentLayer,
            nodeLayer,
          ),
        ),
      )
      const fixCalls = calls.filter((c) => c.mode === "build")
      expect(fixCalls.length).toBe(2)
      expect(fixCalls[0]!.resumeSessionId).toBeUndefined()
      expect(fixCalls[1]!.resumeSessionId).toBe("ses-1")
    }),
  )
})
