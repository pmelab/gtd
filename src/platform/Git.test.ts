import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeContext } from "@effect/platform-node"
import { Cause, Effect, Exit, Option } from "effect"
import { describe, expect, it } from "vitest"
import { GitService, InvalidRefError, resolvedRefOrCorrupted } from "./Git.js"
import { Host } from "./index.js"
import { gitTiers, runGitServiceContract, runGitScriptContract } from "../testkit/index.js"

/**
 * The `GitOperations` contract, run identically against both the Live and
 * InMemory tiers (`src/testkit/GitTiers.ts`) — 20 operations × 2 tiers.
 */
for (const makeTier of gitTiers) {
  const name = makeTier().name
  describe(`GitService [${name}]`, () => {
    runGitServiceContract(makeTier)
  })
}

/**
 * `resolveRef`'s own validation, unit-tested directly rather than through a
 * real git repo — this is the rarer, defensive branch where the command
 * SUCCEEDS but its output isn't a 40-hex-char hash: a corrupted ref, this
 * module's own `InvalidRefError`.
 */
describe("resolvedRefOrCorrupted", () => {
  it("succeeds with a genuine 40-hex-char hash", async () => {
    const hash = "a".repeat(40)
    const result = await Effect.runPromise(resolvedRefOrCorrupted("HEAD", hash))
    expect(result).toBe(hash)
  })

  it("fails with an InvalidRefError naming the ref, for anything else", async () => {
    const exit = await Effect.runPromiseExit(resolvedRefOrCorrupted("some-ref", "not-a-hash"))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(InvalidRefError)
      expect(error).toHaveProperty("message", "Invalid ref: some-ref")
      if (error instanceof InvalidRefError) expect(error.detail).toEqual(["ref: some-ref"])
    }
  })
})

/** `GitScript.ts`'s builders as a driver runs them: real `sh` against the in-memory twin. */
for (const makeTier of gitTiers) {
  describe(`GitScript [${makeTier().name}]`, () => {
    runGitScriptContract(makeTier)
  })
}

describe("diffPaths [Live]", () => {
  it("stays repo-root-relative with diff.relative=true and a subdirectory cwd", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-diffpaths-")))
    try {
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim()
      git("init")
      git("config", "user.email", "test@test.com")
      git("config", "user.name", "Test")
      git("config", "commit.gpgsign", "false")
      git("config", "diff.relative", "true")
      mkdirSync(join(root, "sub"))
      writeFileSync(join(root, "sub", "a.txt"), "a")
      writeFileSync(join(root, "top.txt"), "t")
      git("add", "-A")
      git("commit", "-m", "one")
      const base = git("rev-parse", "HEAD")
      writeFileSync(join(root, "sub", "a.txt"), "b")
      writeFileSync(join(root, "top.txt"), "u")
      git("add", "-A")
      git("commit", "-m", "two")
      const tip = git("rev-parse", "HEAD")
      const paths = await Effect.runPromise(
        Effect.flatMap(GitService, (g) => g.diffPaths(base, tip)).pipe(
          Effect.provide(GitService.Live),
          Effect.provide(Host.layer({ root: join(root, "sub"), home: root, env: {} })),
          Effect.provide(NodeContext.layer),
        ),
      )
      expect([...paths].sort()).toEqual(["sub/a.txt", "top.txt"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  // An exported GIT_DIR/GIT_WORK_TREE would send this test's commits to the real repo;
  // the pinned config keeps a global commit.gpgsign or missing identity from failing them.
  const cleanEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_0: "commit.gpgsign",
    GIT_CONFIG_VALUE_0: "false",
    GIT_CONFIG_KEY_1: "user.email",
    GIT_CONFIG_VALUE_1: "test@test.com",
    GIT_CONFIG_KEY_2: "user.name",
    GIT_CONFIG_VALUE_2: "Test",
  }

  it("reports a submodule pointer bump whatever diff.ignoreSubmodules and .gitmodules ignore say", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-diffpaths-sm-")))
    try {
      const run = (cwd: string, ...args: string[]) =>
        execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe", env: cleanEnv }).trim()
      const source = join(root, "source")
      const repo = join(root, "super")
      mkdirSync(source)
      mkdirSync(repo)
      run(source, "init")
      writeFileSync(join(source, "f.txt"), "1")
      run(source, "add", "-A")
      run(source, "commit", "-m", "s1")
      run(repo, "init")
      run(repo, "config", "diff.ignoreSubmodules", "all")
      run(repo, "-c", "protocol.file.allow=always", "submodule", "add", source, "sub")
      run(repo, "config", "-f", ".gitmodules", "submodule.sub.ignore", "all")
      run(repo, "add", "-A")
      run(repo, "commit", "-m", "one")
      const base = run(repo, "rev-parse", "HEAD")
      const clone = join(repo, "sub")
      writeFileSync(join(clone, "f.txt"), "2")
      run(clone, "add", "-A")
      run(clone, "commit", "-m", "s2")
      run(repo, "add", "--force", "sub")
      run(repo, "commit", "-m", "two")
      const tip = run(repo, "rev-parse", "HEAD")
      const paths = await Effect.runPromise(
        Effect.flatMap(GitService, (g) => g.diffPaths(base, tip)).pipe(
          Effect.provide(GitService.Live),
          Effect.provide(Host.layer({ root: repo, home: root, env: {} })),
          Effect.provide(NodeContext.layer),
        ),
      )
      expect([...paths]).toEqual(["sub"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("authorIdent [Live]", () => {
  it("is none when git has no author identity", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-ident-")))
    try {
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" })
      git("init")
      git("config", "user.useConfigOnly", "true")
      git("config", "user.name", "")
      git("config", "user.email", "")
      const ident = await Effect.runPromise(
        Effect.flatMap(GitService, (g) => g.authorIdent()).pipe(
          Effect.provide(GitService.Live),
          Effect.provide(Host.layer({ root, home: root, env: {} })),
          Effect.provide(NodeContext.layer),
        ),
      )
      expect(Option.isNone(ident)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
