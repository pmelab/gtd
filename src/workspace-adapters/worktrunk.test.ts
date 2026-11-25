import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
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
      execFileSync("git", ["init", "-q", join(workspace, "portal", "main")], {
        env,
      })
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
      expect(await worktrunk({ roots: [root] }).refresh!("demo")).toEqual({
        state: "ok",
      })
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

describe("worktrunk list", () => {
  it("runs wt with optional git locks off", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-worktrunk-env-")))
    const oldPath = process.env["PATH"]
    try {
      const bin = join(root, "bin")
      mkdirSync(bin)
      writeFileSync(
        join(bin, "wt"),
        `#!/bin/sh\nprintf '%s' "$GIT_OPTIONAL_LOCKS" > "${join(root, "seen")}"\necho '{"schema":2,"items":[]}'\n`,
        { mode: 0o755 },
      )
      execFileSync("git", ["init", "-q", "-b", "main", join(root, "demo")], {
        env,
      })
      process.env["PATH"] = `${bin}:${oldPath}`
      await worktrunk({ roots: [join(root, "*")] }).list("demo")
      expect(readFileSync(join(root, "seen"), "utf8")).toBe("0")
    } finally {
      process.env["PATH"] = oldPath
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("worktrunk branch descriptions", () => {
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", args, { cwd, env, encoding: "utf8" })

  const withFakeWt = async (
    script: string,
    body: (main: string, adapter: ReturnType<typeof worktrunk>) => Promise<void>,
  ): Promise<void> => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-worktrunk-desc-")))
    const oldPath = process.env["PATH"]
    try {
      const bin = join(root, "bin")
      mkdirSync(bin)
      writeFileSync(join(bin, "wt"), script.replaceAll("$ROOT", root), {
        mode: 0o755,
      })
      const main = join(root, "demo")
      execFileSync("git", ["init", "-q", "-b", "main", main], { env })
      git(main, "commit", "-q", "--allow-empty", "-m", "first")
      process.env["PATH"] = `${bin}:${oldPath}`
      await body(main, worktrunk({ roots: [join(root, "*")] }))
    } finally {
      process.env["PATH"] = oldPath
      rmSync(root, { recursive: true, force: true })
    }
  }

  it("lists the description of a branch that has one, and none for one that has not", async () => {
    const list = JSON.stringify({
      schema: 2,
      items: [
        {
          branch: "main",
          head: { sha: "a" },
          worktree: { path: "$ROOT/demo", main: true },
        },
        {
          branch: "other",
          head: { sha: "b" },
          worktree: { path: "$ROOT/demo", main: false },
        },
      ],
    })
    await withFakeWt(`#!/bin/sh\necho '${list}'\n`, async (main, adapter) => {
      git(main, "config", "branch.main.description", "Fix login\nsecond")
      const listed = await adapter.list("demo")
      expect(listed[0]?.description).toBe("Fix login\nsecond")
      expect(listed[1]).not.toHaveProperty("description")
    })
  })

  it("sets the description before wt switch --create, and restores the old one when that fails", async () => {
    const script = `#!/bin/sh\ngit -C "$ROOT/demo" config --get branch.feat.description > "$ROOT/seen"\nexit 1\n`
    await withFakeWt(script, async (main, adapter) => {
      git(main, "config", "branch.feat.description", "Old")
      await expect(
        adapter.create!("demo", "feat", undefined, { description: "Add feat" }),
      ).rejects.toThrow()
      const root = join(main, "..")
      expect(readFileSync(join(root, "seen"), "utf8").trim()).toBe("Add feat")
      expect(git(main, "config", "--get", "branch.feat.description").trim()).toBe("Old")
    })
  })

  it("unsets the description when a failed create had none to restore", async () => {
    await withFakeWt(`#!/bin/sh\nexit 1\n`, async (main, adapter) => {
      await expect(
        adapter.create!("demo", "feat", undefined, { description: "Add feat" }),
      ).rejects.toThrow()
      expect(() => git(main, "config", "--get", "branch.feat.description")).toThrow()
    })
  })

  it("watch() hints after a branch description is edited", async () => {
    await withFakeWt(`#!/bin/sh\nexit 1\n`, async (main, adapter) => {
      const hints = adapter.watch!()[Symbol.asyncIterator]()
      try {
        const next = hints.next()
        git(main, "config", "branch.main.description", "Edited")
        let timer: ReturnType<typeof setTimeout> | undefined
        const late = new Promise<"late">(
          (resolve) => (timer = setTimeout(() => resolve("late"), 5_000)),
        )
        const result = await Promise.race([next, late]).finally(() => clearTimeout(timer))
        expect(result).toEqual({ done: false, value: { project: "demo" } })
      } finally {
        await hints.return?.()
      }
    })
  })

  it("switch writes the description only when the branch has none", async () => {
    const script = `#!/bin/sh\necho '{"path":"$ROOT/x"}'\n`
    await withFakeWt(script, async (main, adapter) => {
      await adapter.switch!("demo", "a", { description: "New" })
      expect(git(main, "config", "--get", "branch.a.description").trim()).toBe("New")
      git(main, "config", "branch.b.description", "Keep")
      await adapter.switch!("demo", "b", { description: "New" })
      expect(git(main, "config", "--get", "branch.b.description").trim()).toBe("Keep")
    })
  })
})

describe("worktrunk foreground branch", () => {
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", args, { cwd, env, encoding: "utf8" })

  const listOn = async (
    branch: string,
    setup: (main: string) => void,
  ): Promise<Awaited<ReturnType<ReturnType<typeof worktrunk>["list"]>>[number]> => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-worktrunk-fg-")))
    const oldPath = process.env["PATH"]
    try {
      const bin = join(root, "bin")
      mkdirSync(bin)
      const list = JSON.stringify({
        schema: 2,
        items: [
          {
            branch,
            head: { sha: "a" },
            worktree: { path: `${root}/demo`, main: false },
          },
        ],
      })
      writeFileSync(join(bin, "wt"), `#!/bin/sh\necho '${list}'\n`, {
        mode: 0o755,
      })
      const main = join(root, "demo")
      execFileSync("git", ["init", "-q", "-b", "main", main], { env })
      git(main, "commit", "-q", "--allow-empty", "-m", "first")
      setup(main)
      process.env["PATH"] = `${bin}:${oldPath}`
      return (await worktrunk({ roots: [join(root, "*")] }).list("demo"))[0]!
    } finally {
      process.env["PATH"] = oldPath
      rmSync(root, { recursive: true, force: true })
    }
  }

  it("maps gtd/<b> to <b> and takes <b>'s description when gtd/<b> has none", async () => {
    const w = await listOn("gtd/feat", (main) => {
      git(main, "branch", "feat")
      git(main, "branch", "gtd/feat")
      git(main, "config", "branch.feat.description", "Add feat")
    })
    expect(w.branch).toBe("gtd/feat")
    expect(w.foreground).toBe("feat")
    expect(w.description).toBe("Add feat")
  })

  it("keeps a gtd/<b> branch that has no <b>", async () => {
    const w = await listOn("gtd/solo", (main) => git(main, "branch", "gtd/solo"))
    expect(w).not.toHaveProperty("foreground")
  })
})
