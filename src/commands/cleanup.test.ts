import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { cleanupCommand } from "./cleanup.js"
import { mockConfig, mockGit } from "../test-helpers.js"
import { AgentService } from "../services/Agent.js"

const mockAgent = (summary = "add multiply function") =>
  Layer.succeed(AgentService, {
    resolvedName: "mock",
    invoke: (params) =>
      Effect.sync(() => {
        if (params.onEvent) {
          params.onEvent({ _tag: "TextDelta", delta: summary })
        }
        return { sessionId: undefined }
      }),
  })

const seedDiff = `diff --git a/TODO.md b/TODO.md
new file mode 100644
+++ b/TODO.md
+add multiply function to math.ts
+add tests for multiply`

const grillDiff = `diff --git a/TODO.md b/TODO.md
+++ b/TODO.md
+## Open Questions
+- What return type?
+
+number`

const makeLayer = (overrides: Parameters<typeof mockGit>[0] = {}) =>
  Layer.mergeAll(mockConfig(), mockGit(overrides), mockAgent())

describe("cleanupCommand", () => {
  it.effect("removes TODO.md", () =>
    Effect.gen(function* () {
      let removed = false
      const fs = {
        remove: () =>
          Effect.sync(() => {
            removed = true
          }),
        exists: () => Effect.succeed(true),
      }
      yield* cleanupCommand({ fs }).pipe(Effect.provide(makeLayer()))
      expect(removed).toBe(true)
    }),
  )

  it.effect("commits with conventional commit subject when seed found", () =>
    Effect.gen(function* () {
      const commits: string[] = []
      const fs = { remove: () => Effect.void, exists: () => Effect.succeed(true) }
      const layer = Layer.mergeAll(
        mockConfig(),
        mockGit({
          getCommitLog: () =>
            Effect.succeed([
              { hash: "abc123", subject: "🌱 seed: initial task" },
            ]),
          show: () => Effect.succeed(seedDiff),
          commit: (msg) =>
            Effect.sync(() => {
              commits.push(msg)
            }),
        }),
        mockAgent("feat: add multiply function"),
      )
      yield* cleanupCommand({ fs }).pipe(Effect.provide(layer))
      expect(commits.length).toBe(1)
      expect(commits[0]).toMatch(/^(feat|fix|refactor):/)
    }),
  )

  it.effect("commit message subject uses LLM summary of seed", () =>
    Effect.gen(function* () {
      const commits: string[] = []
      const fs = { remove: () => Effect.void, exists: () => Effect.succeed(true) }
      const layer = Layer.mergeAll(
        mockConfig(),
        mockGit({
          getCommitLog: () =>
            Effect.succeed([{ hash: "abc123", subject: "🌱 seed: initial" }]),
          show: () => Effect.succeed(seedDiff),
          commit: (msg) =>
            Effect.sync(() => {
              commits.push(msg)
            }),
        }),
        mockAgent("feat: implement multiply"),
      )
      yield* cleanupCommand({ fs }).pipe(Effect.provide(layer))
      expect(commits[0]).toMatch(/^feat: implement multiply/)
    }),
  )

  it.effect("commit message body contains ## Seed section", () =>
    Effect.gen(function* () {
      const commits: string[] = []
      const fs = { remove: () => Effect.void, exists: () => Effect.succeed(true) }
      const layer = Layer.mergeAll(
        mockConfig(),
        mockGit({
          getCommitLog: () =>
            Effect.succeed([{ hash: "abc123", subject: "🌱 seed: initial" }]),
          show: () => Effect.succeed(seedDiff),
          commit: (msg) =>
            Effect.sync(() => {
              commits.push(msg)
            }),
        }),
        mockAgent("add multiply"),
      )
      yield* cleanupCommand({ fs }).pipe(Effect.provide(layer))
      expect(commits[0]).toContain("## Seed")
      expect(commits[0]).toContain("add multiply function to math.ts")
    }),
  )

  it.effect("commit message contains ## Grill when grill commits exist", () =>
    Effect.gen(function* () {
      const commits: string[] = []
      const fs = { remove: () => Effect.void, exists: () => Effect.succeed(true) }
      const layer = Layer.mergeAll(
        mockConfig(),
        mockGit({
          getCommitLog: () =>
            Effect.succeed([
              { hash: "grill1", subject: "🔍 grill: questions" },
              { hash: "seed1", subject: "🌱 seed: initial" },
            ]),
          show: (ref) =>
            ref === "seed1" ? Effect.succeed(seedDiff) : Effect.succeed(grillDiff),
          commit: (msg) =>
            Effect.sync(() => {
              commits.push(msg)
            }),
        }),
        mockAgent("add multiply"),
      )
      yield* cleanupCommand({ fs }).pipe(Effect.provide(layer))
      expect(commits[0]).toContain("## Grill")
      expect(commits[0]).toContain("What return type?")
    }),
  )

  it.effect("omits ## Grill when no grill commits", () =>
    Effect.gen(function* () {
      const commits: string[] = []
      const fs = { remove: () => Effect.void, exists: () => Effect.succeed(true) }
      const layer = Layer.mergeAll(
        mockConfig(),
        mockGit({
          getCommitLog: () =>
            Effect.succeed([{ hash: "seed1", subject: "🌱 seed: initial" }]),
          show: () => Effect.succeed(seedDiff),
          commit: (msg) =>
            Effect.sync(() => {
              commits.push(msg)
            }),
        }),
        mockAgent("add multiply"),
      )
      yield* cleanupCommand({ fs }).pipe(Effect.provide(layer))
      expect(commits[0]).not.toContain("## Grill")
    }),
  )

  it.effect("falls back to hardcoded message when no seed found in history", () =>
    Effect.gen(function* () {
      const commits: string[] = []
      const fs = { remove: () => Effect.void, exists: () => Effect.succeed(true) }
      const layer = Layer.mergeAll(
        mockConfig(),
        mockGit({
          getCommitLog: () => Effect.succeed([{ hash: "abc", subject: "🔨 build: something" }]),
          commit: (msg) =>
            Effect.sync(() => {
              commits.push(msg)
            }),
        }),
        mockAgent("anything"),
      )
      yield* cleanupCommand({ fs }).pipe(Effect.provide(layer))
      expect(commits[0]).toBe("refactor: remove TODO.md")
    }),
  )

  it.effect("skips when TODO.md does not exist", () =>
    Effect.gen(function* () {
      let removed = false
      const commits: string[] = []
      const fs = {
        remove: () =>
          Effect.sync(() => {
            removed = true
          }),
        exists: () => Effect.succeed(false),
      }
      const layer = Layer.mergeAll(
        mockConfig(),
        mockGit({
          commit: (msg) =>
            Effect.sync(() => {
              commits.push(msg)
            }),
        }),
        mockAgent(),
      )
      yield* cleanupCommand({ fs }).pipe(Effect.provide(layer))
      expect(removed).toBe(false)
      expect(commits.length).toBe(0)
    }),
  )
})
