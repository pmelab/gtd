import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { GtdConfigService } from "../services/Config.js"
import { GitService } from "../services/Git.js"
import { cleanupCommand } from "./cleanup.js"

const defaultConfig = {
  file: "TODO.md",
  agent: "auto",
  agentPlan: "plan",
  agentBuild: "code",
  agentLearn: "plan",
  testCmd: "npm test",
  testRetries: 10,
  commitPrompt: "{{diff}}",
}

const mockConfig = (overrides: Partial<typeof defaultConfig> = {}) =>
  Layer.succeed(GtdConfigService, { ...defaultConfig, ...overrides })

const mockGit = (overrides: Partial<GitService["Type"]> = {}) => {
  const base: GitService["Type"] = {
    getDiff: () => Effect.succeed(""),
    hasUnstagedChanges: () => Effect.succeed(false),
    hasUncommittedChanges: () => Effect.succeed(false),
    getLastCommitMessage: () => Effect.succeed(""),
    add: (() => Effect.void) as GitService["Type"]["add"],
    addAll: () => Effect.void,
    commit: (() => Effect.void) as GitService["Type"]["commit"],
    show: () => Effect.succeed(""),
    atomicCommit: ((files: ReadonlyArray<string> | "all", message: string) =>
      Effect.gen(function* () {
        if (files === "all") yield* base.addAll()
        else yield* base.add(files)
        yield* base.commit(message)
      })) as GitService["Type"]["atomicCommit"],
    ...overrides,
  }
  if (overrides.atomicCommit) {
    base.atomicCommit = overrides.atomicCommit
  }
  return Layer.succeed(GitService, base)
}

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
