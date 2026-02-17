import { describe, it, expect, vi } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { AgentService } from "../services/Agent.js"
import type { AgentInvocation } from "../services/Agent.js"
import { commitFeedbackCommand } from "./commit-feedback.js"
import { mockConfig, mockGit } from "../test-helpers.js"

describe("commitFeedbackCommand", () => {
  it.effect("calls atomicCommit with 'all' and message starting with 🤦", () =>
    Effect.gen(function* () {
      let commitFiles: ReadonlyArray<string> | "all" | undefined
      let commitMessage: string | undefined

      const gitLayer = mockGit({
        getDiff: () => Effect.succeed("diff --git a/foo.ts\n+const x = 1"),
        hasUncommittedChanges: () => Effect.succeed(true),
        atomicCommit: (files, message) =>
          Effect.sync(() => {
            commitFiles = files
            commitMessage = message
          }),
      })

      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
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
        hasUncommittedChanges: () => Effect.succeed(true),
        atomicCommit: () => Effect.void,
      })

      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
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
        getDiff: () => Effect.succeed("diff --git a/foo.ts\n+const x = 1"),
        hasUncommittedChanges: () => Effect.succeed(true),
        atomicCommit: (_files, message) =>
          Effect.sync(() => {
            commitMessage = message
          }),
      })

      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
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
        getDiff: () => Effect.succeed("diff --git a/foo.ts\n+const x = 1"),
        hasUncommittedChanges: () => Effect.succeed(true),
        atomicCommit: () => Effect.void,
      })

      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
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
        hasUncommittedChanges: () => Effect.succeed(true),
        atomicCommit: () => Effect.void,
      })

      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
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
        getDiff: () => Effect.succeed("diff --git a/foo.ts\n+const x = 1"),
        hasUncommittedChanges: () => Effect.succeed(true),
        atomicCommit: () => Effect.void,
      })

      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
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
        getDiff: () => Effect.succeed("diff --git a/foo.ts\n+const x = 1"),
        hasUncommittedChanges: () => Effect.succeed(true),
        atomicCommit: () => Effect.void,
      })

      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
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
        hasUncommittedChanges: () => Effect.succeed(true),
        atomicCommit: () => Effect.void,
      })

      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
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

  const mixedDiff = [
    "diff --git a/src/app.ts b/src/app.ts",
    "index abc1234..def5678 100644",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,3 +1,4 @@",
    " const x = 1",
    "+const y = 2",
    " const z = 3",
    "@@ -10,3 +11,4 @@",
    " const a = 1",
    "+// TODO: refactor this",
    " const b = 2",
  ].join("\n")

  const fixOnlyDiff = [
    "diff --git a/src/app.ts b/src/app.ts",
    "index abc1234..def5678 100644",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,3 +1,4 @@",
    " const x = 1",
    "+const y = 2",
    " const z = 3",
  ].join("\n")

  const feedbackOnlyDiff = [
    "diff --git a/src/app.ts b/src/app.ts",
    "index abc1234..def5678 100644",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,3 +1,4 @@",
    " const x = 1",
    "+// TODO: refactor this",
    " const z = 3",
  ].join("\n")

  it.effect("two-phase: commits fixes then feedback when both exist", () =>
    Effect.gen(function* () {
      const commits: Array<{ type: string; message: string }> = []
      let stagedPatch: string | undefined

      const gitLayer = mockGit({
        getDiff: () => Effect.succeed(mixedDiff),
        hasUncommittedChanges: () => Effect.succeed(true),
        stageByPatch: (patch) =>
          Effect.sync(() => {
            stagedPatch = patch
          }),
        commit: (message) =>
          Effect.sync(() => {
            commits.push({ type: "commit", message })
          }),
        atomicCommit: (files, message) =>
          Effect.sync(() => {
            commits.push({ type: "atomicCommit", message })
          }),
      })

      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: () => Effect.succeed({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })

      yield* commitFeedbackCommand().pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer)),
      )

      expect(commits.length).toBe(2)
      expect(commits[0]!.message.startsWith("👷")).toBe(true)
      expect(commits[0]!.type).toBe("commit")
      expect(commits[1]!.message.startsWith("🤦")).toBe(true)
      expect(commits[1]!.type).toBe("atomicCommit")
      expect(stagedPatch).toBeDefined()
    }),
  )

  it.effect("single commit with 👷 when only fixes exist", () =>
    Effect.gen(function* () {
      const commits: Array<{ files: ReadonlyArray<string> | "all"; message: string }> = []

      const gitLayer = mockGit({
        getDiff: () => Effect.succeed(fixOnlyDiff),
        hasUncommittedChanges: () => Effect.succeed(true),
        atomicCommit: (files, message) =>
          Effect.sync(() => {
            commits.push({ files, message })
          }),
      })

      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: () => Effect.succeed({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })

      yield* commitFeedbackCommand().pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer)),
      )

      expect(commits.length).toBe(1)
      expect(commits[0]!.message.startsWith("👷")).toBe(true)
    }),
  )

  it.effect("single commit with 🤦 when only feedback exists", () =>
    Effect.gen(function* () {
      const commits: Array<{ files: ReadonlyArray<string> | "all"; message: string }> = []

      const gitLayer = mockGit({
        getDiff: () => Effect.succeed(feedbackOnlyDiff),
        hasUncommittedChanges: () => Effect.succeed(true),
        atomicCommit: (files, message) =>
          Effect.sync(() => {
            commits.push({ files, message })
          }),
      })

      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: () => Effect.succeed({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })

      yield* commitFeedbackCommand().pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer)),
      )

      expect(commits.length).toBe(1)
      expect(commits[0]!.message.startsWith("🤦")).toBe(true)
    }),
  )

  it.effect("fixes committed before feedback in two-phase", () =>
    Effect.gen(function* () {
      const commitOrder: string[] = []

      const gitLayer = mockGit({
        getDiff: () => Effect.succeed(mixedDiff),
        hasUncommittedChanges: () => Effect.succeed(true),
        stageByPatch: () => Effect.void,
        commit: (message) =>
          Effect.sync(() => {
            commitOrder.push(message.slice(0, 2))
          }),
        atomicCommit: (_files, message) =>
          Effect.sync(() => {
            commitOrder.push(message.slice(0, 2))
          }),
      })

      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: () => Effect.succeed({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })

      yield* commitFeedbackCommand().pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer)),
      )

      expect(commitOrder[0]).toBe("👷")
      expect(commitOrder[1]).toBe("🤦")
    }),
  )
})
