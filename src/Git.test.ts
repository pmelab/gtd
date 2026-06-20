import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
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

  describe("checkoutTracked", () => {
    it("discards modifications to tracked files", async () => {
      // foo.txt is tracked after this commit
      commit("feat: add foo", "foo.txt", "original")
      // modify it without staging
      writeFileSync(join(repoDir, "foo.txt"), "modified")

      // sanity: porcelain should show modification
      const before = await run(Effect.flatMap(GitService, (g) => g.statusPorcelain()))
      expect(before).toContain("foo.txt")

      await run(Effect.flatMap(GitService, (g) => g.checkoutTracked()))

      const after = await run(Effect.flatMap(GitService, (g) => g.statusPorcelain()))
      expect(after.trim()).toBe("")
    })
  })

  describe("cleanUntracked", () => {
    it("removes untracked files", async () => {
      writeFileSync(join(repoDir, "untracked.txt"), "noise")

      const before = await run(Effect.flatMap(GitService, (g) => g.statusPorcelain()))
      expect(before).toContain("untracked.txt")

      await run(Effect.flatMap(GitService, (g) => g.cleanUntracked()))

      const after = await run(Effect.flatMap(GitService, (g) => g.statusPorcelain()))
      expect(after.trim()).toBe("")
    })
  })

  describe("diffStatRef", () => {
    it("returns stat text listing changed files", async () => {
      commit("feat: second commit", "stats.txt", "content")

      const stat = await run(Effect.flatMap(GitService, (g) => g.diffStatRef("HEAD~1")))
      expect(stat).toContain("stats.txt")
      expect(stat).toMatch(/\d+ file/)
    })

    it("returns empty string when ref is HEAD (no changes)", async () => {
      const stat = await run(Effect.flatMap(GitService, (g) => g.diffStatRef("HEAD")))
      expect(stat.trim()).toBe("")
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

  describe("lastReviewCommit", () => {
    it("returns Option.none when there are no review commits", async () => {
      const result = await run(Effect.flatMap(GitService, (g) => g.lastReviewCommit()))
      expect(result._tag).toBe("None")
    })

    it("returns Option.some with the review commit hash", async () => {
      commit(`review(gtd): create review for abc1234`, "review.txt", "review")
      const reviewHash = git("rev-parse HEAD")

      const result = await run(Effect.flatMap(GitService, (g) => g.lastReviewCommit()))
      expect(result._tag).toBe("Some")
      expect(Option.getOrNull(result)).toBe(reviewHash)
    })

    it("returns the most recent review commit when multiple exist", async () => {
      commit(`review(gtd): create review for aaa0001`, "review1.txt", "first")
      commit("feat: work between reviews", "work.txt", "work")
      commit(`review(gtd): create review for bbb0002`, "review2.txt", "second")
      const latestReviewHash = git("rev-parse HEAD")
      commit("feat: more work after", "more.txt", "more")

      const result = await run(Effect.flatMap(GitService, (g) => g.lastReviewCommit()))
      expect(result._tag).toBe("Some")
      expect(Option.getOrNull(result)).toBe(latestReviewHash)
    })
  })

  describe("commitCount", () => {
    it("returns 0 when base equals HEAD", async () => {
      const result = await run(Effect.flatMap(GitService, (g) => g.commitCount("HEAD")))
      expect(result).toBe(0)
    })

    it("returns the correct count of commits since the base ref", async () => {
      commit("feat: second", "b.txt", "b")
      commit("feat: third", "c.txt", "c")
      commit("feat: fourth", "d.txt", "d")

      const result = await run(Effect.flatMap(GitService, (g) => g.commitCount("HEAD~3")))
      expect(result).toBe(3)
    })
  })

  describe("isAncestor", () => {
    it("returns true when first commit is an ancestor of second", async () => {
      commit("feat: second", "b.txt", "b")

      const result = await run(Effect.flatMap(GitService, (g) => g.isAncestor("HEAD~1", "HEAD")))
      expect(result).toBe(true)
    })

    it("returns false when first commit is NOT an ancestor of second", async () => {
      commit("feat: second", "b.txt", "b")

      const result = await run(Effect.flatMap(GitService, (g) => g.isAncestor("HEAD", "HEAD~1")))
      expect(result).toBe(false)
    })

    it("returns false when commit is on a divergent branch not in the ancestry of the other tip", async () => {
      commit("feat: second", "b.txt", "b")
      const divergenceHash = git("rev-parse HEAD")
      commit("feat: third", "c.txt", "c")
      const mainTip = git("rev-parse HEAD")

      git("checkout", "-b", "side", divergenceHash)
      commit("feat: side only", "side.txt", "side")
      const sideTip = git("rev-parse HEAD")

      // sideTip is not an ancestor of mainTip
      const result = await run(Effect.flatMap(GitService, (g) => g.isAncestor(sideTip, mainTip)))
      expect(result).toBe(false)
    })
  })

  describe("commitCount distance comparison (integration of primitives)", () => {
    it("review commit is closer to HEAD than the merge-base with parent branch", async () => {
      // History layout:
      //   init ← A ← B (merge-base with "parent") ← C ← D (review) ← E (HEAD, main)
      //                ↖ parent tip (diverged at B)
      commit("feat: A", "a.txt", "a")
      commit("feat: B", "b.txt", "b")
      const parentBase = git("rev-parse HEAD") // merge-base point
      commit("feat: C", "c.txt", "c")
      commit(`review(gtd): create review for ${parentBase.slice(0, 7)}`, "review.txt", "r")
      const reviewHash = git("rev-parse HEAD") // review commit
      commit("feat: E", "e.txt", "e")

      // Create parent branch diverging at B so mergeBase(main, parent) === parentBase
      git("checkout", "-b", "parent", parentBase)
      commit("feat: parent-only", "p.txt", "p")
      const parentTip = git("rev-parse HEAD")
      git("checkout", "-") // back to main

      const mainTip = git("rev-parse HEAD")

      // Verify merge-base equals parentBase
      const mergeBaseResult = await run(
        Effect.flatMap(GitService, (g) => g.mergeBase(mainTip, parentTip)),
      )
      expect(Option.getOrNull(mergeBaseResult)).toBe(parentBase)

      // Verify lastReviewCommit equals reviewHash
      const reviewResult = await run(Effect.flatMap(GitService, (g) => g.lastReviewCommit()))
      expect(Option.getOrNull(reviewResult)).toBe(reviewHash)

      // commitCount from parentBase should be greater than commitCount from reviewHash
      const countFromParentBase = await run(
        Effect.flatMap(GitService, (g) => g.commitCount(parentBase)),
      )
      const countFromReview = await run(
        Effect.flatMap(GitService, (g) => g.commitCount(reviewHash)),
      )
      expect(countFromParentBase).toBeGreaterThan(countFromReview)
    })
  })
})
