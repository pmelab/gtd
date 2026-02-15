import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { AgentService } from "./Agent.js"
import { AgentError } from "./Agent.js"
import { generateCommitMessage } from "./CommitMessage.js"

const mockAgent = (textResponse: string) =>
  Layer.succeed(AgentService, {
    invoke: (params) =>
      Effect.sync(() => {
        if (params.onEvent) {
          params.onEvent({ _tag: "TextDelta", delta: textResponse })
        }
        return { sessionId: undefined }
      }),
    isAvailable: () => Effect.succeed(true),
  })

describe("generateCommitMessage", () => {
  it.effect("returns emoji + LLM summary", () =>
    Effect.gen(function* () {
      const result = yield* generateCommitMessage("🤦", "diff --git a/foo.ts\n+const x = 1").pipe(
        Effect.provide(mockAgent("add constant x to foo")),
      )

      expect(result).toBe("🤦 add constant x to foo")
    }),
  )

  it.effect("passes diff to agent with summarization prompt", () =>
    Effect.gen(function* () {
      let capturedPrompt = ""
      const agentLayer = Layer.succeed(AgentService, {
        invoke: (params) => {
          capturedPrompt = params.prompt
          return Effect.succeed({ sessionId: undefined })
        },
        isAvailable: () => Effect.succeed(true),
      })

      yield* generateCommitMessage("🔨", "diff --git a/bar.ts\n+export const bar = true").pipe(
        Effect.provide(agentLayer),
      )

      expect(capturedPrompt).toContain("diff --git a/bar.ts")
      expect(capturedPrompt).toContain("commit message")
    }),
  )

  it.effect("uses agent text delta as the descriptive part", () =>
    Effect.gen(function* () {
      const result = yield* generateCommitMessage("🤖", "some diff").pipe(
        Effect.provide(mockAgent("refactor auth module")),
      )

      expect(result).toBe("🤖 refactor auth module")
    }),
  )

  it.effect("falls back to default message when agent returns empty", () =>
    Effect.gen(function* () {
      const result = yield* generateCommitMessage("🤦", "some diff").pipe(
        Effect.provide(mockAgent("")),
      )

      expect(result).toBe("🤦 update")
    }),
  )

  it.effect("falls back to default message when agent fails", () =>
    Effect.gen(function* () {
      const agentLayer = Layer.succeed(AgentService, {
        invoke: () => Effect.fail(new AgentError("fail", undefined, "general")),
        isAvailable: () => Effect.succeed(true),
      })

      const result = yield* generateCommitMessage("🔨", "some diff").pipe(
        Effect.provide(agentLayer),
      )

      expect(result).toBe("🔨 update")
    }),
  )

  it.effect("truncates to max 72 chars total", () =>
    Effect.gen(function* () {
      const longMessage = "a".repeat(100)

      const result = yield* generateCommitMessage("🤖", "some diff").pipe(
        Effect.provide(mockAgent(longMessage)),
      )

      expect(result.length).toBeLessThanOrEqual(72)
      expect(result.startsWith("🤖 ")).toBe(true)
    }),
  )

  it.effect("strips quotes from agent response", () =>
    Effect.gen(function* () {
      const result = yield* generateCommitMessage("🤦", "some diff").pipe(
        Effect.provide(mockAgent('"add error handling"')),
      )

      expect(result).toBe("🤦 add error handling")
    }),
  )

  it.effect("uses only first line of multi-line response", () =>
    Effect.gen(function* () {
      const result = yield* generateCommitMessage("🔨", "some diff").pipe(
        Effect.provide(mockAgent("fix bug in parser\n\nMore details here")),
      )

      expect(result).toBe("🔨 fix bug in parser")
    }),
  )
})
