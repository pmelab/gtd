import { describe, it, expect, vi } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { GtdConfigService } from "../services/Config.js"
import { GitService } from "../services/Git.js"
import { AgentService } from "../services/Agent.js"
import type { AgentInvocation } from "../services/Agent.js"
import { commitFeedbackCommand } from "./commit-feedback.js"

const defaultConfig = {
  file: "TODO.md",
  agent: "auto",
  agentPlan: "plan",
  agentBuild: "code",
  agentLearn: "plan",
  testCmd: "npm test",
  testRetries: 10,
  commitPrompt: "{{diff}}",
}

const mockConfig = (overrides: Partial<typeof defaultConfig> = {}) =>
  Layer.succeed(GtdConfigService, { ...defaultConfig, ...overrides })

const mockGit = (overrides: Partial<GitService["Type"]> = {}) => {
  const base = {
    getDiff: () => Effect.succeed("diff --git a/foo.ts\n+const x = 1"),
    hasUnstagedChanges: () => Effect.succeed(false),
    hasUncommittedChanges: () => Effect.succeed(true),
    getLastCommitMessage: () => Effect.succeed(""),
    add: (() => Effect.void) as GitService["Type"]["add"],
    addAll: () => Effect.void,
    commit: (() => Effect.void) as GitService["Type"]["commit"],
    show: () => Effect.succeed(""),
    ...overrides,
  }
  return Layer.succeed(GitService, {
    ...base,
    atomicCommit:
      overrides.atomicCommit ??
      ((files, message) =>
        Effect.gen(function* () {
          if (files === "all") yield* base.addAll()
          else yield* base.add(files)
          yield* base.commit(message)
        })),
  } satisfies GitService["Type"])
}

describe("commitFeedbackCommand", () => {
  it.effect("calls atomicCommit with 'all' and message starting with 🤦", () =>
    Effect.gen(function* () {
      let commitFiles: ReadonlyArray<string> | "all" | undefined
      let commitMessage: string | undefined

      const gitLayer = mockGit({
        atomicCommit: (files, message) =>
          Effect.sync(() => {
            commitFiles = files
            commitMessage = message
          }),
      })

      const agentLayer = Layer.succeed(AgentService, {
        invoke: () => Effect.succeed({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })

      yield* commitFeedbackCommand(Effect.void).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer)),
      )

      expect(commitFiles).toBe("all")
      expect(commitMessage).toBeDefined()
      expect(commitMessage!.startsWith("🤦")).toBe(true)
    }),
  )

  it.effect("uses agent to generate summary from diff", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []

      const gitLayer = mockGit({
        getDiff: () => Effect.succeed("diff --git a/bar.ts\n+export const bar = true"),
        atomicCommit: () => Effect.void,
      })

      const agentLayer = Layer.succeed(AgentService, {
        invoke: (params) => {
          calls.push(params)
          return Effect.succeed({ sessionId: undefined })
        },
        isAvailable: () => Effect.succeed(true),
      })

      yield* commitFeedbackCommand(Effect.void).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer)),
      )

      // 2 calls: one for commit prompt, one for commit message generation
      expect(calls.length).toBe(2)
      expect(calls[0]!.prompt).toContain("diff --git a/bar.ts")
      // Second call is for commit message summarization
      expect(calls[1]!.prompt).toContain("commit message")
    }),
  )

  it.effect("includes agent response in commit message after 🤦 prefix", () =>
    Effect.gen(function* () {
      let commitMessage: string | undefined

      const gitLayer = mockGit({
        atomicCommit: (_files, message) =>
          Effect.sync(() => {
            commitMessage = message
          }),
      })

      const agentLayer = Layer.succeed(AgentService, {
        invoke: () => Effect.succeed({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })

      yield* commitFeedbackCommand(Effect.void).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer)),
      )

      expect(commitMessage).toBeDefined()
      expect(commitMessage!.startsWith("🤦 ")).toBe(true)
    }),
  )

  it.effect("logs confirmation message after commit and invokes planCommand", () =>
    Effect.gen(function* () {
      const logs: string[] = []
      const consoleSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "))
      })

      let planInvoked = false

      const gitLayer = mockGit({
        atomicCommit: () => Effect.void,
      })

      const agentLayer = Layer.succeed(AgentService, {
        invoke: () => Effect.succeed({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })

      const fakePlan = Effect.sync(() => {
        planInvoked = true
      })

      yield* commitFeedbackCommand(fakePlan).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer)),
      )

      expect(logs.some((l) => l.includes("Feedback committed"))).toBe(true)
      expect(logs.some((l) => l.includes("Triggering plan"))).toBe(true)
      expect(planInvoked).toBe(true)

      consoleSpy.mockRestore()
    }),
  )

  it.effect("passes context so plan reads from last commit (empty working diff)", () =>
    Effect.gen(function* () {
      let planInvoked = false
      let diffAtPlanTime: string | undefined

      const gitLayer = mockGit({
        getDiff: () => Effect.succeed("diff --git a/foo.ts\n+const x = 1"),
        atomicCommit: () => Effect.void,
      })

      const agentLayer = Layer.succeed(AgentService, {
        invoke: () => Effect.succeed({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })

      const fakePlan = Effect.gen(function* () {
        const git = yield* GitService
        diffAtPlanTime = yield* git.getDiff()
        planInvoked = true
      })

      yield* commitFeedbackCommand(fakePlan).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer)),
      )

      expect(planInvoked).toBe(true)
      expect(diffAtPlanTime).toBeDefined()
    }),
  )
})
