import { Given, When } from "@cucumber/cucumber"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { GtdWorld } from "../world.js"
import { git } from "../../helpers/project-setup.js"

// Steps for hostile-environment scenarios: non-repo directories, fresh repos,
// subdirectory invocation, detached HEAD, merge commits, git config knobs,
// custom pre-commit hooks, and submodules. Setup is inlined per step (one step
// = one observable repo mutation) so scenarios spell out the exact environment.

Given("a plain directory that is not a git repository", function (this: GtdWorld) {
  this.repoDir = mkdtempSync(join(tmpdir(), "gtd-norepo-"))
})

Given("a fresh git repository with no commits", function (this: GtdWorld) {
  const dir = mkdtempSync(join(tmpdir(), "gtd-fresh-"))
  git(dir, "init", "-q")
  git(dir, "config", "user.name", "Test")
  git(dir, "config", "user.email", "test@test.com")
  git(dir, "config", "commit.gpgsign", "false")
  this.repoDir = dir
})

When("I run gtd from the subdirectory {string}", function (this: GtdWorld, sub: string) {
  this.runCwd = join(this.repoDir, sub)
  this.runGtd()
  this.runCwd = undefined
})

Given("git config {string} is {string}", function (this: GtdWorld, key: string, value: string) {
  git(this.repoDir, "config", key, value)
})

Given("the repository is in detached HEAD state", function (this: GtdWorld) {
  git(this.repoDir, "checkout", "-q", "--detach")
})

// Creates a side branch with one file commit and merges it back with --no-ff,
// leaving a merge commit at HEAD (the documented-unsupported topology).
Given(
  "a merge commit merging a branch with a commit {string} that adds {string} with:",
  function (this: GtdWorld, message: string, path: string, content: string) {
    const current = git(this.repoDir, "rev-parse", "--abbrev-ref", "HEAD")
    git(this.repoDir, "checkout", "-q", "-b", "gtd-test-side")
    const full = join(this.repoDir, path)
    mkdirSync(join(full, ".."), { recursive: true })
    writeFileSync(full, content.endsWith("\n") ? content : content + "\n")
    git(this.repoDir, "add", path)
    git(this.repoDir, "commit", "-q", "-m", message)
    git(this.repoDir, "checkout", "-q", current)
    git(this.repoDir, "merge", "--no-ff", "-q", "-m", "Merge branch gtd-test-side", "gtd-test-side")
  },
)

// Writes an executable `.git/hooks/pre-commit` with the docstring body — for
// scenarios exercising user hooks that rewrite files or fail.
Given("an executable pre-commit hook with:", function (this: GtdWorld, content: string) {
  const dest = join(this.repoDir, ".git/hooks/pre-commit")
  writeFileSync(dest, content.endsWith("\n") ? content : content + "\n", { mode: 0o755 })
})

Given("the pre-commit hook is removed", function (this: GtdWorld) {
  rmSync(join(this.repoDir, ".git/hooks/pre-commit"), { force: true })
})

// Modifies a file with CRLF line endings — simulating a Windows-style editor
// touching a file during review.
Given(
  "{string} is modified with CRLF line endings to:",
  function (this: GtdWorld, path: string, content: string) {
    const body = content.endsWith("\n") ? content : content + "\n"
    writeFileSync(join(this.repoDir, path), body.replace(/\n/g, "\r\n"))
  },
)

// Adds a submodule at `path` backed by a freshly created side repository with
// one commit. Uses `protocol.file.allow=always` (required by modern git for
// local-path submodules).
Given("a committed submodule at {string}", function (this: GtdWorld, path: string) {
  const side = mkdtempSync(join(tmpdir(), "gtd-submodule-"))
  git(side, "init", "-q")
  git(side, "config", "user.name", "Test")
  git(side, "config", "user.email", "test@test.com")
  git(side, "config", "commit.gpgsign", "false")
  writeFileSync(join(side, "lib.ts"), "export const lib = 1\n")
  git(side, "add", "-A")
  git(side, "commit", "-q", "-m", "chore: submodule init")
  execFileSync("git", ["-c", "protocol.file.allow=always", "submodule", "add", "-q", side, path], {
    cwd: this.repoDir,
    stdio: "pipe",
  })
  git(this.repoDir, "commit", "-q", "-m", "chore: add submodule")
})

// Advances the submodule's checked-out worktree to a new commit, leaving a
// pending gitlink (pointer) change in the superproject.
Given("the submodule at {string} has a new commit", function (this: GtdWorld, path: string) {
  const sub = join(this.repoDir, path)
  writeFileSync(join(sub, "lib.ts"), "export const lib = 2\n")
  git(sub, "add", "-A")
  git(sub, "commit", "-q", "-m", "feat: bump")
})
