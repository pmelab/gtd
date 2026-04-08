import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { AgentService } from "../services/Agent.js"
import type { AgentInvocation, AgentResult } from "../services/Agent.js"
import { grillCommand } from "./grill.js"
import { mockConfig, mockGit, mockFs, nodeLayer } from "../test-helpers.js"

describe("grillCommand", () => {
  it.effect("invokes agent in plan mode with TODO.md content", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      const agentLayer = Layer.succeed(AgentService, {
        resolvedName: "mock",
        invoke: (params) =>
          Effect.succeed<AgentResult>({ sessionId: undefined }).pipe(
            Effect.tap(() => Effect.sync(() => calls.push(params))),
          ),
      })
      const fs = mockFs("# My feature\n\nSome rough notes.")
      yield* grillCommand(fs).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
      expect(calls.length).toBeGreaterThan(0)
      expect(calls[0]!.mode).toBe("plan")
      expect(calls[0]!.prompt).toContain("My feature")
    }),
  )

  it.effect("prompt includes grill-me interview instructions", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      const agentLayer = Layer.succeed(AgentService, {
        resolvedName: "mock",
        invoke: (params) =>
          Effect.succeed<AgentResult>({ sessionId: undefined }).pipe(
            Effect.tap(() => Effect.sync(() => calls.push(params))),
          ),
      })
      yield* grillCommand(mockFs("# Feature")).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
      expect(calls[0]!.prompt).toContain("Interview me relentlessly")
      expect(calls[0]!.prompt).toContain("Open Questions")
    }),
  )

  it.effect("commits uncommitted changes as 🤓 answers before invoking agent", () =>
    Effect.gen(function* () {
      const gitCalls: string[] = []
      const gitLayer = mockGit({
        hasUncommittedChanges: () => Effect.succeed(true),
        addAll: () => Effect.sync(() => { gitCalls.push("addAll") }),
        commit: (msg) => Effect.sync(() => { gitCalls.push(`commit:${msg}`) }),
      })
      const agentLayer = Layer.succeed(AgentService, {
        resolvedName: "mock",
        invoke: () => Effect.succeed<AgentResult>({ sessionId: undefined }),
      })
      yield* grillCommand(mockFs("# Feature\n\n## Open Questions\n\n- Q1\n  Answer here")).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer, nodeLayer)),
      )
      const answerCommit = gitCalls.find((c) => c === "commit:🤓 answers")
      expect(answerCommit).toBeDefined()
      // answer commit should come before question commit
      const answerIdx = gitCalls.indexOf("commit:🤓 answers")
      const questionIdx = gitCalls.indexOf("commit:🔍 grill: questions")
      expect(answerIdx).toBeLessThan(questionIdx)
    }),
  )

  it.effect("commits with 🔍 grill: questions when agent makes changes", () =>
    Effect.gen(function* () {
      const gitCalls: string[] = []
      const gitLayer = mockGit({
        hasUncommittedChanges: () => Effect.succeed(true),
        addAll: () => Effect.sync(() => { gitCalls.push("addAll") }),
        commit: (msg) => Effect.sync(() => { gitCalls.push(`commit:${msg}`) }),
      })
      const agentLayer = Layer.succeed(AgentService, {
        resolvedName: "mock",
        invoke: () => Effect.succeed<AgentResult>({ sessionId: undefined }),
      })
      yield* grillCommand(mockFs("# Feature")).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer, nodeLayer)),
      )
      expect(gitCalls).toContain("commit:🔍 grill: questions")
    }),
  )

  it.effect("uses empty commit when agent makes no changes", () =>
    Effect.gen(function* () {
      const gitCalls: string[] = []
      const gitLayer = mockGit({
        hasUncommittedChanges: () => Effect.succeed(false),
        emptyCommit: (msg) => Effect.sync(() => { gitCalls.push(`emptyCommit:${msg}`) }),
        addAll: () => Effect.sync(() => { gitCalls.push("addAll") }),
        commit: (msg) => Effect.sync(() => { gitCalls.push(`commit:${msg}`) }),
      })
      const agentLayer = Layer.succeed(AgentService, {
        resolvedName: "mock",
        invoke: () => Effect.succeed<AgentResult>({ sessionId: undefined }),
      })
      yield* grillCommand(mockFs("# Feature")).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer, nodeLayer)),
      )
      expect(gitCalls).toContain("emptyCommit:🔍 grill: questions")
      expect(gitCalls).not.toContain("addAll")
    }),
  )

  it.effect("saves session ID for continuity", () =>
    Effect.gen(function* () {
      let savedSessionId: string | undefined
      const agentLayer = Layer.succeed(AgentService, {
        resolvedName: "mock",
        invoke: () => Effect.succeed<AgentResult>({ sessionId: "grill-ses-abc" }),
      })
      const fs = {
        ...mockFs("# Feature"),
        writeSessionId: (id: string) => Effect.sync(() => { savedSessionId = id }),
      }
      yield* grillCommand(fs).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
      expect(savedSessionId).toBe("grill-ses-abc")
    }),
  )

  it.effect("resumes previous session when one exists", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      const agentLayer = Layer.succeed(AgentService, {
        resolvedName: "mock",
        invoke: (params) =>
          Effect.succeed<AgentResult>({ sessionId: "new-ses" }).pipe(
            Effect.tap(() => Effect.sync(() => calls.push(params))),
          ),
      })
      const fs = {
        ...mockFs("# Feature"),
        readSessionId: () => Effect.succeed("prev-ses" as string | undefined),
      }
      yield* grillCommand(fs).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
      expect(calls[0]!.resumeSessionId).toBe("prev-ses")
    }),
  )
})
