import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect } from "effect"
import { NodeContext } from "@effect/platform-node"
import { GitService, isIndexLockError, withIndexLockRetry } from "./Git.js"
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
    describe("changedPathsSince", () => {
      it("returns the paths changed since ref, with their status, excluding paths before it", async () => {
        t.commit("feat: second commit", { "foo.txt": "foo content" })
        t.commit("feat: third commit", { "bar.txt": "bar content" })

        const changed = await t.run(
          Effect.flatMap(GitService, (g) => g.changedPathsSince("HEAD~1")),
        )

        expect(changed).toEqual([{ path: "bar.txt", status: "A" }])
      })

      it("reports an added, a modified, and a deleted path across the range", async () => {
        t.commit("chore: add other.txt", { "other.txt": "will be removed" })
        const base = t.resolveRef("HEAD")
        t.commit("feat: modify readme, add new.txt", { "readme.txt": "changed", "new.txt": "new" })
        t.deleteFile("other.txt")
        t.stageAndCommit("chore: remove other.txt")

        const changed = await t.run(Effect.flatMap(GitService, (g) => g.changedPathsSince(base)))

        expect([...changed].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
          { path: "new.txt", status: "A" },
          { path: "other.txt", status: "D" },
          { path: "readme.txt", status: "M" },
        ])
      })

      it("returns [] when ref equals HEAD", async () => {
        const changed = await t.run(Effect.flatMap(GitService, (g) => g.changedPathsSince("HEAD")))
        expect(changed).toEqual([])
      })

      it("fails for an unreachable ref", async () => {
        const result = await t.runEither(
          Effect.flatMap(GitService, (g) => g.changedPathsSince("totally-invalid-ref-xyz")),
        )
        expect(result._tag).toBe("Left")
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
    describe("lastCommitSubject", () => {
      it("returns HEAD's subject with no ref argument", async () => {
        const subject = await t.run(Effect.flatMap(GitService, (g) => g.lastCommitSubject()))
        expect(subject).toBe("init: first commit")
      })

      it("returns the given ref's subject, not HEAD's", async () => {
        t.commit("feat: second commit", { "extra.txt": "extra" })
        const subject = await t.run(
          Effect.flatMap(GitService, (g) => g.lastCommitSubject("HEAD~1")),
        )
        expect(subject).toBe("init: first commit")
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
    describe("hardResetTo", () => {
      it("moves HEAD, index, and working tree content back to the target ref", async () => {
        const firstHash = t.resolveRef("HEAD")
        t.commit("feat: second", { "readme.txt": "modified content" })

        await t.run(Effect.flatMap(GitService, (g) => g.hardResetTo(firstHash)))

        // HEAD is back at the first commit
        expect(t.resolveRef("HEAD")).toBe(firstHash)

        // index and working tree are both clean against the target ref — no
        // pending changes at all (unlike softResetTo/mixedResetTo, which would
        // surface readme.txt as a change)
        expect(t.statusPorcelain()).toBe("")

        // Live only: the working tree content itself reverted on disk to what
        // it was at firstHash — this is what distinguishes a hard reset from
        // softResetTo (worktree AND index untouched) and mixedResetTo
        // (worktree untouched); a clean `status --porcelain` alone wouldn't
        // catch a reset that moved HEAD/index but left stale file content on
        // disk with matching mtimes.
        if (tierName === "Live") {
          expect(readFileSync(join(repoDir, "readme.txt"), "utf8")).toBe("hello")
        }
      })
    })

    // -----------------------------------------------------------------------
    describe("lastCommitMessage", () => {
      it("returns the full commit message (subject + body) of HEAD", async () => {
        t.commit("feat: add thing\n\nA body explaining why.")

        const message = await t.run(Effect.flatMap(GitService, (g) => g.lastCommitMessage()))

        expect(message).toBe("feat: add thing\n\nA body explaining why.")
      })

      it("returns just the subject when HEAD carries no body", async () => {
        t.commit("feat: subject only")

        const message = await t.run(Effect.flatMap(GitService, (g) => g.lastCommitMessage()))

        expect(message).toBe("feat: subject only")
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

// ---------------------------------------------------------------------------
// index.lock contention retry — the review window shares one worktree index
// with the reviewer's editor/lsp/prompt, all of which write the index to
// refresh their stat cache when a `git reset --mixed` wakes them. gtd's own
// index writes must ride out the resulting `index.lock` race, not fail on it.
// ---------------------------------------------------------------------------

describe("index.lock retry", () => {
  it("recognizes git's index.lock contention message and nothing else", () => {
    expect(
      isIndexLockError(
        new Error(
          "git add -A failed (exit 128): fatal: Unable to create " +
            "'/repo/.git/index.lock': File exists.\n\nAnother git process seems to be running",
        ),
      ),
    ).toBe(true)
    // A different non-zero exit (a rejected commit, a missing ref) must NOT retry.
    expect(isIndexLockError(new Error("git commit failed (exit 1): nothing to commit"))).toBe(false)
  })

  it("retries a transient lock error to success, but propagates any other failure at once", async () => {
    let lockAttempts = 0
    await expect(
      Effect.runPromise(
        withIndexLockRetry(
          Effect.suspend(() => {
            lockAttempts += 1
            return lockAttempts < 3
              ? Effect.fail(new Error("Unable to create 'index.lock': File exists"))
              : Effect.succeed("ok")
          }),
        ),
      ),
    ).resolves.toBe("ok")
    expect(lockAttempts).toBe(3)

    let otherAttempts = 0
    const res = await Effect.runPromise(
      Effect.either(
        withIndexLockRetry(
          Effect.suspend(() => {
            otherAttempts += 1
            return Effect.fail(new Error("nothing to commit"))
          }),
        ),
      ),
    )
    expect(res._tag).toBe("Left")
    expect(otherAttempts).toBe(1)
  })

  it("a real index-writing command survives a lock that clears mid-flight", async () => {
    const lock = join(repoDir, ".git", "index.lock")
    writeFileSync(lock, "")
    // Release the lock 50ms in — after the first attempt fails, well within the
    // jittered backoff budget (~315ms+ before the 6 retries exhaust). Without
    // the retry, `git add -A` fails on its first, immediate attempt.
    const timer = setTimeout(() => {
      try {
        rmSync(lock)
      } catch {
        // already removed
      }
    }, 50)
    try {
      writeFileSync(join(repoDir, "new.txt"), "content")
      await runLive(Effect.flatMap(GitService, (g) => g.commitAllWithPrefix("gtd(test): capture")))
    } finally {
      clearTimeout(timer)
    }
    expect(existsSync(lock)).toBe(false)
    expect(gitExec("log", "-1", "--pretty=%s")).toBe("gtd(test): capture")
  })
})
