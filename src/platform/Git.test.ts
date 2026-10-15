import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeContext } from "@effect/platform-node"
import { Cause, Effect, Exit } from "effect"
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
})
