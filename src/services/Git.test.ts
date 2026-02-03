import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { GitService } from "./Git.js"

const mockGit = (overrides: Partial<GitService["Type"]> = {}) =>
  Layer.succeed(GitService, {
    getDiff: () => Effect.succeed("mock diff"),
    hasUnstagedChanges: () => Effect.succeed(false),
    hasUncommittedChanges: () => Effect.succeed(false),
    getLastCommitMessage: () => Effect.succeed("mock message"),
    add: () => Effect.void,
    addAll: () => Effect.void,
    commit: () => Effect.void,
    show: () => Effect.succeed("mock content"),
    atomicCommit: (files, message) =>
      Effect.gen(function* () {
        const self = {
          add: () => Effect.void,
          addAll: () => Effect.void,
          commit: () => Effect.void,
          ...overrides,
        }
        if (files === "all") yield* self.addAll()
        else yield* self.add(files)
        yield* self.commit(message)
      }),
    ...overrides,
  } satisfies GitService["Type"])

describe("GitService", () => {
  it.effect("getDiff returns diff content", () =>
    Effect.gen(function* () {
      const git = yield* GitService
      const diff = yield* git.getDiff()
      expect(diff).toBe("mock diff")
    }).pipe(Effect.provide(mockGit())),
  )

  it.effect("hasUnstagedChanges returns boolean", () =>
    Effect.gen(function* () {
      const git = yield* GitService
      const result = yield* git.hasUnstagedChanges()
      expect(result).toBe(true)
    }).pipe(Effect.provide(mockGit({ hasUnstagedChanges: () => Effect.succeed(true) }))),
  )

  it.effect("add accepts file array", () =>
    Effect.gen(function* () {
      const git = yield* GitService
      yield* git.add(["file1.ts", "file2.ts"])
    }).pipe(Effect.provide(mockGit())),
  )

  it.effect("commit accepts message", () =>
    Effect.gen(function* () {
      const git = yield* GitService
      yield* git.commit("test: feature")
    }).pipe(Effect.provide(mockGit())),
  )

  it.effect("show returns content", () =>
    Effect.gen(function* () {
      const git = yield* GitService
      const content = yield* git.show("HEAD:TODO.md")
      expect(content).toBe("file content")
    }).pipe(Effect.provide(mockGit({ show: () => Effect.succeed("file content") }))),
  )

  it.effect("atomicCommit calls add then commit", () =>
    Effect.gen(function* () {
      const git = yield* GitService
      yield* git.atomicCommit(["a.ts", "b.ts"], "test msg")
    }).pipe(
      Effect.provide(
        mockGit({
          add: (files) =>
            Effect.sync(() => {
              expect(files).toEqual(["a.ts", "b.ts"])
            }),
          commit: (msg) =>
            Effect.sync(() => {
              expect(msg).toBe("test msg")
            }),
        }),
      ),
    ),
  )

  it.effect("atomicCommit with 'all' calls addAll", () =>
    Effect.gen(function* () {
      const git = yield* GitService
      yield* git.atomicCommit("all", "commit all")
    }).pipe(
      Effect.provide(
        mockGit({
          addAll: () => Effect.void,
          commit: (msg) =>
            Effect.sync(() => {
              expect(msg).toBe("commit all")
            }),
        }),
      ),
    ),
  )

  it.effect("getLastCommitMessage returns subject line", () =>
    Effect.gen(function* () {
      const git = yield* GitService
      const msg = yield* git.getLastCommitMessage()
      expect(msg).toBe("🔨 implement feature")
    }).pipe(
      Effect.provide(
        mockGit({
          getLastCommitMessage: () => Effect.succeed("🔨 implement feature"),
        }),
      ),
    ),
  )

  it.effect("hasUncommittedChanges returns true when dirty", () =>
    Effect.gen(function* () {
      const git = yield* GitService
      const result = yield* git.hasUncommittedChanges()
      expect(result).toBe(true)
    }).pipe(
      Effect.provide(
        mockGit({ hasUncommittedChanges: () => Effect.succeed(true) }),
      ),
    ),
  )

  it.effect("hasUncommittedChanges returns false when clean", () =>
    Effect.gen(function* () {
      const git = yield* GitService
      const result = yield* git.hasUncommittedChanges()
      expect(result).toBe(false)
    }).pipe(
      Effect.provide(
        mockGit({ hasUncommittedChanges: () => Effect.succeed(false) }),
      ),
    ),
  )
})
