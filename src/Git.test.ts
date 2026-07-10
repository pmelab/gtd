import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect, Option } from "effect"
import { NodeContext } from "@effect/platform-node"
import { GitService } from "./Git.js"
import { Cwd } from "./Cwd.js"
import { InMemRepo } from "../tests/integration/support/inmem/Repo.js"
import { makeGitServiceLayer } from "../tests/integration/support/inmem/layers.js"

// ---------------------------------------------------------------------------
// Live tier — shared setup/teardown
// ---------------------------------------------------------------------------

let repoDir: string

function gitExec(...args: string[]) {
  return execSync(`git ${args.join(" ")}`, { cwd: repoDir, encoding: "utf8", stdio: "pipe" }).trim()
}

function liveCommit(message: string, files: Record<string, string> = { "file.txt": message }) {
  for (const [path, content] of Object.entries(files)) {
    writeFileSync(join(repoDir, path), content)
  }
  gitExec("add", "-A")
  gitExec(`commit -m "${message}"`)
}

const runLive = <A>(eff: Effect.Effect<A, Error, GitService>, dir = repoDir): Promise<A> =>
  Effect.runPromise(
    eff.pipe(
      Effect.provide(GitService.Live),
      Effect.provide(Cwd.layer(dir)),
      Effect.provide(NodeContext.layer),
    ),
  )

const runLiveEither = <A>(eff: Effect.Effect<A, Error, GitService>, dir = repoDir) =>
  Effect.runPromise(
    eff.pipe(
      Effect.provide(GitService.Live),
      Effect.provide(Cwd.layer(dir)),
      Effect.provide(NodeContext.layer),
      Effect.either,
    ),
  )

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "gtd-git-test-"))
  gitExec("init")
  gitExec(`config user.email "test@test.com"`)
  gitExec(`config user.name "Test"`)
  liveCommit("init: first commit", { "readme.txt": "hello" })
})

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tier abstraction
// ---------------------------------------------------------------------------

/**
 * A Tier bundles all tier-specific operations for one parameterized run.
 * A fresh Tier is created per test via beforeEach.
 */
type Tier = {
  /** Run an Effect against this tier's GitService. */
  run: <A>(eff: Effect.Effect<A, Error, GitService>) => Promise<A>
  /** Run and wrap result in Either. */
  runEither: <A>(eff: Effect.Effect<A, Error, GitService>) => Promise<{ _tag: string }>
  /** Stage + commit files. */
  commit: (msg: string, files?: Record<string, string>) => void
  /** Write a file to the worktree (not staged/committed). */
  writeFile: (path: string, content: string) => void
  /** Delete a file from the worktree (not committed). */
  deleteFile: (path: string) => void
  /** Stage + commit a deletion (simulates `git rm` + commit). */
  commitDeletion: (path: string, msg: string) => void
  /** Get the porcelain status string. */
  statusPorcelain: () => string
  /** Resolve a ref to a 40-char hash. */
  resolveRef: (ref: string) => string
  /** Write a file, creating parent directories as needed. */
  writeFileDeep: (path: string, content: string) => void
  /** Stage all pending changes and commit. */
  stageAndCommit: (msg: string) => void
  /** Returns true if path (file or directory prefix) exists in the worktree. */
  existsPath: (path: string) => boolean
}

// ---------------------------------------------------------------------------
// Live tier factory
// ---------------------------------------------------------------------------

function makeLiveTier(): Tier {
  return {
    run: runLive,
    runEither: runLiveEither as <A>(
      eff: Effect.Effect<A, Error, GitService>,
    ) => Promise<{ _tag: string }>,
    commit: (msg, files = { "file.txt": msg }) => liveCommit(msg, files),
    writeFile: (path, content) => writeFileSync(join(repoDir, path), content),
    deleteFile: (path) => {
      gitExec("rm", path)
    },
    commitDeletion: (path, msg) => {
      gitExec("rm", path)
      gitExec(`commit -m "${msg}"`)
    },
    statusPorcelain: () => gitExec("status", "--porcelain"),
    resolveRef: (ref) => gitExec("rev-parse", ref),
    writeFileDeep: (path, content) => {
      const full = join(repoDir, path)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content)
    },
    stageAndCommit: (msg) => {
      gitExec("add", "-A")
      gitExec(`commit -m "${msg}"`)
    },
    existsPath: (path) => existsSync(join(repoDir, path)),
  }
}

