import { execFileSync, spawn, type SpawnOptions } from "node:child_process"
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { parse } from "yaml"

const root = new URL("../../", import.meta.url).pathname
const step = parse(
  readFileSync(join(root, ".github/workflows/commits.yml"), "utf8"),
).jobs.commitlint.steps.at(-1)

const dirs: string[] = []
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

// Async, not spawnSync: a long synchronous child blocks the vitest worker, and
// a slow CI runner then times out its RPC ("Timeout calling onTaskUpdate").
const spawnAsync = (command: string, args: string[], options: SpawnOptions) =>
  new Promise<{ status: number | null; output: string }>((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    child.stdout?.on("data", (chunk) => (output += chunk))
    child.stderr?.on("data", (chunk) => (output += chunk))
    child.on("error", reject)
    child.on("close", (status) => resolve({ status, output }))
  })

// An exported GIT_DIR/GIT_WORK_TREE would send these commits to the real repo.
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
)

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
    env: cleanEnv,
  }).trim()

const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "commits-"))
  dirs.push(dir)
  git(dir, "init", "-q", "-b", "main")
  git(dir, "commit", "-q", "--allow-empty", "-m", "chore: base")
  return dir
}

const commit = (dir: string, message: string) =>
  git(dir, "commit", "-q", "--allow-empty", "--no-verify", "-m", message)

// Runs the PR check's own step over base..HEAD, with the repo's config and
// node_modules, as CI does from the checkout.
const lint = (dir: string, base: string, title = "feat: a title") => {
  copyFileSync(join(root, "commitlint.config.mjs"), join(dir, "commitlint.config.mjs"))
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"))
  return spawnAsync("bash", ["-e", "-c", step.run], {
    cwd: dir,
    env: { ...cleanEnv, BASE: base, HEAD: git(dir, "rev-parse", "HEAD"), TITLE: title },
  })
}

const checkTitle = (title: string, ...messages: string[]) => {
  const dir = repo()
  const base = git(dir, "rev-parse", "HEAD")
  messages.forEach((message) => commit(dir, message))
  return lint(dir, base, title)
}

const check = (...messages: string[]) => checkTitle("feat: a title", ...messages)

describe("PR commit check", () => {
  it("passes conventional commits, a breaking one with its footer included", async () => {
    const run = await checkTitle(
      "refactor(history)!: drop the v1 format",
      "feat(cli): add --json to gtd status\n\nWhy.\n\nCo-Authored-By: A <a@a>",
      "refactor(history)!: drop the v1 format\n\nBREAKING CHANGE: replay old processes with gtd 20 first",
    )
    expect(run.output).not.toContain("✖")
    expect(run.status).toBe(0)
  })

  it.each([
    ["a non-conventional subject", "Update the readme", "type-empty"],
    ["`!` without a footer", "feat(cli)!: rename --json", "breaking-change-footer"],
    [
      "a hyphenated footer semantic-release cannot read",
      "feat!: rename --json\n\nBREAKING-CHANGE: pass --format",
      "breaking-change-footer",
    ],
    [
      "a footer without `!`",
      "feat: rename --json\n\nBREAKING CHANGE: pass --format",
      "breaking-change-footer",
    ],
    ["a gtd state commit", "gtd(build.implement): land the step", "type-enum"],
    ["a non-convention type", "style: reflow", "type-enum"],
    ["a subject over 72 characters", `fix: ${"x".repeat(68)}`, "header-max-length"],
    ["a fixup commit", "fixup! feat: add x", "type-empty"],
    ["a revert commit", 'Revert "feat: x"', "type-empty"],
  ])("fails on %s", async (_, message, rule) => {
    const run = await check("feat: fine", message)
    expect(run.output).toContain(`[${rule}]`)
    expect(run.status).toBe(1)
  })

  it("lints commits below HEAD", async () => {
    const run = await check("Update the readme", "feat: fine")
    expect(run.output).toContain("[type-empty]")
    expect(run.status).toBe(1)
  })

  it("accepts a 72-character subject", async () => {
    const run = await check(`fix: ${"x".repeat(67)}`)
    expect(run.output).not.toContain("✖")
    expect(run.status).toBe(0)
  })

  it("fails closed when the range cannot be listed", async () => {
    const dir = repo()
    expect((await lint(dir, "0".repeat(40))).status).not.toBe(0)
  })

  it("fails on an empty range", async () => {
    const dir = repo()
    expect((await lint(dir, git(dir, "rev-parse", "HEAD"))).status).not.toBe(0)
  })

  it("lints the PR title, the squash subject", async () => {
    const run = await checkTitle("Update stuff", "feat: fine")
    expect(run.output).toContain("[type-empty]")
    expect(run.status).toBe(1)
  })

  it("accepts a breaking PR title when a commit carries the footer", async () => {
    const run = await checkTitle(
      "feat(cli)!: rename --json",
      "feat!: a\n\nBREAKING CHANGE: pass --format",
      "fix: b",
    )
    expect(run.output).not.toContain("✖")
    expect(run.status).toBe(0)
  })

  it("fails a breaking PR title when no commit carries the footer", async () => {
    const run = await checkTitle("feat!: rename", "feat: a", "fix: b")
    expect(run.output).toContain("BREAKING CHANGE: footer")
    expect(run.status).toBe(1)
  })

  it("fails a non-breaking PR title when a commit carries the footer", async () => {
    const run = await checkTitle("feat(cli): add x", "feat!: a\n\nBREAKING CHANGE: y", "fix: b")
    expect(run.output).toContain("title has no")
    expect(run.status).toBe(1)
  })

  it("does not take a `!:` inside the title for a breaking marker", async () => {
    const run = await checkTitle("fix(cli): reject `!:` in step names", "fix: a")
    expect(run.output).not.toContain("✖")
    expect(run.status).toBe(0)
  })

  it("pins the doc's type table and length to the config", async () => {
    const { default: config } = await import(join(root, "commitlint.config.mjs"))
    const doc = readFileSync(join(root, "docs/commits.md"), "utf8")
    const [, , types] = config.rules["type-enum"]
    const documented = [...doc.matchAll(/^\| `(\w+)`/gm)].map((m) => m[1])
    expect(documented).toEqual(types)
    expect(doc).toContain(`at most ${config.rules["header-max-length"][2]} characters`)
  })

  it("skips merge commits", async () => {
    const dir = repo()
    const base = git(dir, "rev-parse", "HEAD")
    git(dir, "checkout", "-q", "-b", "side")
    commit(dir, "fix: side")
    git(dir, "checkout", "-q", "main")
    commit(dir, "feat: main")
    git(dir, "merge", "-q", "--no-edit", "side")
    expect(git(dir, "rev-list", "--merges", `${base}..HEAD`)).not.toBe("")
    const run = await lint(dir, base)
    expect(run.status).toBe(0)
  })
})

