import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { NodeContext } from "@effect/platform-node"
import { GitService } from "./Git.js"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execSync } from "node:child_process"

const mockGit = (overrides: Partial<GitService["Type"]> = {}) =>
  Layer.succeed(GitService, {
    getDiff: () => Effect.succeed("mock diff"),
    hasUnstagedChanges: () => Effect.succeed(false),
    hasUncommittedChanges: () => Effect.succeed(false),
    getLastCommitMessage: () => Effect.succeed("mock message"),
    getCommitMessages: () => Effect.succeed([]),
    add: () => Effect.void,
    addAll: () => Effect.void,
    commit: () => Effect.void,
    emptyCommit: () => Effect.void,
    show: () => Effect.succeed("mock content"),
    amendFiles: () => Effect.void,
    stageByPatch: () => Effect.void,
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

const execInDir = (dir: string, cmd: string) =>
  Effect.sync(() => execSync(cmd, { cwd: dir, encoding: "utf-8" }))

describe("GitService.getDiff (integration)", () => {
  const setupRepo = (dir: string) =>
    Effect.gen(function* () {
      yield* execInDir(dir, "git init")
      yield* execInDir(dir, "git config user.email test@test.com")
      yield* execInDir(dir, "git config user.name Test")
      yield* Effect.promise(() => writeFile(join(dir, "initial.txt"), "hello\n"))
      yield* execInDir(dir, "git add -A && git commit -m 'initial'")
    })

  it.effect(
    "includes untracked files with /dev/null header",
    () =>
      Effect.gen(function* () {
        const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "git-diff-untracked-")))
        yield* setupRepo(dir)

        yield* Effect.promise(() => writeFile(join(dir, "TODO.md"), "- task one\n"))

        const savedCwd = process.cwd()
        process.chdir(dir)

        const git = yield* GitService
        const diff = yield* git.getDiff()

        process.chdir(savedCwd)

        expect(diff).toContain("--- /dev/null")
        expect(diff).toContain("TODO.md")
        expect(diff).toContain("task one")
      }).pipe(Effect.provide(GitService.Live.pipe(Layer.provide(NodeContext.layer)))),
    { timeout: 10000 },
  )

  it.effect(
    "untracked file remains untracked after getDiff",
    () =>
      Effect.gen(function* () {
        const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "git-diff-cleanup-")))
        yield* setupRepo(dir)

        yield* Effect.promise(() => writeFile(join(dir, "TODO.md"), "- task\n"))

        const savedCwd = process.cwd()
        process.chdir(dir)

        const git = yield* GitService
        yield* git.getDiff()

        const status = yield* execInDir(dir, "git status --porcelain")

        process.chdir(savedCwd)

        expect(status).toContain("?? TODO.md")
      }).pipe(Effect.provide(GitService.Live.pipe(Layer.provide(NodeContext.layer)))),
    { timeout: 10000 },
  )

  it.effect(
    "tracked file diff works when no untracked files exist",
    () =>
      Effect.gen(function* () {
        const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "git-diff-tracked-")))
        yield* setupRepo(dir)

        yield* Effect.promise(() => writeFile(join(dir, "initial.txt"), "modified\n"))

        const savedCwd = process.cwd()
        process.chdir(dir)

        const git = yield* GitService
        const diff = yield* git.getDiff()

        process.chdir(savedCwd)

        expect(diff).toContain("initial.txt")
        expect(diff).toContain("modified")
      }).pipe(Effect.provide(GitService.Live.pipe(Layer.provide(NodeContext.layer)))),
    { timeout: 10000 },
  )

  it.effect(
    "includes staged-only changes in diff",
    () =>
      Effect.gen(function* () {
        const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "git-diff-staged-")))
        yield* setupRepo(dir)

        yield* Effect.promise(() => writeFile(join(dir, "TODO.md"), "- staged task\n"))
        yield* execInDir(dir, "git add TODO.md")

        const savedCwd = process.cwd()
        process.chdir(dir)

        const git = yield* GitService
        const diff = yield* git.getDiff()

        process.chdir(savedCwd)

        expect(diff).toContain("--- /dev/null")
        expect(diff).toContain("TODO.md")
        expect(diff).toContain("staged task")
      }).pipe(Effect.provide(GitService.Live.pipe(Layer.provide(NodeContext.layer)))),
    { timeout: 10000 },
  )
})

describe("GitService.stageByPatch (integration)", () => {
  it.effect(
    "stages only intended hunks, leaving other hunks unstaged",
    () =>
      Effect.gen(function* () {
        const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "git-patch-test-")))

        yield* execInDir(dir, "git init")
        yield* execInDir(dir, "git config user.email test@test.com")
        yield* execInDir(dir, "git config user.name Test")

        const initialContent = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n"
        yield* Effect.promise(() => writeFile(join(dir, "file.ts"), initialContent))
        yield* execInDir(dir, "git add -A && git commit -m 'initial'")

        const modifiedContent =
          "line1\nFIX_HUNK\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nFEEDBACK_HUNK\nline10\n"
        yield* Effect.promise(() => writeFile(join(dir, "file.ts"), modifiedContent))

        const fullDiff = yield* Effect.sync(() =>
          execSync("git diff", { cwd: dir, encoding: "utf-8" }),
        )

        const hunks = fullDiff.split(/(?=@@ )/)
        const header = hunks[0]!
        const fixPatch = header + hunks[1]!

        const savedCwd = process.cwd()
        process.chdir(dir)

        const git = yield* GitService

        yield* git.stageByPatch(fixPatch)

        const stagedDiff = yield* Effect.sync(() =>
          execSync("git diff --cached", { cwd: dir, encoding: "utf-8" }),
        )
        const unstagedDiff = yield* Effect.sync(() =>
          execSync("git diff", { cwd: dir, encoding: "utf-8" }),
        )

        process.chdir(savedCwd)

        expect(stagedDiff).toContain("FIX_HUNK")
        expect(stagedDiff).not.toContain("FEEDBACK_HUNK")
        expect(unstagedDiff).toContain("FEEDBACK_HUNK")
        expect(unstagedDiff).not.toContain("FIX_HUNK")
      }).pipe(Effect.provide(GitService.Live.pipe(Layer.provide(NodeContext.layer)))),
    { timeout: 10000 },
  )
})
