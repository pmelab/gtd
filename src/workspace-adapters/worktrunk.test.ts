import { execFileSync } from "node:child_process"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { worktreesContract, type WorktreesHarness } from "../workspace-testkit/index.js"
import { worktrunk } from "./worktrunk.js"

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
}

// `wt` must not read the person's config: its hooks would run on `create`.
const wtConfig = mkdtempSync(join(tmpdir(), "gtd-worktrunk-config-"))
process.env["WORKTRUNK_CONFIG_PATH"] = join(wtConfig, "config.toml")
process.env["WORKTRUNK_APPROVALS_PATH"] = join(wtConfig, "approvals.toml")
process.env["GIT_CONFIG_GLOBAL"] = "/dev/null"
process.env["GIT_CONFIG_NOSYSTEM"] = "1"

const harness: WorktreesHarness = {
  setup: async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "gtd-worktrunk-")))
    const main = join(workspace, "demo")
    const git = (cwd: string, ...args: string[]): string =>
      execFileSync("git", args, { cwd, env, encoding: "utf8" })
    execFileSync("git", ["init", "-q", "-b", "main", main], { env })
    let commits = 0
    const commitIn = (cwd: string): void => {
      writeFileSync(join(cwd, `file-${++commits}.txt`), String(commits))
      git(cwd, "add", ".")
      git(cwd, "commit", "-q", "-m", `commit ${commits}`)
    }
    commitIn(main)
    const origin = join(workspace, "origin.git")
    execFileSync("git", ["init", "-q", "--bare", origin], { env })
    git(main, "remote", "add", "origin", origin)
    git(main, "push", "-q", "origin", "main")
    const worktreeOf = (branch: string): string => join(workspace, `demo.wt-${branch}`)
    return {
      adapter: worktrunk({ roots: [join(workspace, "*")] }),
      project: "demo",
      defaultBranch: "main",
      addWorktree: async (branch) =>
        void git(main, "worktree", "add", "-q", "-b", branch, worktreeOf(branch)),
      commit: async (branch) => commitIn(worktreeOf(branch)),
      merge: async (branch, how) => {
        if (how === "squash") {
          git(main, "merge", "-q", "--squash", branch)
          git(main, "commit", "-q", "-m", `squash ${branch}`)
        } else {
          git(main, "merge", "-q", "--no-ff", "-m", `merge ${branch}`, branch)
        }
      },
      makeDirty: async (branch) => writeFileSync(join(worktreeOf(branch), "untracked.txt"), "x"),
      push: async (branch) => void git(main, "push", "-q", "origin", branch),
      leave: async (branch) => void git(main, "worktree", "remove", worktreeOf(branch)),
      dispose: async () => rmSync(workspace, { recursive: true, force: true }),
    }
  },
}

describe("the worktrunk adapter passes the worktrees contract", () => {
  for (const contractCase of worktreesContract(harness)) {
    it(contractCase.name, contractCase.run, 30_000)
  }
})

describe("worktrunk roots", () => {
  it("refuses a relative root", () => {
    expect(() => worktrunk({ roots: ["code/*"] })).toThrow(
      'worktrunk: root "code/*" must be an absolute path or start with ~/',
    )
  })

  it("names a project by what its * segments matched", async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "gtd-worktrunk-")))
    try {
      execFileSync("git", ["init", "-q", join(workspace, "portal", "main")], { env })
      expect(await worktrunk({ roots: [join(workspace, "*", "main")] }).projects()).toEqual([
        { id: "portal", path: join(workspace, "portal", "main") },
      ])
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe("worktrunk refresh", () => {
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", args, { cwd, env, encoding: "utf8" })
  const commitIn = (cwd: string, file: string): void => {
    writeFileSync(join(cwd, file), file)
    git(cwd, "add", ".")
    git(cwd, "commit", "-q", "-m", file)
  }

  // A project cloned from `origin`, so its main checkout has an upstream.
  const withClone = async (
    body: (paths: { root: string; origin: string; main: string }) => Promise<void>,
  ): Promise<void> => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "gtd-worktrunk-")))
    try {
      const origin = join(workspace, "origin")
      execFileSync("git", ["init", "-q", "-b", "main", origin], { env })
      commitIn(origin, "a.txt")
      const main = join(workspace, "projects", "demo")
      execFileSync("git", ["clone", "-q", origin, main], { env })
      await body({ root: join(workspace, "projects", "*"), origin, main })
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  }

  it("fast-forwards the main checkout to its upstream", async () => {
    await withClone(async ({ root, origin, main }) => {
      commitIn(origin, "b.txt")
      expect(await worktrunk({ roots: [root] }).refresh!("demo")).toEqual({ state: "ok" })
      expect(git(main, "rev-parse", "HEAD")).toBe(git(origin, "rev-parse", "HEAD"))
    })
  }, 30_000)

  it("reports a main checkout that does not fast-forward as stale, and keeps its HEAD", async () => {
    await withClone(async ({ root, origin, main }) => {
      commitIn(origin, "b.txt")
      commitIn(main, "c.txt")
      const head = git(main, "rev-parse", "HEAD")
      expect(await worktrunk({ roots: [root] }).refresh!("demo")).toMatchObject({
        state: "stale",
      })
      expect(git(main, "rev-parse", "HEAD")).toBe(head)
    })
  }, 30_000)

  it("reports a main checkout whose fetch fails as stale", async () => {
    await withClone(async ({ root, origin }) => {
      rmSync(origin, { recursive: true, force: true })
      expect(await worktrunk({ roots: [root] }).refresh!("demo")).toMatchObject({
        state: "stale",
        reason: expect.stringMatching(/^git fetch failed/),
      })
    })
  }, 30_000)

  it("leaves a main checkout without an upstream as it is", async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "gtd-worktrunk-")))
    try {
      execFileSync("git", ["init", "-q", "-b", "main", join(workspace, "demo")], { env })
      expect(await worktrunk({ roots: [join(workspace, "*")] }).refresh!("demo")).toEqual({
        state: "ok",
      })
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
