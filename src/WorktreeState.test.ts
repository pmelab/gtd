/**
 * Coverage for `src/WorktreeState.ts`'s `worktreeGitDir`/`loopLogPath`: an
 * in-memory group pinning the `.git` resolution table (D1's own words in
 * gtd#169), and a real-git group proving the resolver is byte-identical to
 * `git rev-parse --git-dir` — including under a `GIT_DIR`/`GIT_WORK_TREE`
 * pointed at an unrelated repo, the env-immunity property `bin/gtd`'s old
 * `env -u` scrub existed to provide.
 */

import { join } from "node:path"
import { mkdtempSync, realpathSync } from "node:fs"
import { execSync } from "node:child_process"
import { tmpdir } from "node:os"
import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "vitest"
import { loopLogPath, worktreeGitDir } from "./WorktreeState.js"
import { Cwd } from "./Cwd.js"
import { EnvVars } from "./EnvVars.js"
import { InMemRepo } from "./testing/InMemRepo.js"
import { testLayers } from "./testing/Layers.js"

const provide = <A>(
  eff: Effect.Effect<A, never, Cwd | EnvVars | FileSystem.FileSystem>,
  repo: InMemRepo,
  opts: {
    readonly root?: string
    readonly env?: Readonly<Record<string, string | undefined>>
  } = {},
): Promise<A> => Effect.runPromise(eff.pipe(Effect.provide(testLayers(repo, opts))))

describe("worktreeGitDir / loopLogPath [in-memory]", () => {
  it("falls back to .git when the worktree has no .git entry at all", async () => {
    const repo = new InMemRepo()
    expect(await provide(worktreeGitDir, repo)).toBe(".git")
    expect(await provide(loopLogPath, repo)).toBe(".git/gtd-loop.log")
  })

  it("follows an absolute gitdir: pointer (a linked worktree)", async () => {
    const repo = new InMemRepo()
    repo.writeFile(join("/repo", ".git"), "gitdir: /abs/path\n")
    expect(await provide(worktreeGitDir, repo)).toBe("/abs/path")
    expect(await provide(loopLogPath, repo)).toBe(join("/abs/path", "gtd-loop.log"))
  })

  it("resolves a relative gitdir: pointer against the worktree root", async () => {
    const repo = new InMemRepo()
    repo.writeFile(join("/repo", ".git"), "gitdir: ../shared/worktrees/x\n")
    expect(await provide(worktreeGitDir, repo)).toBe(join("/repo", "../shared/worktrees/x"))
  })

  it("falls back to .git when the .git file has no gitdir: line", async () => {
    const repo = new InMemRepo()
    repo.writeFile(join("/repo", ".git"), "not a gitdir pointer\n")
    expect(await provide(worktreeGitDir, repo)).toBe(".git")
  })

  it("GTD_LOOP_LOG wins verbatim, even over a gitdir: pointer", async () => {
    const repo = new InMemRepo()
    repo.writeFile(join("/repo", ".git"), "gitdir: /abs/path\n")
    expect(await provide(loopLogPath, repo, { env: { GTD_LOOP_LOG: "/tmp/custom.log" } })).toBe(
      "/tmp/custom.log",
    )
  })

  it("treats an empty GTD_LOOP_LOG as unset", async () => {
    const repo = new InMemRepo()
    expect(await provide(loopLogPath, repo, { env: { GTD_LOOP_LOG: "" } })).toBe(
      ".git/gtd-loop.log",
    )
  })
})

describe("worktreeGitDir [real git]", () => {
  const gitExecIn = (dir: string, ...args: string[]): string =>
    execSync(`git ${args.join(" ")}`, { cwd: dir, encoding: "utf8", stdio: "pipe" }).trim()

  const runIn = (root: string) =>
    Effect.runPromise(
      worktreeGitDir.pipe(Effect.provide(Cwd.layer(root)), Effect.provide(NodeContext.layer)),
    )

  it("matches git rev-parse --git-dir in the main repo and in a linked worktree", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-worktree-state-")))
    gitExecIn(root, "init", "-q")
    gitExecIn(root, "config", "user.email", "test@test.com")
    gitExecIn(root, "config", "user.name", "Test")
    gitExecIn(root, "commit", "--allow-empty", "-q", "-m", "init")

    expect(await runIn(root)).toBe(gitExecIn(root, "rev-parse", "--git-dir"))

    const siblingDir = `${root}-sibling`
    gitExecIn(root, "worktree", "add", "-q", "-b", "sibling", siblingDir, "HEAD")
    expect(await runIn(siblingDir)).toBe(gitExecIn(siblingDir, "rev-parse", "--git-dir"))
  })

  it("is immune to a GIT_DIR/GIT_WORK_TREE pointed at a third, unrelated repo", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-worktree-state-")))
    gitExecIn(root, "init", "-q")
    gitExecIn(root, "config", "user.email", "test@test.com")
    gitExecIn(root, "config", "user.name", "Test")
    gitExecIn(root, "commit", "--allow-empty", "-q", "-m", "init")
    const expected = await runIn(root)

    const other = realpathSync(mkdtempSync(join(tmpdir(), "gtd-worktree-state-other-")))
    gitExecIn(other, "init", "-q", "--bare")

    const savedGitDir = process.env.GIT_DIR
    const savedWorkTree = process.env.GIT_WORK_TREE
    try {
      process.env.GIT_DIR = other
      process.env.GIT_WORK_TREE = root
      expect(await runIn(root)).toBe(expected)
    } finally {
      if (savedGitDir === undefined) delete process.env.GIT_DIR
      else process.env.GIT_DIR = savedGitDir
      if (savedWorkTree === undefined) delete process.env.GIT_WORK_TREE
      else process.env.GIT_WORK_TREE = savedWorkTree
    }
  })
})
