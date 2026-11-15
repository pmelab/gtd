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
