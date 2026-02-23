import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { AgentService } from "../services/Agent.js"
import type { AgentInvocation, AgentResult } from "../services/Agent.js"
import { exploreCommand } from "./explore.js"
import { mockConfig, mockGit, mockFs, nodeLayer } from "../test-helpers.js"

describe("exploreCommand", () => {
  it.effect("invokes agent in explore mode", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: (params) =>
          Effect.succeed<AgentResult>({ sessionId: undefined }).pipe(
            Effect.tap(() => Effect.sync(() => { calls.push(params) })),
          ),
        isAvailable: () => Effect.succeed(true),
      })
      yield* exploreCommand(mockFs("my seed idea")).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
      expect(calls.length).toBeGreaterThan(0)
      expect(calls[0]!.mode).toBe("explore")
    }),
  )

  it.effect("commits with 🧭 prefix", () =>
    Effect.gen(function* () {
      const commits: string[] = []
      const gitLayer = mockGit({
        commit: (msg) => Effect.sync(() => { commits.push(msg) }),
      })
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: (params) => {
          if (params.onEvent) params.onEvent({ _tag: "TextDelta", delta: "explore: suggest options" })
          return Effect.succeed<AgentResult>({ sessionId: undefined })
        },
        isAvailable: () => Effect.succeed(true),
      })
      yield* exploreCommand(mockFs("my seed idea")).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer, nodeLayer)),
      )
      expect(commits.some((c) => c.startsWith("🧭"))).toBe(true)
    }),
  )

  it.effect("includes seed content in prompt", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: (params) =>
          Effect.succeed<AgentResult>({ sessionId: undefined }).pipe(
            Effect.tap(() => Effect.sync(() => { calls.push(params) })),
          ),
        isAvailable: () => Effect.succeed(true),
      })
      const seed = "I want to build a rocket ship"
      yield* exploreCommand(mockFs(seed)).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
      expect(calls[0]!.prompt).toContain("I want to build a rocket ship")
    }),
  )

  it.effect("uses empty commit when agent makes no changes", () =>
    Effect.gen(function* () {
      const emptyCommits: string[] = []
      const gitLayer = mockGit({
        hasUncommittedChanges: () => Effect.succeed(false),
        emptyCommit: (msg) => Effect.sync(() => { emptyCommits.push(msg) }),
      })
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: () => Effect.succeed<AgentResult>({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })
      yield* exploreCommand(mockFs("seed")).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer, nodeLayer)),
      )
      expect(emptyCommits.some((c) => c.startsWith("🧭"))).toBe(true)
    }),
  )

  it.effect("includes git diff in prompt for re-explore", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: (params) =>
          Effect.succeed<AgentResult>({ sessionId: undefined }).pipe(
            Effect.tap(() => Effect.sync(() => { calls.push(params) })),
          ),
        isAvailable: () => Effect.succeed(true),
      })
      const gitLayer = mockGit({
        getDiff: () => Effect.succeed(""),
        show: (_ref) => Effect.succeed("diff --git a/TODO.md\n+user annotation here"),
      })
      yield* exploreCommand(mockFs("seed with annotations")).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer, nodeLayer)),
      )
      expect(calls[0]!.prompt).toContain("user annotation here")
    }),
  )
})
