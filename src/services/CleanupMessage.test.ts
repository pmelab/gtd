import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { AgentService } from "./Agent.js"
import { AgentError } from "./Agent.js"
import { extractAddedLines, generateCleanupMessage } from "./CleanupMessage.js"

const mockAgent = (textResponse: string) =>
  Layer.succeed(AgentService, {
    resolvedName: "mock",
    invoke: (params) =>
      Effect.sync(() => {
        if (params.onEvent) {
          params.onEvent({ _tag: "TextDelta", delta: textResponse })
        }
        return { sessionId: undefined }
      }),
  })

const failingAgent = Layer.succeed(AgentService, {
  resolvedName: "mock",
  invoke: () => Effect.fail(new AgentError("fail", undefined, "general")),
})

describe("extractAddedLines", () => {
  it("extracts + lines, removes leading +", () => {
    const diff = `diff --git a/TODO.md b/TODO.md
+++ b/TODO.md
+add multiply function
+add tests`
    expect(extractAddedLines(diff)).toBe("add multiply function\nadd tests")
  })

  it("ignores +++ header lines", () => {
    const diff = `+++ b/TODO.md\n+real content`
    expect(extractAddedLines(diff)).toBe("real content")
  })

  it("ignores context and removed lines", () => {
    const diff = ` context line\n-removed line\n+added line`
    expect(extractAddedLines(diff)).toBe("added line")
  })

  it("returns empty string for diff with no additions", () => {
    const diff = `-removed line\n context line`
    expect(extractAddedLines(diff)).toBe("")
  })
})

describe("generateCleanupMessage", () => {
  const seedDiff = `+++ b/TODO.md\n+add multiply function to math.ts\n+add tests for multiply`

  it.effect("subject is a valid conventional commit type", () =>
    Effect.gen(function* () {
      const msg = yield* generateCleanupMessage(seedDiff, []).pipe(
        Effect.provide(mockAgent("feat: add multiply function")),
      )
      expect(msg.split("\n")[0]).toMatch(/^(feat|fix|refactor):/)
    }),
  )

  it.effect("subject uses LLM-generated conventional commit subject", () =>
    Effect.gen(function* () {
      const msg = yield* generateCleanupMessage(seedDiff, []).pipe(
        Effect.provide(mockAgent("feat: add multiply function")),
      )
      expect(msg.split("\n")[0]).toBe("feat: add multiply function")
    }),
  )

  it.effect("body contains ## Seed section with seed content", () =>
    Effect.gen(function* () {
      const msg = yield* generateCleanupMessage(seedDiff, []).pipe(
        Effect.provide(mockAgent("add multiply")),
      )
      expect(msg).toContain("## Seed")
      expect(msg).toContain("add multiply function to math.ts")
    }),
  )

  it.effect("omits ## Grill section when no grill diffs", () =>
    Effect.gen(function* () {
      const msg = yield* generateCleanupMessage(seedDiff, []).pipe(
        Effect.provide(mockAgent("add multiply")),
      )
      expect(msg).not.toContain("## Grill")
    }),
  )

  it.effect("includes ## Grill section when grill diffs provided", () =>
    Effect.gen(function* () {
      const grillDiff = `+++ b/TODO.md\n+## Open Questions\n+- What type should inputs be?\n+\n+Numbers (float64).`
      const msg = yield* generateCleanupMessage(seedDiff, [grillDiff]).pipe(
        Effect.provide(mockAgent("add multiply")),
      )
      expect(msg).toContain("## Grill")
      expect(msg).toContain("What type should inputs be?")
    }),
  )

  it.effect("falls back to default subject when agent returns empty", () =>
    Effect.gen(function* () {
      const msg = yield* generateCleanupMessage(seedDiff, []).pipe(Effect.provide(mockAgent("")))
      expect(msg.split("\n")[0]).toBe("refactor: remove todo file")
    }),
  )

  it.effect("falls back to default subject when agent returns invalid type", () =>
    Effect.gen(function* () {
      const msg = yield* generateCleanupMessage(seedDiff, []).pipe(
        Effect.provide(mockAgent("chore: something")),
      )
      expect(msg.split("\n")[0]).toBe("refactor: remove todo file")
    }),
  )

  it.effect("falls back to default subject when agent fails", () =>
    Effect.gen(function* () {
      const msg = yield* generateCleanupMessage(seedDiff, []).pipe(
        Effect.provide(failingAgent),
      )
      expect(msg.split("\n")[0]).toBe("refactor: remove todo file")
    }),
  )

  it.effect("truncates subject to max 72 chars", () =>
    Effect.gen(function* () {
      const longSummary = "feat: " + "a".repeat(100)
      const msg = yield* generateCleanupMessage(seedDiff, []).pipe(
        Effect.provide(mockAgent(longSummary)),
      )
      expect(msg.split("\n")[0]!.length).toBeLessThanOrEqual(72)
    }),
  )

  it.effect("strips quotes from agent response", () =>
    Effect.gen(function* () {
      const msg = yield* generateCleanupMessage(seedDiff, []).pipe(
        Effect.provide(mockAgent('"feat: add multiply function"')),
      )
      expect(msg.split("\n")[0]).toBe("feat: add multiply function")
    }),
  )

  it.effect("calls onStart and onStop callbacks", () =>
    Effect.gen(function* () {
      const calls: string[] = []
      yield* generateCleanupMessage(seedDiff, [], {
        onStart: () => calls.push("start"),
        onStop: () => calls.push("stop"),
      }).pipe(Effect.provide(mockAgent("add multiply")))
      expect(calls).toEqual(["start", "stop"])
    }),
  )

  it.effect("calls onStop even when agent fails", () =>
    Effect.gen(function* () {
      const calls: string[] = []
      yield* generateCleanupMessage(seedDiff, [], {
        onStart: () => calls.push("start"),
        onStop: () => calls.push("stop"),
      }).pipe(Effect.provide(failingAgent))
      expect(calls).toEqual(["start", "stop"])
    }),
  )

  it.effect("blank line separates subject from body", () =>
    Effect.gen(function* () {
      const msg = yield* generateCleanupMessage(seedDiff, []).pipe(
        Effect.provide(mockAgent("add multiply")),
      )
      const lines = msg.split("\n")
      expect(lines[1]).toBe("")
    }),
  )
})
