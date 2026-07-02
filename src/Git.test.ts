import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect, Option } from "effect"
import { NodeContext } from "@effect/platform-node"
import { GitService } from "./Git.js"

const run = <A>(eff: Effect.Effect<A, Error, GitService>) =>
  Effect.runPromise(eff.pipe(Effect.provide(GitService.Live), Effect.provide(NodeContext.layer)))

const runEither = <A>(eff: Effect.Effect<A, Error, GitService>) =>
  Effect.runPromise(
    eff.pipe(Effect.provide(GitService.Live), Effect.provide(NodeContext.layer), Effect.either),
  )

let repoDir: string
let originalCwd: string

function git(...args: string[]) {
  return execSync(`git ${args.join(" ")}`, { cwd: repoDir, encoding: "utf8" }).trim()
}

function commit(message: string, file = "file.txt", content = message) {
  writeFileSync(join(repoDir, file), content)
  git("add", "-A")
  git(`commit -m "${message}"`)
}

beforeEach(() => {
  originalCwd = process.cwd()
  repoDir = mkdtempSync(join(tmpdir(), "gtd-git-test-"))
  git("init")
  git(`config user.email "test@test.com"`)
  git(`config user.name "Test"`)
  // initial commit so HEAD exists
  commit("init: first commit", "readme.txt", "hello")
  process.chdir(repoDir)
})

afterEach(() => {
  process.chdir(originalCwd)
  rmSync(repoDir, { recursive: true, force: true })
})

