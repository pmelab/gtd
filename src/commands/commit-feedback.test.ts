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
  agentInactivityTimeout: 300,
  agentForbiddenTools: [] as ReadonlyArray<string>,
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

      yield* commitFeedbackCommand().pipe(
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

      yield* commitFeedbackCommand().pipe(
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

      yield* commitFeedbackCommand().pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer)),
      )

      expect(commitMessage).toBeDefined()
      expect(commitMessage!.startsWith("🤦 ")).toBe(true)
    }),
  )

  it.effect("logs confirmation message after commit without chaining plan", () =>
    Effect.gen(function* () {
      const logs: string[] = []
      const consoleSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "))
      })

      const gitLayer = mockGit({
        atomicCommit: () => Effect.void,
      })

      const agentLayer = Layer.succeed(AgentService, {
        invoke: () => Effect.succeed({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })

      yield* commitFeedbackCommand().pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer)),
      )

      expect(logs.some((l) => l.includes("Feedback committed"))).toBe(true)

      consoleSpy.mockRestore()
    }),
  )

  it.effect("starts spinner before getDiff is called", () =>
    Effect.gen(function* () {
      const callOrder: string[] = []
      const consoleSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        const msg = args.map(String).join(" ")
        if (msg.includes("[gtd]")) callOrder.push(`spinner:${msg}`)
      })

      const gitLayer = mockGit({
        getDiff: () =>
          Effect.sync(() => {
            callOrder.push("getDiff")
            return "diff --git a/foo.ts\n+const x = 1"
          }),
        atomicCommit: () => Effect.void,
      })

      const agentLayer = Layer.succeed(AgentService, {
        invoke: () => Effect.succeed({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })

      yield* commitFeedbackCommand().pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer)),
      )

      const spinnerIdx = callOrder.findIndex((c) => c.startsWith("spinner:"))
      const getDiffIdx = callOrder.findIndex((c) => c === "getDiff")
      expect(spinnerIdx).toBeGreaterThanOrEqual(0)
      expect(getDiffIdx).toBeGreaterThan(spinnerIdx)

      consoleSpy.mockRestore()
    }),
  )

  it.effect("updates spinner text through phases", () =>
    Effect.gen(function* () {
      const spinnerTexts: string[] = []
      const consoleSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        const msg = args.map(String).join(" ")
        if (msg.includes("[gtd]")) spinnerTexts.push(msg)
      })

      const gitLayer = mockGit({
        atomicCommit: () => Effect.void,
      })

      const agentLayer = Layer.succeed(AgentService, {
        invoke: () => Effect.succeed({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })

      yield* commitFeedbackCommand().pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer)),
      )

      expect(spinnerTexts.some((t) => t.toLowerCase().includes("classifying"))).toBe(true)
      expect(spinnerTexts.some((t) => t.toLowerCase().includes("committing"))).toBe(true)

      consoleSpy.mockRestore()
    }),
  )

  it.effect("stops spinner on success", () =>
    Effect.gen(function* () {
      const spinnerTexts: string[] = []
      const consoleSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        const msg = args.map(String).join(" ")
        if (msg.includes("[gtd]")) spinnerTexts.push(msg)
      })

      const gitLayer = mockGit({
        atomicCommit: () => Effect.void,
      })

      const agentLayer = Layer.succeed(AgentService, {
        invoke: () => Effect.succeed({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })

      yield* commitFeedbackCommand().pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer)),
      )

      expect(spinnerTexts.some((t) => t.toLowerCase().includes("committed"))).toBe(true)

      consoleSpy.mockRestore()
    }),
  )

  it.effect("stops spinner on error", () =>
    Effect.gen(function* () {
      const errorTexts: string[] = []
      const consoleErrSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        const msg = args.map(String).join(" ")
        if (msg.includes("[gtd]")) errorTexts.push(msg)
      })
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})

      const gitLayer = mockGit({
        getDiff: () => Effect.fail(new Error("git failed")),
        atomicCommit: () => Effect.void,
      })

      const agentLayer = Layer.succeed(AgentService, {
        invoke: () => Effect.succeed({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })

      const result = yield* commitFeedbackCommand().pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer)),
        Effect.either,
      )

      expect(result._tag).toBe("Left")
      expect(errorTexts.some((t) => t.toLowerCase().includes("failed"))).toBe(true)

      consoleErrSpy.mockRestore()
      consoleSpy.mockRestore()
    }),
  )
})
