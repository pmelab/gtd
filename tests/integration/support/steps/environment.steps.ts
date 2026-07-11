import { Given, When } from "quickpickle"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { GtdWorld } from "../world.js"
import { git } from "../../helpers/project-setup.js"

// Steps for hostile-environment scenarios: non-repo directories, fresh repos,
// subdirectory invocation, detached HEAD, merge commits, git config knobs,
// custom pre-commit hooks, and submodules. Setup is inlined per step (one step
// = one observable repo mutation) so scenarios spell out the exact environment.

Given("a plain directory that is not a git repository", (world: GtdWorld) => {
  world.repoDir = mkdtempSync(join(tmpdir(), "gtd-norepo-"))
})

Given("a fresh git repository with no commits", (world: GtdWorld) => {
  const dir = mkdtempSync(join(tmpdir(), "gtd-fresh-"))
  git(dir, "init", "-q")
  git(dir, "config", "user.name", "Test")
  git(dir, "config", "user.email", "test@test.com")
  git(dir, "config", "commit.gpgsign", "false")
  world.repoDir = dir
})

When("I run gtd from the subdirectory {string}", async (world: GtdWorld, sub: string) => {
  world.runCwd = join(world.repoDir, sub)
  await world.runGtd()
  world.runCwd = undefined
})

When(
  "I run gtd {word} from the subdirectory {string}",
  async (world: GtdWorld, arg: string, sub: string) => {
    world.runCwd = join(world.repoDir, sub)
    await world.runGtd(arg)
    world.runCwd = undefined
  },
)

Given("git config {string} is {string}", (world: GtdWorld, key: string, value: string) => {
  git(world.repoDir, "config", key, value)
})

Given("the repository is in detached HEAD state", (world: GtdWorld) => {
  git(world.repoDir, "checkout", "-q", "--detach")
})

// Creates a side branch with one file commit and merges it back with --no-ff,
// leaving a merge commit at HEAD (the documented-unsupported topology).
Given(
  "a merge commit merging a branch with a commit {string} that adds {string} with:",
  (world: GtdWorld, message: string, path: string, content: string) => {
    const current = git(world.repoDir, "rev-parse", "--abbrev-ref", "HEAD")
    git(world.repoDir, "checkout", "-q", "-b", "gtd-test-side")
    const full = join(world.repoDir, path)
    mkdirSync(join(full, ".."), { recursive: true })
    writeFileSync(full, content.endsWith("\n") ? content : content + "\n")
    git(world.repoDir, "add", path)
    git(world.repoDir, "commit", "-q", "-m", message)
    git(world.repoDir, "checkout", "-q", current)
    git(
      world.repoDir,
      "merge",
      "--no-ff",
      "-q",
      "-m",
      "Merge branch gtd-test-side",
      "gtd-test-side",
    )
  },
)

// Writes an executable `.git/hooks/pre-commit` with the docstring body — for
// scenarios exercising user hooks that rewrite files or fail.
Given("an executable pre-commit hook with:", (world: GtdWorld, content: string) => {
  const dest = join(world.repoDir, ".git/hooks/pre-commit")
  writeFileSync(dest, content.endsWith("\n") ? content : content + "\n", { mode: 0o755 })
})

Given("the pre-commit hook is removed", (world: GtdWorld) => {
  rmSync(join(world.repoDir, ".git/hooks/pre-commit"), { force: true })
})

// Modifies a file with CRLF line endings — simulating a Windows-style editor
// touching a file during review.
Given(
  "{string} is modified with CRLF line endings to:",
  (world: GtdWorld, path: string, content: string) => {
    const body = content.endsWith("\n") ? content : content + "\n"
    mkdirSync(dirname(join(world.repoDir, path)), { recursive: true })
    writeFileSync(join(world.repoDir, path), body.replace(/\n/g, "\r\n"))
  },
)

// Adds a submodule at `path` backed by a freshly created side repository with
// one commit. Uses `protocol.file.allow=always` (required by modern git for
// local-path submodules).
Given("a committed submodule at {string}", (world: GtdWorld, path: string) => {
  const side = mkdtempSync(join(tmpdir(), "gtd-submodule-"))
  git(side, "init", "-q")
  git(side, "config", "user.name", "Test")
  git(side, "config", "user.email", "test@test.com")
  git(side, "config", "commit.gpgsign", "false")
  writeFileSync(join(side, "lib.ts"), "export const lib = 1\n")
  git(side, "add", "-A")
  git(side, "commit", "-q", "-m", "chore: submodule init")
  execFileSync("git", ["-c", "protocol.file.allow=always", "submodule", "add", "-q", side, path], {
    cwd: world.repoDir,
    stdio: "pipe",
  })
  git(world.repoDir, "commit", "-q", "-m", "chore: add submodule")
})

// Advances the submodule's checked-out worktree to a new commit, leaving a
// pending gitlink (pointer) change in the superproject.
Given("the submodule at {string} has a new commit", (world: GtdWorld, path: string) => {
  const sub = join(world.repoDir, path)
  writeFileSync(join(sub, "lib.ts"), "export const lib = 2\n")
  git(sub, "add", "-A")
  git(sub, "commit", "-q", "-m", "feat: bump")
})
