import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { AgentService, AgentError } from "../services/Agent.js"
import type { AgentInvocation, AgentResult } from "../services/Agent.js"
import { buildCommand, type TestResult } from "./build.js"
import { mockConfig, mockGit, mockFs, nodeLayer } from "../test-helpers.js"

// Returns initial content for first 2 reads, then all-checked content
const mockFsWithProgress = (initial: string) => {
  let readCount = 0
  const checkedContent = initial.replace(/- \[ \]/g, "- [x]")
  return {
    readFile: () => Effect.succeed(readCount++ < 2 ? initial : checkedContent),
    exists: () => Effect.succeed(initial !== ""),
    getDiffContent: () => Effect.succeed(""),
    remove: () => Effect.void,
  }
}

describe("buildCommand", () => {
  it.effect("exits early when plan file missing", () =>
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
      yield* buildCommand(mockFs("")).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
      expect(calls.length).toBe(0)
    }),
  )

  it.effect("invokes agent for unchecked item", () =>
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
      const singleItem = [
        "# Feature",
        "",
        "## Action Items",
        "",
        "### Setup",
        "",
        "- [ ] Only item",
        "  - Detail",
        "  - Tests: check",
        "",
      ].join("\n")
      yield* buildCommand(mockFsWithProgress(singleItem)).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
      const buildCalls = calls.filter((c) => c.mode === "build")
      expect(buildCalls.length).toBe(1)
      expect(buildCalls[0]!.prompt).toContain("Only item")
      expect(buildCalls[0]!.systemPrompt).toBe("")
    }),
  )

  it.effect("includes learnings in prompt", () =>
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
      const withLearnings = [
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
        "## Learnings",
        "",
        "- always use TDD",
        "",
      ].join("\n")
      yield* buildCommand(mockFsWithProgress(withLearnings)).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
      expect(calls[0]!.prompt).toContain("always use TDD")
    }),
  )

  it.effect("commits after item with 🔨 prefix", () =>
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
          if (params.onEvent) params.onEvent({ _tag: "TextDelta", delta: "build: Build Phase" })
          return Effect.succeed<AgentResult>({ sessionId: undefined })
        },
        isAvailable: () => Effect.succeed(true),
      })
      const singleItem = [
        "# Feature",
        "",
        "## Action Items",
        "",
        "### Build Phase",
        "",
        "- [ ] Build it",
        "  - Detail",
        "  - Tests: check",
        "",
      ].join("\n")
      yield* buildCommand(mockFsWithProgress(singleItem)).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer, nodeLayer)),
      )
      expect(gitCalls).toContain("addAll")
      expect(gitCalls.some((c) => c === "commit:🔨 build: Build Phase")).toBe(true)
    }),
  )

  it.effect("resumes building unchecked items after interruption", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      const gitCalls: string[] = []
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: (params) => {
          calls.push(params)
          if (params.onEvent) params.onEvent({ _tag: "TextDelta", delta: "build: Pkg2" })
          return Effect.succeed<AgentResult>({ sessionId: undefined })
        },
        isAvailable: () => Effect.succeed(true),
      })
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
      const partiallyDone = [
        "# Feature",
        "",
        "## Action Items",
        "",
        "### Pkg1",
        "",
        "- [x] Item 1",
        "  - Detail",
        "  - Tests: check",
        "",
        "### Pkg2",
        "",
        "- [ ] Item 2",
        "  - Detail",
        "  - Tests: check",
        "",
      ].join("\n")
      yield* buildCommand(mockFsWithProgress(partiallyDone)).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer, nodeLayer)),
      )
      const buildCalls = calls.filter((c) => c.mode === "build")
      expect(buildCalls.length).toBe(1)
      expect(buildCalls[0]!.prompt).toContain("Item 2")
      expect(buildCalls[0]!.prompt).not.toContain("Item 1")
      expect(gitCalls.some((c) => c === "commit:🔨 build: Pkg2")).toBe(true)
    }),
  )

  it.effect("exits when no unchecked items", () =>
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
      const allDone = [
        "# Feature",
        "",
        "## Action Items",
        "",
        "### Done",
        "",
        "- [x] Done item",
        "  - Detail",
        "",
      ].join("\n")
      yield* buildCommand(mockFs(allDone)).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
      expect(calls.length).toBe(0)
    }),
  )

  it.effect("processes packages one at a time", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      const gitCalls: string[] = []
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: (params) => {
          calls.push(params)
          if (params.onEvent) params.onEvent({ _tag: "TextDelta", delta: "build: Error Handling" })
          return Effect.succeed<AgentResult>({ sessionId: undefined })
        },
        isAvailable: () => Effect.succeed(true),
      })
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
      const packagedPlan = [
        "# Feature",
        "",
        "## Action Items",
        "",
        "### Error Handling",
        "",
        "- [ ] Capture stderr",
        "  - Pipe stderr to buffer",
        "  - Tests: check captured stderr",
        "- [ ] Include stderr in error",
        "  - Add stderr field",
        "  - Tests: verify error message",
        "",
        "### Integration Tests",
        "",
        "- [ ] Agent spawning tests",
        "  - Create mock executables",
        "  - Tests: verify spawning",
        "",
      ].join("\n")
      yield* buildCommand(mockFsWithProgress(packagedPlan)).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer, nodeLayer)),
      )
      const buildCalls = calls.filter((c) => c.mode === "build")
      expect(buildCalls.length).toBeGreaterThanOrEqual(1)
      expect(buildCalls[0]!.prompt).toContain("Capture stderr")
      expect(buildCalls[0]!.prompt).toContain("Include stderr in error")
      expect(gitCalls.some((c) => c === "commit:🔨 build: Error Handling")).toBe(true)
    }),
  )

  it.effect("second package prompt includes completed summary of first", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: (params) => {
          calls.push(params)
          return Effect.succeed<AgentResult>({ sessionId: undefined })
        },
        isAvailable: () => Effect.succeed(true),
      })
      let readCount = 0
      const initial = [
        "# Feature",
        "",
        "## Action Items",
        "",
        "### Error Handling",
        "",
        "- [ ] Capture stderr",
        "  - Pipe stderr to buffer",
        "  - Tests: check captured stderr",
        "",
        "### Integration Tests",
        "",
        "- [ ] Agent spawning tests",
        "  - Create mock executables",
        "  - Tests: verify spawning",
        "",
      ].join("\n")
      const pkg1Done = initial.replace("- [ ] Capture stderr", "- [x] Capture stderr")
      const allDone = initial.replace(/- \[ \]/g, "- [x]")
      const fs = {
        readFile: () => {
          const count = readCount++
          if (count <= 1) return Effect.succeed(initial)
          if (count === 2) return Effect.succeed(pkg1Done)
          return Effect.succeed(allDone)
        },
        exists: () => Effect.succeed(true),
        getDiffContent: () => Effect.succeed(""),
        remove: () => Effect.void,
      }
      yield* buildCommand(fs).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
      const buildCalls = calls.filter((c) => c.mode === "build")
      expect(buildCalls.length).toBe(2)
      expect(buildCalls[0]!.prompt).toContain("No previous packages completed.")
      expect(buildCalls[1]!.prompt).toContain("Error Handling")
      expect(buildCalls[1]!.prompt).toContain("implemented and tests passing")
    }),
  )

  it.effect("retries chain session IDs from build through retries", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      let callCount = 0
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: (params) => {
          const count = callCount++
          // Build returns "ses-build-1", retry1 returns "ses-retry-1", commit msg calls return undefined
          const sessionId = count === 0 ? "ses-build-1" : count === 1 ? "ses-retry-1" : undefined
          calls.push(params)
          return Effect.succeed<AgentResult>({ sessionId })
        },
        isAvailable: () => Effect.succeed(true),
      })

      let testRunCount = 0
      const mockTestRunner = (_cmd: string): Effect.Effect<TestResult> =>
        Effect.succeed({
          exitCode: testRunCount++ < 2 ? 1 : 0,
          output: "FAIL: some test",
        })

      const singleItem = [
        "# Feature",
        "",
        "## Action Items",
        "",
        "### Setup",
        "",
        "- [ ] Only item",
        "  - Detail",
        "  - Tests: check",
        "",
      ].join("\n")

      const fs = {
        ...mockFsWithProgress(singleItem),
        runTests: mockTestRunner,
      }

      yield* buildCommand(fs).pipe(
        Effect.provide(
          Layer.mergeAll(mockConfig({ testCmd: "npm test", testRetries: 3 }), mockGit(), agentLayer, nodeLayer),
        ),
      )

      const buildCalls = calls.filter((c) => c.mode === "build")
      // Initial build + 2 retries = 3 calls
      expect(buildCalls.length).toBe(3)
      expect(buildCalls[0]!.resumeSessionId).toBeUndefined()
      expect(buildCalls[1]!.resumeSessionId).toBe("ses-build-1")
      expect(buildCalls[1]!.prompt).toContain("Tests failed:")
      expect(buildCalls[1]!.prompt).not.toContain("You are a build agent")
      expect(buildCalls[2]!.resumeSessionId).toBe("ses-retry-1")
    }),
  )

  it.effect("resumes plan session for every package", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: (params) => {
          calls.push(params)
          return Effect.succeed<AgentResult>({ sessionId: "build-ses" })
        },
        isAvailable: () => Effect.succeed(true),
      })
      let readCount = 0
      const initial = [
        "# Feature",
        "",
        "## Action Items",
        "",
        "### Pkg1",
        "",
        "- [ ] Item 1",
        "  - Detail",
        "  - Tests: check",
        "",
        "### Pkg2",
        "",
        "- [ ] Item 2",
        "  - Detail",
        "  - Tests: check",
        "",
      ].join("\n")
      const pkg1Done = initial.replace("- [ ] Item 1", "- [x] Item 1")
      const allDone = initial.replace(/- \[ \]/g, "- [x]")
      const fs = {
        readFile: () => {
          const count = readCount++
          if (count <= 1) return Effect.succeed(initial)
          if (count <= 3) return Effect.succeed(pkg1Done)
          return Effect.succeed(allDone)
        },
        exists: () => Effect.succeed(true),
        getDiffContent: () => Effect.succeed(""),
        remove: () => Effect.void,
        readSessionId: () => Effect.succeed("plan-ses-xyz" as string | undefined),
        deleteSessionFile: () => Effect.void,
      }
      yield* buildCommand(fs).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
      const buildCalls = calls.filter((c) => c.mode === "build")
      expect(buildCalls[0]!.resumeSessionId).toBe("plan-ses-xyz")
      expect(buildCalls[1]!.resumeSessionId).toBe("plan-ses-xyz")
    }),
  )

  it.effect("test retries do not affect plan session", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      let buildCallCount = 0
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: (params) => {
          calls.push(params)
          if (params.mode === "build") {
            const count = buildCallCount++
            const sessionId = count === 0 ? "ses-build-1" : count === 1 ? "ses-retry-1" : "ses-build-2"
            return Effect.succeed<AgentResult>({ sessionId })
          }
          return Effect.succeed<AgentResult>({ sessionId: undefined })
        },
        isAvailable: () => Effect.succeed(true),
      })

      let testRunCount = 0
      const mockTestRunner = (_cmd: string): Effect.Effect<TestResult> =>
        Effect.succeed({
          exitCode: testRunCount++ === 0 ? 1 : 0,
          output: "FAIL: some test",
        })

      let readCount = 0
      const initial = [
        "# Feature",
        "",
        "## Action Items",
        "",
        "### Pkg1",
        "",
        "- [ ] Item 1",
        "  - Detail",
        "  - Tests: check",
        "",
        "### Pkg2",
        "",
        "- [ ] Item 2",
        "  - Detail",
        "  - Tests: check",
        "",
      ].join("\n")
      const pkg1Done = initial.replace("- [ ] Item 1", "- [x] Item 1")
      const allDone = initial.replace(/- \[ \]/g, "- [x]")
      const fs = {
        readFile: () => {
          const count = readCount++
          if (count <= 1) return Effect.succeed(initial)
          if (count === 2) return Effect.succeed(pkg1Done)
          return Effect.succeed(allDone)
        },
        exists: () => Effect.succeed(true),
        getDiffContent: () => Effect.succeed(""),
        remove: () => Effect.void,
        readSessionId: () => Effect.succeed("plan-ses-xyz" as string | undefined),
        deleteSessionFile: () => Effect.void,
        runTests: mockTestRunner,
      }
      yield* buildCommand(fs).pipe(
        Effect.provide(
          Layer.mergeAll(mockConfig({ testCmd: "npm test", testRetries: 3 }), mockGit(), agentLayer, nodeLayer),
        ),
      )
      const buildCalls = calls.filter((c) => c.mode === "build")
      // 3 build calls: pkg1 build, pkg1 retry, pkg2 build
      expect(buildCalls.length).toBe(3)
      expect(buildCalls[0]!.resumeSessionId).toBe("plan-ses-xyz")
      expect(buildCalls[1]!.resumeSessionId).toBe("ses-build-1")
      expect(buildCalls[2]!.resumeSessionId).toBe("plan-ses-xyz")
    }),
  )

  it.effect("retries use full prompt when no sessionId", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: (params) => {
          calls.push(params)
          return Effect.succeed<AgentResult>({ sessionId: undefined })
        },
        isAvailable: () => Effect.succeed(true),
      })

      let testRunCount = 0
      const mockTestRunner = (_cmd: string): Effect.Effect<TestResult> =>
        Effect.succeed({
          exitCode: testRunCount++ === 0 ? 1 : 0,
          output: "FAIL: some test",
        })

      const singleItem = [
        "# Feature",
        "",
        "## Action Items",
        "",
        "### Setup",
        "",
        "- [ ] Only item",
        "  - Detail",
        "  - Tests: check",
        "",
      ].join("\n")

      const fs = {
        ...mockFsWithProgress(singleItem),
        runTests: mockTestRunner,
      }

      yield* buildCommand(fs).pipe(
        Effect.provide(
          Layer.mergeAll(mockConfig({ testCmd: "npm test", testRetries: 3 }), mockGit(), agentLayer, nodeLayer),
        ),
      )

      const buildCalls = calls.filter((c) => c.mode === "build")
      expect(buildCalls.length).toBe(2)
      expect(buildCalls[1]!.resumeSessionId).toBeUndefined()
      expect(buildCalls[1]!.prompt).toContain("You are a build agent")
    }),
  )

  it.effect("clears session file after all items built", () =>
    Effect.gen(function* () {
      let sessionDeleted = false
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: () => Effect.succeed<AgentResult>({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })
      const singleItem = [
        "# Feature",
        "",
        "## Action Items",
        "",
        "### Setup",
        "",
        "- [ ] Only item",
        "  - Detail",
        "  - Tests: check",
        "",
      ].join("\n")
      const fs = {
        ...mockFsWithProgress(singleItem),
        readSessionId: () => Effect.succeed(undefined as string | undefined),
        deleteSessionFile: () =>
          Effect.sync(() => {
            sessionDeleted = true
          }),
      }
      yield* buildCommand(fs).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
      expect(sessionDeleted).toBe(true)
    }),
  )

  it.effect("fails when agent makes no changes", () =>
    Effect.gen(function* () {
      const gitCalls: string[] = []
      const gitLayer = mockGit({
        hasUncommittedChanges: () => Effect.succeed(false),
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
        invoke: () => Effect.succeed<AgentResult>({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })
      const singleItem = [
        "# Feature",
        "",
        "## Action Items",
        "",
        "### Setup",
        "",
        "- [ ] Only item",
        "  - Detail",
        "  - Tests: check",
        "",
      ].join("\n")
      yield* buildCommand(mockFsWithProgress(singleItem)).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer, nodeLayer)),
      )
      // Should NOT commit anything
      expect(gitCalls).not.toContain("addAll")
      expect(gitCalls.some((c) => c.startsWith("commit:"))).toBe(false)
    }),
  )

  it.effect("handles inactivity timeout error gracefully", () =>
    Effect.gen(function* () {
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: () =>
          Effect.fail(
            new AgentError("Agent timed out after 300s of inactivity", undefined, "inactivity_timeout"),
          ),
        isAvailable: () => Effect.succeed(true),
      })
      const singleItem = [
        "# Feature",
        "",
        "## Action Items",
        "",
        "### Setup",
        "",
        "- [ ] Only item",
        "  - Detail",
        "  - Tests: check",
        "",
      ].join("\n")
      // Should not throw — error is caught and logged
      yield* buildCommand(mockFsWithProgress(singleItem)).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
    }),
  )

  it.effect("handles input_requested error gracefully", () =>
    Effect.gen(function* () {
      const agentLayer = Layer.succeed(AgentService, {
        name: "mock",
        resolvedName: "mock",
        providerType: "pi",
        invoke: () =>
          Effect.fail(
            new AgentError("Agent invoked forbidden tool: AskUserQuestion", undefined, "input_requested"),
          ),
        isAvailable: () => Effect.succeed(true),
      })
      const singleItem = [
        "# Feature",
        "",
        "## Action Items",
        "",
        "### Setup",
        "",
        "- [ ] Only item",
        "  - Detail",
        "  - Tests: check",
        "",
      ].join("\n")
      yield* buildCommand(mockFsWithProgress(singleItem)).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer, nodeLayer)),
      )
    }),
  )

})