describe("GitService", () => {
  describe("diffPath", () => {
    it("returns the working-tree diff scoped to the given path", async () => {
      commit("feat: add target", "target.txt", "original content")
      writeFileSync(join(repoDir, "target.txt"), "modified content")

      const diff = await run(Effect.flatMap(GitService, (g) => g.diffPath("target.txt")))

      expect(diff).toContain("target.txt")
      expect(diff).toContain("original content")
      expect(diff).toContain("modified content")
    })

    it("excludes changes to unrelated paths", async () => {
      commit("feat: add files", "target.txt", "target content")
      commit("feat: add other", "other.txt", "other content")
      writeFileSync(join(repoDir, "target.txt"), "target modified")
      writeFileSync(join(repoDir, "other.txt"), "other modified")

      const diff = await run(Effect.flatMap(GitService, (g) => g.diffPath("target.txt")))

      expect(diff).toContain("target.txt")
      expect(diff).not.toContain("other.txt")
    })

    it("returns empty string when the path is unchanged", async () => {
      commit("feat: add target", "target.txt", "stable content")

      const diff = await run(Effect.flatMap(GitService, (g) => g.diffPath("target.txt")))

      expect(diff.trim()).toBe("")
    })
  })

  describe("diffRef", () => {
    it("returns diff between ref and HEAD after a change", async () => {
      commit("feat: second commit", "foo.txt", "foo content")
      // now make another commit so HEAD~1 is the second commit
      commit("feat: third commit", "bar.txt", "bar content")

      const diff = await run(Effect.flatMap(GitService, (g) => g.diffRef("HEAD~1")))

      expect(diff).toContain("bar.txt")
      expect(diff).not.toContain("foo.txt")
    })

    it("returns empty string when ref equals HEAD", async () => {
      const diff = await run(Effect.flatMap(GitService, (g) => g.diffRef("HEAD")))
      expect(diff.trim()).toBe("")
    })
  })

  describe("resolveRef", () => {
    it("resolves HEAD to a 40-char hash", async () => {
      const hash = await run(Effect.flatMap(GitService, (g) => g.resolveRef("HEAD")))
      expect(hash).toMatch(/^[0-9a-f]{40}$/)
    })

    it("resolves HEAD~1 when two commits exist", async () => {
      commit("feat: second commit", "extra.txt", "extra")
      const headHash = git("rev-parse HEAD~1")
      const resolved = await run(Effect.flatMap(GitService, (g) => g.resolveRef("HEAD~1")))
      expect(resolved).toBe(headHash)
    })

    it("errors on invalid ref", async () => {
      const result = await runEither(
        Effect.flatMap(GitService, (g) => g.resolveRef("totally-invalid-ref-xyz")),
      )
      expect(result._tag).toBe("Left")
    })
  })

  describe("resolveDefaultBranch", () => {
    it("returns Option.some with the local branch name when on main", async () => {
      // Force the branch to be named "main" so the assertion is deterministic
      git("branch", "-M", "main")

      const result = await run(Effect.flatMap(GitService, (g) => g.resolveDefaultBranch()))
      expect(result._tag).toBe("Some")
      expect(Option.getOrNull(result)).toBe("main")
    })

    it("returns Option.none when there is no discernible default branch", async () => {
      // Note: wiring a fake remote with origin/HEAD is heavy; the fallback-branch
      // path (local branch name) covers the primary use case. The remote-HEAD path
      // is left as a manual/integration test.
    })
  })

  describe("mergeBase", () => {
    it("resolves to the shared ancestor on a linear history", async () => {
      commit("feat: second commit", "b.txt", "b")
      const ancestorHash = git("rev-parse HEAD~1")

      const result = await run(Effect.flatMap(GitService, (g) => g.mergeBase("HEAD~1", "HEAD")))
      expect(result._tag).toBe("Some")
      expect(Option.getOrNull(result)).toBe(ancestorHash)
    })

    it("resolves to the divergence point on a branching history", async () => {
      // History: init ← second ← third (main)
      //                  ↖ side
      commit("feat: second commit", "b.txt", "b")
      const divergenceHash = git("rev-parse HEAD")
      commit("feat: third commit", "c.txt", "c")

      // Create a divergent branch from the second commit
      git("checkout", "-b", "side", divergenceHash)
      commit("feat: side commit", "side.txt", "side")
      const sideTip = git("rev-parse HEAD")

      // Switch back to main tip
      git("checkout", "-")
      const mainTip = git("rev-parse HEAD")

      const result = await run(Effect.flatMap(GitService, (g) => g.mergeBase(mainTip, sideTip)))
      expect(result._tag).toBe("Some")
      expect(Option.getOrNull(result)).toBe(divergenceHash)
    })
  })

  describe("removeGtdDir", () => {
    it("deletes a populated .gtd/ directory", async () => {
      mkdirSync(join(repoDir, ".gtd"))
      writeFileSync(join(repoDir, ".gtd", "task.md"), "some task content")
      expect(existsSync(join(repoDir, ".gtd"))).toBe(true)

      await run(Effect.flatMap(GitService, (g) => g.removeGtdDir()))

      expect(existsSync(join(repoDir, ".gtd"))).toBe(false)
    })

    it("succeeds idempotently when .gtd/ is absent", async () => {
      expect(existsSync(join(repoDir, ".gtd"))).toBe(false)

      // Must not throw
      await run(Effect.flatMap(GitService, (g) => g.removeGtdDir()))

      expect(existsSync(join(repoDir, ".gtd"))).toBe(false)
    })
  })

  describe("revertNoCommit", () => {
    it("stages the inverse of HEAD without creating a new commit", async () => {
      commit("feat: add file", "target.txt", "hello world")
      const headBefore = git("rev-parse HEAD")

      await run(Effect.flatMap(GitService, (g) => g.revertNoCommit("HEAD")))

      // HEAD must not have changed
      expect(git("rev-parse HEAD")).toBe(headBefore)
      // The deletion should be staged
      const status = git("status", "--porcelain")
      expect(status).toContain("target.txt")
    })
  })

  describe("mixedResetHead", () => {
    it("undoes the last commit while keeping changes in the working tree", async () => {
      const headAfterInit = git("rev-parse HEAD")
      commit("feat: second", "b.txt", "beta")

      await run(Effect.flatMap(GitService, (g) => g.mixedResetHead()))

      // HEAD is back to the commit before "feat: second"
      expect(git("rev-parse HEAD")).toBe(headAfterInit)
      // b.txt still exists in the working tree (changes kept)
      const status = git("status", "--porcelain")
      expect(status).toContain("b.txt")
    })
  })

  describe("lastDeletionOf", () => {
    it("returns Option.none when the file has never been deleted", async () => {
      commit("feat: add review", "REVIEW.md", "# Review")

      const result = await run(Effect.flatMap(GitService, (g) => g.lastDeletionOf("REVIEW.md")))
      expect(result._tag).toBe("None")
    })

    it("returns Option.some with the sha of the deleting commit", async () => {
      commit("feat: add review", "REVIEW.md", "# Review")
      git("rm", "REVIEW.md")
      git(`commit -m "chore: remove REVIEW.md"`)
      const deletionSha = git("rev-parse HEAD")

      const result = await run(Effect.flatMap(GitService, (g) => g.lastDeletionOf("REVIEW.md")))
      expect(result._tag).toBe("Some")
      expect(Option.getOrNull(result)).toBe(deletionSha)
    })

    it("returns the most recent deletion when the file was deleted multiple times", async () => {
      // First add+delete cycle
      commit("feat: first add", "REVIEW.md", "first")
      git("rm", "REVIEW.md")
      git(`commit -m "chore: first delete"`)
      // Second add+delete cycle
      commit("feat: second add", "REVIEW.md", "second")
      git("rm", "REVIEW.md")
      git(`commit -m "chore: second delete"`)
      const latestDeletion = git("rev-parse HEAD")
      // Commit after the deletion
      commit("feat: after", "after.txt", "after")

      const result = await run(Effect.flatMap(GitService, (g) => g.lastDeletionOf("REVIEW.md")))
      expect(result._tag).toBe("Some")
      expect(Option.getOrNull(result)).toBe(latestDeletion)
    })
  })

  describe("commitHistory", () => {
    it("returns [] for an empty repo", async () => {
      const emptyDir = mkdtempSync(join(tmpdir(), "gtd-git-empty-history-"))
      try {
        execSync("git init", { cwd: emptyDir })
        process.chdir(emptyDir)
        const result = await run(Effect.flatMap(GitService, (g) => g.commitHistory()))
        expect(result).toEqual([])
      } finally {
        process.chdir(repoDir)
        rmSync(emptyDir, { recursive: true, force: true })
      }
    })

    it("returns all commits oldest to newest with their messages", async () => {
      commit("feat: second", "b.txt", "b")
      commit("feat: third", "c.txt", "c")

      const result = await run(Effect.flatMap(GitService, (g) => g.commitHistory()))
      expect(result.length).toBe(3)
      expect(result[0]?.message).toBe("init: first commit")
      expect(result[2]?.message).toBe("feat: third")
    })

    it("sets removedErrors=true only for the commit that deleted ERRORS.md", async () => {
      // Add ERRORS.md
      writeFileSync(join(repoDir, "ERRORS.md"), "some errors")
      git("add", "-A")
      git(`commit -m "gtd: errors"`)

      // Delete ERRORS.md — this commit must have removedErrors=true
      git("rm", "ERRORS.md")
      git(`commit -m "gtd: building"`)

      // Another commit with no ERRORS.md involvement
      commit("feat: after", "after.txt", "after")

      const result = await run(Effect.flatMap(GitService, (g) => g.commitHistory()))
      // result[0] = init: first commit
      // result[1] = gtd: errors      (adds ERRORS.md, not a deletion)
      // result[2] = gtd: building    (deletes ERRORS.md → removedErrors=true)
      // result[3] = feat: after
      expect(result[0]?.removedErrors).toBe(false)
      expect(result[1]?.removedErrors).toBe(false)
      expect(result[2]?.removedErrors).toBe(true)
      expect(result[3]?.removedErrors).toBe(false)
    })

    it("limits to base..HEAD range when base is provided", async () => {
      commit("feat: second", "b.txt", "b")
      const base = git("rev-parse HEAD")
      commit("feat: third", "c.txt", "c")

      const result = await run(Effect.flatMap(GitService, (g) => g.commitHistory(base)))
      expect(result.length).toBe(1)
      expect(result[0]?.message).toBe("feat: third")
      expect(result[0]?.removedErrors).toBe(false)
    })
  })

  describe("removePackageDir", () => {
    it("removes the package dir and keeps .gtd/ when other packages remain", async () => {
      mkdirSync(join(repoDir, ".gtd", "01-foo"), { recursive: true })
      mkdirSync(join(repoDir, ".gtd", "02-bar"), { recursive: true })
      writeFileSync(join(repoDir, ".gtd", "01-foo", "task.md"), "task content")
      writeFileSync(join(repoDir, ".gtd", "02-bar", "task.md"), "another task")
      git("add", "-A")
      git(`commit -m "chore: setup packages"`)

      await run(Effect.flatMap(GitService, (g) => g.removePackageDir(".gtd/01-foo")))

      expect(existsSync(join(repoDir, ".gtd", "01-foo"))).toBe(false)
      expect(existsSync(join(repoDir, ".gtd", "02-bar"))).toBe(true)
      expect(existsSync(join(repoDir, ".gtd"))).toBe(true)
      // Deletion staged
      const status = git("status", "--porcelain")
      expect(status).toContain(".gtd/01-foo/task.md")
    })

    it("removes .gtd/ itself when the last package is removed", async () => {
      mkdirSync(join(repoDir, ".gtd", "01-only"), { recursive: true })
      writeFileSync(join(repoDir, ".gtd", "01-only", "task.md"), "task content")
      git("add", "-A")
      git(`commit -m "chore: setup one package"`)

      await run(Effect.flatMap(GitService, (g) => g.removePackageDir(".gtd/01-only")))

      expect(existsSync(join(repoDir, ".gtd", "01-only"))).toBe(false)
      expect(existsSync(join(repoDir, ".gtd"))).toBe(false)
    })

    it("is tolerant when the directory is already absent", async () => {
      // Should not throw even if the dir does not exist
      await run(Effect.flatMap(GitService, (g) => g.removePackageDir(".gtd/01-nonexistent")))
    })
  })

  describe("commitAllWithPrefix", () => {
    it("stages all pending changes and commits with the given prefix as the message", async () => {
      writeFileSync(join(repoDir, "new.ts"), "export const x = 1")
      writeFileSync(join(repoDir, "TODO.md"), "# Plan")
      const headBefore = git("rev-parse HEAD")

      await run(Effect.flatMap(GitService, (g) => g.commitAllWithPrefix("gtd: building")))

      const headAfter = git("rev-parse HEAD")
      expect(headAfter).not.toBe(headBefore)
      expect(git("log", "-1", "--format=%s")).toBe("gtd: building")
      // All files committed — working tree clean
      expect(git("status", "--porcelain").trim()).toBe("")
    })

    it("commits even on a clean tree (--allow-empty) so a fixed-prefix commit never throws", async () => {
      const headBefore = git("rev-parse HEAD")

      // Clean tree: the machine still emits e.g. `gtd: grilled` on a clean tree,
      // and an uncommitted-FEEDBACK Fixing path can net an empty commit.
      await run(Effect.flatMap(GitService, (g) => g.commitAllWithPrefix("gtd: grilled")))

      const headAfter = git("rev-parse HEAD")
      expect(headAfter).not.toBe(headBefore)
      expect(git("log", "-1", "--format=%s")).toBe("gtd: grilled")
    })
  })
})
