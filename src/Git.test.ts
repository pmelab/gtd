import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect } from "effect"
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
        t.commit("gtd: test-failed", { "ERRORS.md": "some errors" })
        t.commitDeletion("ERRORS.md", "gtd: building")
        t.commit("feat: after", { "after.txt": "after" })

        const result = await t.run(Effect.flatMap(GitService, (g) => g.commitHistory()))
        // result[0] = init: first commit
        // result[1] = gtd: test-failed      (adds ERRORS.md, not a deletion)
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
  })
}