// ---------------------------------------------------------------------------
// InMemory tier factory
// ---------------------------------------------------------------------------

function makeInMemTier(): Tier {
  const repo = new InMemRepo()
  // Replicate the initial commit that Live tier gets from the global beforeEach
  repo.writeFile("readme.txt", "hello")
  repo.commitAllWithPrefix("init: first commit")

  const layer = makeGitServiceLayer(repo)

  return {
    run: <A>(eff: Effect.Effect<A, Error, GitService>): Promise<A> =>
      Effect.runPromise(eff.pipe(Effect.provide(layer))),
    runEither: <A>(eff: Effect.Effect<A, Error, GitService>) =>
      Effect.runPromise(eff.pipe(Effect.provide(layer), Effect.either)) as Promise<{
        _tag: string
      }>,
    commit: (msg, files = { "file.txt": msg }) => {
      for (const [path, content] of Object.entries(files)) {
        repo.writeFile(path, content)
      }
      repo.commitAllWithPrefix(msg)
    },
    writeFile: (path, content) => repo.writeFile(path, content),
    deleteFile: (path) => repo.deleteFile(path),
    commitDeletion: (path, msg) => {
      repo.deleteFile(path)
      repo.commitAllWithPrefix(msg)
    },
    statusPorcelain: () => repo.statusPorcelain(),
    resolveRef: (ref) => {
      const hash = repo.resolveRef(ref)
      if (hash === null) throw new Error(`Cannot resolve ref: ${ref}`)
      return hash
    },
    writeFileDeep: (path, content) => repo.writeFile(path, content),
    stageAndCommit: (msg) => repo.commitAllWithPrefix(msg),
    existsPath: (path) => repo.worktreeHasPath(path),
  }
}

// ---------------------------------------------------------------------------
// Parameterized contract suite
// ---------------------------------------------------------------------------

const tiers: [string, () => Tier][] = [
  ["Live", makeLiveTier],
  ["InMemory", makeInMemTier],
]