describe("semantic-release bump from a squash commit", () => {
  // The dry run below names the analyzer bare; that equals the repo's setup
  // only while .releaserc.json configures it with no options.
  it("uses the analyzer with its defaults", () => {
    const config = JSON.parse(readFileSync(join(root, ".releaserc.json"), "utf8"))
    expect(config.plugins).toContain("@semantic-release/commit-analyzer")
    // top-level keys (preset, releaseRules) reach the analyzer too
    expect(Object.keys(config).sort()).toEqual(["branches", "plugins"])
  })

  const nextVersion = async (message: string) => {
    const dir = mkdtempSync(join(tmpdir(), "release-"))
    dirs.push(dir)
    git(dir, "init", "-q", "--bare", "remote.git")
    const work = join(dir, "work")
    git(dir, "init", "-q", "-b", "main", work)
    commit(work, "feat: base")
    git(work, "tag", "v1.0.0")
    git(work, "remote", "add", "origin", "../remote.git")
    git(work, "push", "-q", "origin", "main", "--tags")
    git(work, "checkout", "-q", "-b", "test-branch")
    commit(work, `${message}\n\nCo-Authored-By: A <a@a>\nGtd-History: ${"0".repeat(40)}`)
    git(work, "push", "-q", "origin", "test-branch")
    const { status, output } = await spawnAsync(
      join(root, "node_modules/.bin/semantic-release"),
      [
        "--dry-run",
        "--no-ci",
        "--branches",
        "test-branch",
        "--repository-url",
        `file://${dir}/remote.git`,
        "--plugins",
        "@semantic-release/commit-analyzer",
      ],
      {
        cwd: work,
        // On a CI runner semantic-release takes the branch from the CI's env
        // (env-ci), not from git, and skips the test branch.
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
      },
    )
    expect(status).toBe(0)
    return /The next release version is (\S+)/.exec(output)?.[1] ?? "none"
  }

  it.each([
    ["feat(cli): add --json", "1.1.0"],
    ["feat(cli)!: rename --json", "none"],
    ["feat(cli)!: rename --json\n\nWhy.\n\nBREAKING CHANGE: pass --format json", "2.0.0"],
    ["refactor(history)!: drop v1\n\nBREAKING CHANGE: replay with gtd 20 first", "2.0.0"],
    ["fix(replay): keep the trailer", "1.0.1"],
    ["docs: explain doors", "none"],
    ["feat(cli)!: add x (#12)\n\n* feat!: a\n\nBREAKING CHANGE: y\n\n* fix: b", "2.0.0"],
  ])("%j → %s", async (message, version) => {
    expect(await nextVersion(message)).toBe(version)
  })
})
