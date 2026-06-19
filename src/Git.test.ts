import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect } from "effect"
import { NodeContext } from "@effect/platform-node"
import { GitService } from "./Git.js"

const run = <A>(eff: Effect.Effect<A, Error, GitService>) =>
  Effect.runPromise(
    eff.pipe(
      Effect.provide(GitService.Live),
      Effect.provide(NodeContext.layer),
    ),
  )

const runEither = <A>(eff: Effect.Effect<A, Error, GitService>) =>
  Effect.runPromise(
    eff.pipe(
      Effect.provide(GitService.Live),
      Effect.provide(NodeContext.layer),
      Effect.either,
    ),
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
      const resolved = await run(
        Effect.flatMap(GitService, (g) => g.resolveRef("HEAD~1")),
      )
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
})