for (const [tierName, makeTier] of tiers) {
  describe(`GitService [${tierName}]`, () => {
    let t: Tier

    beforeEach(() => {
      t = makeTier()
    })

    // -----------------------------------------------------------------------
    describe("diffPath", () => {
      it("returns the working-tree diff scoped to the given path", async () => {
        t.commit("feat: add target", { "target.txt": "original content" })
        t.writeFile("target.txt", "modified content")

        const diff = await t.run(Effect.flatMap(GitService, (g) => g.diffPath("target.txt")))

        expect(diff).toContain("target.txt")
        expect(diff).toContain("original content")
        expect(diff).toContain("modified content")
      })

      it("excludes changes to unrelated paths", async () => {
        t.commit("feat: add files", { "target.txt": "target content" })
        t.commit("feat: add other", { "other.txt": "other content" })
        t.writeFile("target.txt", "target modified")
        t.writeFile("other.txt", "other modified")

        const diff = await t.run(Effect.flatMap(GitService, (g) => g.diffPath("target.txt")))

        expect(diff).toContain("target.txt")
        expect(diff).not.toContain("other.txt")
      })

      it("returns empty string when the path is unchanged", async () => {
        t.commit("feat: add target", { "target.txt": "stable content" })

        const diff = await t.run(Effect.flatMap(GitService, (g) => g.diffPath("target.txt")))

        expect(diff.trim()).toBe("")
      })
    })

    // -----------------------------------------------------------------------
    describe("commitDiff", () => {
      it("returns the diff a commit introduced for a modified tracked file", async () => {
        t.commit("feat: add target", { "target.txt": "original content" })
        t.commit("feat: modify target", { "target.txt": "modified content" })
        const hash = t.resolveRef("HEAD")

        const diff = await t.run(Effect.flatMap(GitService, (g) => g.commitDiff(hash)))

        expect(diff).toContain("target.txt")
        expect(diff).toContain("-original content")
        expect(diff).toContain("+modified content")
      })

      it("renders the whole tree as additions for a root commit", async () => {
        // The tier's global beforeEach already created a root commit (readme.txt: "hello")
        const rootHash = t.resolveRef("HEAD")

        const diff = await t.run(Effect.flatMap(GitService, (g) => g.commitDiff(rootHash)))

        expect(diff).toContain("readme.txt")
        expect(diff).toContain("new file mode")
        expect(diff).toContain("+hello")
      })

      it("returns an empty string for an empty commit", async () => {
        if (tierName === "Live") {
          gitExec("commit", "--allow-empty", `-m "chore: empty commit"`)
        } else {
          // InMemory equivalent of --allow-empty: commit with no worktree changes
          t.stageAndCommit("chore: empty commit")
        }
        const hash = t.resolveRef("HEAD")

        const diff = await t.run(Effect.flatMap(GitService, (g) => g.commitDiff(hash)))

        expect(diff).toBe("")
      })

      it("excludes matching paths, keeping other files' hunks", async () => {
        t.writeFileDeep("TODO.md", "todo content")
        t.writeFileDeep("src/a.ts", "export const a = 1")
        t.stageAndCommit("feat: touch two files")
        const hash = t.resolveRef("HEAD")

        const diff = await t.run(Effect.flatMap(GitService, (g) => g.commitDiff(hash, ["TODO.md"])))

        expect(diff).not.toContain("TODO.md")
        expect(diff).toContain("src/a.ts")
        expect(diff).toContain("+export const a = 1")
      })

      it("fails for an unresolvable hash", async () => {
        const result = await t.runEither(
          Effect.flatMap(GitService, (g) => g.commitDiff("totally-invalid-hash-xyz")),
        )
        expect(result._tag).toBe("Left")
      })
    })

    // -----------------------------------------------------------------------
    describe("diffRef", () => {
      it("returns diff between ref and HEAD after a change", async () => {
        t.commit("feat: second commit", { "foo.txt": "foo content" })
        t.commit("feat: third commit", { "bar.txt": "bar content" })

        const diff = await t.run(Effect.flatMap(GitService, (g) => g.diffRef("HEAD~1")))

        expect(diff).toContain("bar.txt")
        expect(diff).not.toContain("foo.txt")
      })

      it("returns empty string when ref equals HEAD", async () => {
        const diff = await t.run(Effect.flatMap(GitService, (g) => g.diffRef("HEAD")))
        expect(diff.trim()).toBe("")
      })
    })

    // -----------------------------------------------------------------------
    describe("resolveRef", () => {
      it("resolves HEAD to a 40-char hash", async () => {
        const hash = await t.run(Effect.flatMap(GitService, (g) => g.resolveRef("HEAD")))
        expect(hash).toMatch(/^[0-9a-f]{40}$/)
      })

      it("resolves HEAD~1 when two commits exist", async () => {
        t.commit("feat: second commit", { "extra.txt": "extra" })
        const headHash = t.resolveRef("HEAD~1")
        const resolved = await t.run(Effect.flatMap(GitService, (g) => g.resolveRef("HEAD~1")))
        expect(resolved).toBe(headHash)
      })

      it("errors on invalid ref", async () => {
        const result = await t.runEither(
          Effect.flatMap(GitService, (g) => g.resolveRef("totally-invalid-ref-xyz")),
        )
        expect(result._tag).toBe("Left")
      })
    })

    // -----------------------------------------------------------------------
    describe("resolveDefaultBranch", () => {
      it("returns Option.some with the local branch name when on main", async () => {
        if (tierName === "Live") {
          // Force the branch to be named "main" so the assertion is deterministic
          gitExec("branch", "-M", "main")
        }
        // InMemory repo defaults to "main" branch

        const result = await t.run(Effect.flatMap(GitService, (g) => g.resolveDefaultBranch()))
        expect(result._tag).toBe("Some")
        expect(Option.getOrNull(result)).toBe("main")
      })
    })

    // -----------------------------------------------------------------------
    describe("mergeBase", () => {
      it("resolves to the shared ancestor on a linear history", async () => {
        t.commit("feat: second commit", { "b.txt": "b" })
        const ancestorHash = t.resolveRef("HEAD~1")

        const result = await t.run(Effect.flatMap(GitService, (g) => g.mergeBase("HEAD~1", "HEAD")))
        expect(result._tag).toBe("Some")
        expect(Option.getOrNull(result)).toBe(ancestorHash)
      })
    })

    // -----------------------------------------------------------------------
    describe("revertNoCommit", () => {
      it("stages the inverse of HEAD without creating a new commit", async () => {
        t.commit("feat: add file", { "target.txt": "hello world" })
        const headBefore = t.resolveRef("HEAD")

        await t.run(Effect.flatMap(GitService, (g) => g.revertNoCommit("HEAD")))

        // HEAD must not have changed
        expect(t.resolveRef("HEAD")).toBe(headBefore)
        // The deletion should be staged
        const status = t.statusPorcelain()
        expect(status).toContain("target.txt")
      })
    })

    // -----------------------------------------------------------------------
    describe("mixedResetHead", () => {
      it("undoes the last commit while keeping changes in the working tree", async () => {
        const headAfterInit = t.resolveRef("HEAD")
        t.commit("feat: second", { "b.txt": "beta" })

        await t.run(Effect.flatMap(GitService, (g) => g.mixedResetHead()))

        // HEAD is back to the commit before "feat: second"
        expect(t.resolveRef("HEAD")).toBe(headAfterInit)
        // b.txt still exists in the working tree (changes kept)
        const status = t.statusPorcelain()
        expect(status).toContain("b.txt")
      })
    })

    // -----------------------------------------------------------------------
    describe("lastDeletionOf", () => {
      it("returns Option.none when the file has never been deleted", async () => {
        t.commit("feat: add review", { "REVIEW.md": "# Review" })

        const result = await t.run(Effect.flatMap(GitService, (g) => g.lastDeletionOf("REVIEW.md")))
        expect(result._tag).toBe("None")
      })

      it("returns Option.some with the sha of the deleting commit", async () => {
        t.commit("feat: add review", { "REVIEW.md": "# Review" })
        t.commitDeletion("REVIEW.md", "chore: remove REVIEW.md")
        const deletionSha = t.resolveRef("HEAD")

        const result = await t.run(Effect.flatMap(GitService, (g) => g.lastDeletionOf("REVIEW.md")))
        expect(result._tag).toBe("Some")
        expect(Option.getOrNull(result)).toBe(deletionSha)
      })

      it("returns the most recent deletion when the file was deleted multiple times", async () => {
        // First add+delete cycle
        t.commit("feat: first add", { "REVIEW.md": "first" })
        t.commitDeletion("REVIEW.md", "chore: first delete")
        // Second add+delete cycle
        t.commit("feat: second add", { "REVIEW.md": "second" })
        t.commitDeletion("REVIEW.md", "chore: second delete")
        const latestDeletion = t.resolveRef("HEAD")
        // Commit after the deletion
        t.commit("feat: after", { "after.txt": "after" })

        const result = await t.run(Effect.flatMap(GitService, (g) => g.lastDeletionOf("REVIEW.md")))
        expect(result._tag).toBe("Some")
        expect(Option.getOrNull(result)).toBe(latestDeletion)
      })
    })

    // -----------------------------------------------------------------------
    describe("commitHistory", () => {
      it("returns [] for an empty repo", async () => {
        if (tierName === "Live") {
          const emptyDir = mkdtempSync(join(tmpdir(), "gtd-git-empty-history-"))
          try {
            execSync("git init", { cwd: emptyDir })
            const result = await runLive(
              Effect.flatMap(GitService, (g) => g.commitHistory()),
              emptyDir,
            )
            expect(result).toEqual([])
          } finally {
            rmSync(emptyDir, { recursive: true, force: true })
          }
        } else {
          const emptyRepo = new InMemRepo()
          const layer = makeGitServiceLayer(emptyRepo)
          const result = await Effect.runPromise(
            Effect.flatMap(GitService, (g) => g.commitHistory()).pipe(Effect.provide(layer)),
          )
          expect(result).toEqual([])
        }
      })

      it("returns all commits oldest to newest with their messages", async () => {
        t.commit("feat: second", { "b.txt": "b" })
        t.commit("feat: third", { "c.txt": "c" })

        const result = await t.run(Effect.flatMap(GitService, (g) => g.commitHistory()))
        expect(result.length).toBe(3)
        expect(result[0]?.message).toBe("init: first commit")
        expect(result[2]?.message).toBe("feat: third")
      })

      it("sets removedErrors=true only for the commit that deleted ERRORS.md", async () => {
        t.commit("gtd: errors", { "ERRORS.md": "some errors" })
        t.commitDeletion("ERRORS.md", "gtd: building")
        t.commit("feat: after", { "after.txt": "after" })

        const result = await t.run(Effect.flatMap(GitService, (g) => g.commitHistory()))
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
        t.commit("feat: second", { "b.txt": "b" })
        const base = t.resolveRef("HEAD")
        t.commit("feat: third", { "c.txt": "c" })

        const result = await t.run(Effect.flatMap(GitService, (g) => g.commitHistory(base)))
        expect(result.length).toBe(1)
        expect(result[0]?.message).toBe("feat: third")
        expect(result[0]?.removedErrors).toBe(false)
      })

      it("reports the paths each commit's name-status diff touched, without extra subprocesses", async () => {
        t.commit("feat: add two files", { "a.txt": "a", "b.txt": "b" })
        t.commitDeletion("a.txt", "chore: remove a")

        const result = await t.run(Effect.flatMap(GitService, (g) => g.commitHistory()))
        const addTwo = result.find((c) => c.message === "feat: add two files")
        const removeA = result.find((c) => c.message === "chore: remove a")

        expect(addTwo?.touched).toEqual(expect.arrayContaining(["a.txt", "b.txt"]))
        expect(removeA?.touched).toEqual(["a.txt"])
      })
    })

    // -----------------------------------------------------------------------
    describe("commitAllWithPrefix", () => {
      it("stages all pending changes and commits with the given prefix as the message", async () => {
        t.writeFile("new.ts", "export const x = 1")
        t.writeFile("TODO.md", "# Plan")
        const headBefore = t.resolveRef("HEAD")

        await t.run(Effect.flatMap(GitService, (g) => g.commitAllWithPrefix("gtd: building")))

        const headAfter = t.resolveRef("HEAD")
        expect(headAfter).not.toBe(headBefore)

        // Verify commit message via commitHistory
        const history = await t.run(Effect.flatMap(GitService, (g) => g.commitHistory()))
        expect(history[history.length - 1]?.message).toBe("gtd: building")

        // All files committed — working tree clean
        const status = t.statusPorcelain()
        expect(status.trim()).toBe("")
      }, 30_000)

      it("commits even on a clean tree (--allow-empty) so a fixed-prefix commit never throws", async () => {
        const headBefore = t.resolveRef("HEAD")

        await t.run(Effect.flatMap(GitService, (g) => g.commitAllWithPrefix("gtd: grilled")))

        const headAfter = t.resolveRef("HEAD")
        expect(headAfter).not.toBe(headBefore)

        const history = await t.run(Effect.flatMap(GitService, (g) => g.commitHistory()))
        expect(history[history.length - 1]?.message).toBe("gtd: grilled")
      })

      it("retries with --no-verify when a hook blocks the empty commit", async () => {
        if (tierName !== "Live") return

        // Simulate lint-staged blocking an empty commit
        const hookPath = join(repoDir, ".git/hooks/pre-commit")
        writeFileSync(
          hookPath,
          `#!/bin/sh\necho "lint-staged prevented an empty git commit." >&2\nexit 1\n`,
        )
        execSync(`chmod +x "${hookPath}"`)

        const headBefore = t.resolveRef("HEAD")

        await t.run(Effect.flatMap(GitService, (g) => g.commitAllWithPrefix("gtd: grilled")))

        const headAfter = t.resolveRef("HEAD")
        expect(headAfter).not.toBe(headBefore)

        const history = await t.run(Effect.flatMap(GitService, (g) => g.commitHistory()))
        expect(history[history.length - 1]?.message).toBe("gtd: grilled")
      })
    })

    // -----------------------------------------------------------------------
    describe("removePackageDir", () => {
      it("removes the package dir and keeps .gtd/ when other packages remain", async () => {
        t.writeFileDeep(".gtd/01-foo/task.md", "task content")
        t.writeFileDeep(".gtd/02-bar/task.md", "another task")
        t.stageAndCommit("chore: setup packages")

        await t.run(Effect.flatMap(GitService, (g) => g.removePackageDir(".gtd/01-foo")))

        const status = t.statusPorcelain()
        expect(status).toContain(".gtd/01-foo/task.md")
        // Filesystem / worktree assertions
        expect(t.existsPath(".gtd/01-foo")).toBe(false) // removed
        expect(t.existsPath(".gtd/02-bar")).toBe(true) // sibling survives
        expect(t.existsPath(".gtd")).toBe(true) // .gtd/ kept
      })

      it("removes .gtd/ itself when the last package is removed", async () => {
        t.writeFileDeep(".gtd/01-only/task.md", "task content")
        t.stageAndCommit("chore: setup one package")

        await t.run(Effect.flatMap(GitService, (g) => g.removePackageDir(".gtd/01-only")))

        // After removing the last package, .gtd/ should be gone from the index too
        const status = t.statusPorcelain()
        // The only task file should be staged for deletion
        expect(status).toContain(".gtd/01-only/task.md")
        // No .gtd/ entries should remain as staged-new
        expect(status).not.toMatch(/^A\s+\.gtd\//m)
        // Filesystem / worktree assertions
        expect(t.existsPath(".gtd/01-only")).toBe(false) // package gone
        expect(t.existsPath(".gtd")).toBe(false) // .gtd/ itself gone
      })

      it("is tolerant when the directory is already absent", async () => {
        await t.run(Effect.flatMap(GitService, (g) => g.removePackageDir(".gtd/01-nonexistent")))
      })
    })

    // -----------------------------------------------------------------------
    describe("resetHard", () => {
      it("removes staged-new files, restores tracked files, keeps pure-untracked", async () => {
        // Establish HEAD with a tracked file
        t.commit("feat: add tracked", { "tracked.txt": "original" })
        const headHash = t.resolveRef("HEAD")

        // Stage a new file:
        // - Live: write + git add
        // - InMemory: commit then softResetTo to move HEAD back (leaves file in index as "A ")
        t.writeFile("staged-new.txt", "staged content")
        if (tierName === "Live") {
          gitExec("add", "staged-new.txt")
        } else {
          t.stageAndCommit("temp: stage staged-new")
          await t.run(Effect.flatMap(GitService, (g) => g.softResetTo(headHash)))
        }

        // Corrupt tracked.txt in the worktree (will be restored by resetHard)
        t.writeFile("tracked.txt", "corrupted")

        // Leave a pure-untracked file (never staged — survives resetHard)
        t.writeFile("pure-untracked.txt", "untracked content")

        await t.run(Effect.flatMap(GitService, (g) => g.resetHard()))

        const status = t.statusPorcelain()
        // tracked.txt is restored to HEAD content → no longer dirty
        // Match the exact filename (not as a suffix of "pure-untracked.txt")
        expect(status).not.toMatch(/ tracked\.txt/)
        // staged-new.txt was in the index but not HEAD → removed by resetHard
        expect(status).not.toContain("staged-new.txt")
        // pure-untracked.txt was never in HEAD or index → survives
        expect(status).toContain("pure-untracked.txt")
      })
    })

    // -----------------------------------------------------------------------
    describe("softResetTo", () => {
      it("moves HEAD back but keeps worktree changes from second commit", async () => {
        const firstHash = t.resolveRef("HEAD")
        t.commit("feat: second", { "second.txt": "second content" })

        await t.run(Effect.flatMap(GitService, (g) => g.softResetTo(firstHash)))

        // HEAD is now the first commit
        expect(t.resolveRef("HEAD")).toBe(firstHash)

        // second.txt still shows as a change (staged-new or untracked depending on tier)
        const status = t.statusPorcelain()
        expect(status).toContain("second.txt")
      })
    })

    // -----------------------------------------------------------------------
    describe("mixedResetHead on root commit", () => {
      it("fails with an error when HEAD is the root commit", async () => {
        // Create a fresh repo with only one commit
        if (tierName === "Live") {
          const emptyDir = mkdtempSync(join(tmpdir(), "gtd-git-root-"))
          try {
            execSync("git init", { cwd: emptyDir })
            execSync(`git config user.email "test@test.com"`, { cwd: emptyDir })
            execSync(`git config user.name "Test"`, { cwd: emptyDir })
            writeFileSync(join(emptyDir, "init.txt"), "init")
            execSync("git add -A", { cwd: emptyDir })
            execSync(`git commit -m "init"`, { cwd: emptyDir })
            const result = await runLiveEither(
              Effect.flatMap(GitService, (g) => g.mixedResetHead()),
              emptyDir,
            )
            expect(result._tag).toBe("Left")
          } finally {
            rmSync(emptyDir, { recursive: true, force: true })
          }
        } else {
          const singleCommitRepo = new InMemRepo()
          singleCommitRepo.writeFile("init.txt", "init")
          singleCommitRepo.commitAllWithPrefix("init")
          const layer = makeGitServiceLayer(singleCommitRepo)
          const result = await Effect.runPromise(
            Effect.flatMap(GitService, (g) => g.mixedResetHead()).pipe(
              Effect.provide(layer),
              Effect.either,
            ),
          )
          expect(result._tag).toBe("Left")
        }
      })
    })

    // -----------------------------------------------------------------------
    describe("hasCommits", () => {
      it("returns false in an empty repo", async () => {
        if (tierName === "Live") {
          const emptyDir = mkdtempSync(join(tmpdir(), "gtd-git-empty-hascommits-"))
          try {
            execSync("git init", { cwd: emptyDir })
            const result = await runLive(
              Effect.flatMap(GitService, (g) => g.hasCommits()),
              emptyDir,
            )
            expect(result).toBe(false)
          } finally {
            rmSync(emptyDir, { recursive: true, force: true })
          }
        } else {
          const emptyRepo = new InMemRepo()
          const layer = makeGitServiceLayer(emptyRepo)
          const result = await Effect.runPromise(
            Effect.flatMap(GitService, (g) => g.hasCommits()).pipe(Effect.provide(layer)),
          )
          expect(result).toBe(false)
        }
      })
    })

    // -----------------------------------------------------------------------
    describe("statusPorcelain XY codes", () => {
      it("produces exact two-column XY codes for staged-new, modified-worktree, and untracked", async () => {
        // staged-new: write and stage a new file
        t.writeFile("staged.txt", "staged content")
        if (tierName === "Live") {
          gitExec("add", "staged.txt")
        } else {
          // InMemory: put staged.txt into the index without committing
          // Commit then soft reset to HEAD~0 isn't helpful. Instead: commit then
          // use softResetTo to move HEAD back, leaving index unchanged.
          // But softResetTo only moves HEAD. We need index = has staged.txt, HEAD = does not.
          // Simplest: commit staged.txt, then softReset to previous HEAD.
          const prevHead = t.resolveRef("HEAD")
          t.stageAndCommit("temp: stage staged.txt")
          // Now reset HEAD back, leaving index with staged.txt
          // We need direct repo access — use the tier's run to call softResetTo
          // But this would stage it as D (deletion from HEAD) not A.
          // Actually: after softResetTo, HEAD doesn't have staged.txt, index does → XY = "A "
          // That's correct for "staged-new".
          await t.run(Effect.flatMap(GitService, (g) => g.softResetTo(prevHead)))
        }

        // modified-worktree: modify readme.txt (in HEAD) without staging
        t.writeFile("readme.txt", "modified content")

        // untracked: write a file without staging
        t.writeFile("untracked.txt", "untracked content")

        const status = await t.run(Effect.flatMap(GitService, (g) => g.statusPorcelain()))

        // staged-new → "A "
        expect(status).toMatch(/^A\s+staged\.txt/m)
        // modified-worktree → " M"
        expect(status).toMatch(/^ M\s+readme\.txt/m)
        // untracked → "??"
        expect(status).toMatch(/^\?\?\s+untracked\.txt/m)
      })
    })
  })
}

// ---------------------------------------------------------------------------
// Live-only tests (real filesystem, branch manipulation)
// ---------------------------------------------------------------------------

// Note: resolveDefaultBranch "returns Option.none when no discernible default branch" requires
// detached HEAD or a branch not named "main"/"master" with no remote origin/HEAD.
// Wiring that up is heavy; the local-branch path covers the primary use case.
// The remote-HEAD fallback is left as a manual test.

describe("GitService [Live only]", () => {
  describe("mergeBase", () => {
    it("resolves to the divergence point on a branching history", async () => {
      // History: init ← second ← third (main)
      //                  ↖ side
      liveCommit("feat: second commit", { "b.txt": "b" })
      const divergenceHash = gitExec("rev-parse HEAD")
      liveCommit("feat: third commit", { "c.txt": "c" })

      // Create a divergent branch from the second commit
      gitExec("checkout", "-b", "side", divergenceHash)
      liveCommit("feat: side commit", { "side.txt": "side" })
      const sideTip = gitExec("rev-parse HEAD")

      // Switch back to main tip
      gitExec("checkout", "-")
      const mainTip = gitExec("rev-parse HEAD")

      const result = await runLive(Effect.flatMap(GitService, (g) => g.mergeBase(mainTip, sideTip)))
      expect(result._tag).toBe("Some")
      expect(Option.getOrNull(result)).toBe(divergenceHash)
    })
  })

  describe("removeGtdDir", () => {
    it("deletes a populated .gtd/ directory", async () => {
      mkdirSync(join(repoDir, ".gtd"))
      writeFileSync(join(repoDir, ".gtd", "task.md"), "some task content")
      expect(existsSync(join(repoDir, ".gtd"))).toBe(true)

      await runLive(Effect.flatMap(GitService, (g) => g.removeGtdDir()))

      expect(existsSync(join(repoDir, ".gtd"))).toBe(false)
    })

    it("succeeds idempotently when .gtd/ is absent", async () => {
      expect(existsSync(join(repoDir, ".gtd"))).toBe(false)

      await runLive(Effect.flatMap(GitService, (g) => g.removeGtdDir()))

      expect(existsSync(join(repoDir, ".gtd"))).toBe(false)
    })
  })
})
