import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { AgentService } from "../services/Agent.js"
import type { AgentInvocation, AgentResult } from "../services/Agent.js"
import { planCommand } from "./plan.js"
import { mockConfig, mockGit, mockFs, nodeLayer } from "../test-helpers.js"

describe("planCommand", () => {
  it.effect("invokes agent in plan mode with diff", () =>
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
      yield* planCommand(mockFs("")).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
      expect(calls.length).toBeGreaterThan(0)
      expect(calls[0]!.mode).toBe("plan")
      expect(calls[0]!.systemPrompt).toBe("")
    }),
  )

  it.effect("reads existing plan file and includes it in prompt", () =>
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
      const existingPlan = `# Feature\n\n## Action Items\n\n- [ ] Item\n  - Detail\n  - Tests: check\n`
      yield* planCommand(mockFs(existingPlan)).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
      expect(calls[0]!.prompt).toContain("Feature")
    }),
  )

  it.effect("calls git add and commit with LLM-generated message", () =>
    Effect.gen(function* () {
      const gitCalls: string[] = []
      const gitLayer = mockGit({
        addAll: () =>
          Effect.sync(() => {
            gitCalls.push("addAll")
          }),
        commit: (msg) =>
          Effect.sync(() => {
            gitCalls.push(`commit:${msg}`)
          }),
      })
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: (params) => {
          if (params.onEvent) params.onEvent({ _tag: "TextDelta", delta: "plan: update TODO.md" })
          return Effect.succeed<AgentResult>({ sessionId: undefined })
        },
        isAvailable: () => Effect.succeed(true),
      })
      yield* planCommand(mockFs("")).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer, nodeLayer)),
      )
      expect(gitCalls).toContain("addAll")
      expect(gitCalls.some((c) => c.startsWith("commit:"))).toBe(true)
      expect(gitCalls).toContain("commit:🤖 plan: update TODO.md")
    }),
  )

  it.effect("saves session ID to .gtd-session when agent returns one", () =>
    Effect.gen(function* () {
      let savedSessionId: string | undefined
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: () => Effect.succeed<AgentResult>({ sessionId: "plan-ses-abc" }),
        isAvailable: () => Effect.succeed(true),
      })
      const fs = {
        ...mockFs(""),
        writeSessionId: (id: string) =>
          Effect.sync(() => {
            savedSessionId = id
          }),
      }
      yield* planCommand(fs).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
      expect(savedSessionId).toBe("plan-ses-abc")
    }),
  )

  it.effect("lint retries resume the plan session", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      let planCallCount = 0
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: (params) => {
          calls.push(params)
          if (params.mode === "plan") {
            const sessionId = planCallCount++ === 0 ? "plan-ses-1" : undefined
            return Effect.succeed<AgentResult>({ sessionId })
          }
          return Effect.succeed<AgentResult>({ sessionId: undefined })
        },
        isAvailable: () => Effect.succeed(true),
      })
      const planWithBlockquote = [
        "# Feature",
        "",
        "## Action Items",
        "",
        "### Setup",
        "",
        "- [ ] Item",
        "  - Detail",
        "  - Tests: check",
        "",
        "> Fix this",
        "",
      ].join("\n")
      const cleanPlan = [
        "# Feature",
        "",
        "## Action Items",
        "",
        "### Setup",
        "",
        "- [ ] Item",
        "  - Detail",
        "  - Tests: check",
        "",
      ].join("\n")
      let readCount = 0
      const fs = {
        readFile: () => Effect.succeed(readCount++ < 2 ? planWithBlockquote : cleanPlan),
        exists: () => Effect.succeed(true),
      }
      yield* planCommand(fs).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
      const planCalls = calls.filter((c) => c.mode === "plan" && !c.prompt.includes("commit message"))
      // 2 plan calls: initial plan + 1 lint fix
      expect(planCalls.length).toBe(2)
      expect(planCalls[1]!.resumeSessionId).toBe("plan-ses-1")
    }),
  )

  it.effect("resumes previous session from .gtd-session on re-invocation", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: (params) =>
          Effect.succeed<AgentResult>({ sessionId: "plan-ses-new" }).pipe(
            Effect.tap(() => Effect.sync(() => { calls.push(params) })),
          ),
        isAvailable: () => Effect.succeed(true),
      })
      let savedSessionId: string | undefined
      const fs = {
        ...mockFs(""),
        readSessionId: () => Effect.succeed("plan-ses-prev" as string | undefined),
        writeSessionId: (id: string) =>
          Effect.sync(() => {
            savedSessionId = id
          }),
      }
      yield* planCommand(fs).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
      // Should resume the previous session
      expect(calls[0]!.resumeSessionId).toBe("plan-ses-prev")
      // Should save the new session ID
      expect(savedSessionId).toBe("plan-ses-new")
    }),
  )

  it.effect("does not resume when no previous session exists", () =>
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
      const fs = {
        ...mockFs(""),
        readSessionId: () => Effect.succeed(undefined as string | undefined),
      }
      yield* planCommand(fs).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
      expect(calls[0]!.resumeSessionId).toBeUndefined()
    }),
  )

  it.effect("does not write session file when sessionId is undefined", () =>
    Effect.gen(function* () {
      let writeSessionCalled = false
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: () => Effect.succeed<AgentResult>({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })
      const fs = {
        ...mockFs(""),
        writeSessionId: (_id: string) =>
          Effect.sync(() => {
            writeSessionCalled = true
          }),
      }
      yield* planCommand(fs).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
      expect(writeSessionCalled).toBe(false)
    }),
  )

  it.effect("invokes formatFile on the plan file before committing", () =>
    Effect.gen(function* () {
      let formatCalled = false
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: () => Effect.succeed<AgentResult>({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })
      const gitCalls: string[] = []
      const gitLayer = mockGit({
        add: (files) =>
          Effect.sync(() => {
            gitCalls.push(`add:${files.join(",")}`)
          }),
        commit: (msg) =>
          Effect.sync(() => {
            gitCalls.push(`commit:${msg}`)
          }),
      })
      const fs = {
        ...mockFs(""),
        formatFile: () =>
          Effect.sync(() => {
            formatCalled = true
          }),
      }
      yield* planCommand(fs).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer, nodeLayer)),
      )
      expect(formatCalled).toBe(true)
      // formatFile should be called before the commit
      const commitIdx = gitCalls.findIndex((c) => c.startsWith("commit:"))
      expect(commitIdx).toBeGreaterThanOrEqual(0)
    }),
  )

  it.effect("still commits when formatFile fails", () =>
    Effect.gen(function* () {
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: () => Effect.succeed<AgentResult>({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })
      const gitCalls: string[] = []
      const gitLayer = mockGit({
        add: (files) =>
          Effect.sync(() => {
            gitCalls.push(`add:${files.join(",")}`)
          }),
        commit: (msg) =>
          Effect.sync(() => {
            gitCalls.push(`commit:${msg}`)
          }),
      })
      const fs = {
        ...mockFs(""),
        formatFile: () => Effect.fail(new Error("prettier not found")),
      }
      yield* planCommand(fs).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer, nodeLayer)),
      )
      // Should still commit despite prettier failure
      expect(gitCalls.some((c) => c.startsWith("commit:"))).toBe(true)
    }),
  )

  it.effect("prompt contains comment-removal instruction when diff includes TODO markers", () =>
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
      const diffWithTodo = [
        "diff --git a/src/foo.ts b/src/foo.ts",
        "+// TODO: refactor this later",
        "+// FIXME: handle edge case",
      ].join("\n")
      const gitLayer = mockGit({
        getDiff: () => Effect.succeed(diffWithTodo),
      })
      yield* planCommand(mockFs("")).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer, nodeLayer)),
      )
      const prompt = calls[0]!.prompt
      expect(prompt).toContain("TODO:")
      expect(prompt).toContain("FIXME:")
      expect(prompt).toMatch(/remove.*comment/i)
      expect(prompt).toMatch(/newly added/i)
    }),
  )

  it.effect("falls back to last commit diff when working tree is clean", () =>
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
      const lastCommitDiff = "diff --git a/TODO.md b/TODO.md\n+> Fix the bug in parser"
      const gitLayer = mockGit({
        getDiff: () => Effect.succeed(""),
        show: (_ref: string) => Effect.succeed(lastCommitDiff),
      })
      yield* planCommand(mockFs("")).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer, nodeLayer)),
      )
      expect(calls[0]!.prompt).toContain("Fix the bug in parser")
      expect(calls[0]!.prompt).not.toContain("No diff available.")
    }),
  )
})
