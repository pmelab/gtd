import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { cleanupCommand } from "./cleanup.js"
import { mockConfig, mockGit } from "../test-helpers.js"

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
      yield* cleanupCommand({ fs }).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit())),
      )
      expect(removed).toBe(true)
    }),
  )

  it.effect("commits with 🧹 prefix", () =>
    Effect.gen(function* () {
      const commits: string[] = []
      const fs = {
        remove: () => Effect.void,
        exists: () => Effect.succeed(true),
      }
      const gitLayer = mockGit({
        commit: (msg) =>
          Effect.sync(() => {
            commits.push(msg)
          }),
      })
      yield* cleanupCommand({ fs }).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer)),
      )
      expect(commits.length).toBe(1)
      expect(commits[0]).toBe("🧹 cleanup: remove TODO.md")
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
      const gitLayer = mockGit({
        commit: (msg) =>
          Effect.sync(() => {
            commits.push(msg)
          }),
      })
      yield* cleanupCommand({ fs }).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer)),
      )
      expect(removed).toBe(false)
      expect(commits.length).toBe(0)
    }),
  )
})
