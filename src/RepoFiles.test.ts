import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect, Layer } from "effect"
import { RepoFiles, templateRead } from "./RepoFiles.js"
import { Cwd } from "./Cwd.js"
import { GitService, type GitOperations } from "./Git.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "gtd-repo-files-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const failingGit: GitOperations = new Proxy({} as GitOperations, {
  get: () => () => Effect.fail(new Error("GitService must not be called")),
})

const runWithFiles = <A>(
  eff: Effect.Effect<A, Error, RepoFiles>,
  git: GitOperations = failingGit,
): Promise<A> =>
  Effect.runPromise(
    eff.pipe(
      Effect.provide(RepoFiles.Live),
      Effect.provide(Layer.succeed(GitService, git)),
      Effect.provide(Cwd.layer(tmpDir)),
    ),
  )

describe("RepoFiles.working", () => {
  it("reads a present working-tree file", async () => {
    writeFileSync(join(tmpDir, "a.txt"), "hello\n")
    const content = await runWithFiles(
      Effect.gen(function* () {
        const files = yield* RepoFiles
        return files.working("a.txt")
      }),
    )
    expect(content).toBe("hello\n")
  })

  it("distinguishes an absent file (undefined) from an empty one", async () => {
    writeFileSync(join(tmpDir, "empty.txt"), "")
    const [absent, empty] = await runWithFiles(
      Effect.gen(function* () {
        const files = yield* RepoFiles
        return [files.working("missing.txt"), files.working("empty.txt")]
      }),
    )
    expect(absent).toBeUndefined()
    expect(empty).toBe("")
  })

  it("rethrows a non-ENOENT failure instead of swallowing it", async () => {
    mkdirSync(join(tmpDir, "adir"))
    await expect(
      runWithFiles(
        Effect.gen(function* () {
          const files = yield* RepoFiles
          return files.working("adir")
        }),
      ),
    ).rejects.toThrow()
  })
})

describe("RepoFiles.committed", () => {
  it("returns the file's contents at the given ref", async () => {
    const git: GitOperations = {
      ...failingGit,
      readFileAtRef: (ref, path) =>
        ref === "HEAD" && path === "a.txt"
          ? Effect.succeed("committed\n")
          : Effect.fail(new Error()),
    }
    const content = await runWithFiles(
      Effect.gen(function* () {
        const files = yield* RepoFiles
        return yield* files.committed("a.txt")
      }),
      git,
    )
    expect(content).toBe("committed\n")
  })

  it("returns undefined for a path absent at the ref", async () => {
    const git: GitOperations = {
      ...failingGit,
      readFileAtRef: () => Effect.fail(new Error("path not found")),
    }
    const content = await runWithFiles(
      Effect.gen(function* () {
        const files = yield* RepoFiles
        return yield* files.committed("missing.txt")
      }),
      git,
    )
    expect(content).toBeUndefined()
  })

  it("defaults to HEAD but accepts an explicit ref", async () => {
    const git: GitOperations = {
      ...failingGit,
      readFileAtRef: (ref, path) =>
        ref === "abc123" && path === "a.txt"
          ? Effect.succeed("at abc123\n")
          : Effect.fail(new Error()),
    }
    const content = await runWithFiles(
      Effect.gen(function* () {
        const files = yield* RepoFiles
        return yield* files.committed("a.txt", "abc123")
      }),
      git,
    )
    expect(content).toBe("at abc123\n")
  })
})

describe("templateRead", () => {
  it("returns a present file's content", () => {
    const read = templateRead({
      working: (path) => (path === "a.txt" ? "hello\n" : undefined),
      committed: () => Effect.succeed(undefined),
    })
    expect(read("a.txt")).toBe("hello\n")
  })

  it("throws the canonical ENOENT message for an absent path", () => {
    const read = templateRead({
      working: () => undefined,
      committed: () => Effect.succeed(undefined),
    })
    expect(() => read("missing.txt")).toThrow(
      "ENOENT: no such file or directory, open 'missing.txt'",
    )
  })
})
