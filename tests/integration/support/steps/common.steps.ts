import { Given, Then, When } from "quickpickle"
import { execFileSync } from "node:child_process"
import { writeFileSync, mkdirSync, readFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"
import { createTestProject } from "../../helpers/project-setup.js"

// ── Repo / branch setup ──────────────────────────────────────────────────────

Given("a test project", (world: GtdWorld) => {
  if (world.tier === "inmem") {
    // Seed the in-memory repo with the same initial state as createTestProject:
    // .gitignore, README.md, one "chore: initial commit".
    const repo = world.repo!
    repo.writeFile(".gitignore", "node_modules\n")
    repo.writeFile("README.md", "# test project\n")
    repo.commitAllWithPrefix("chore: initial commit")
    // repoDir is not used for inmem tier, but set a sentinel to avoid undefined errors
    world.repoDir = "/inmem"
  } else {
    world.repoDir = createTestProject()
  }
})

// Exercises the main/master local-branch fallback in resolveDefaultBranch()
// (test repos have no remote, so origin/HEAD is unavailable). Renames the
// current branch, fixing the default-branch name the counter/review base use.
Given("a default branch {string}", (world: GtdWorld, branch: string) => {
  if (world.tier === "inmem") {
    world.repo!.renameBranch(branch)
  } else {
    execFileSync("git", ["branch", "-M", branch], { cwd: world.repoDir, stdio: "pipe" })
  }
})

// Creates a new branch from the current HEAD and switches to it, leaving the old
// branch intact so resolveDefaultBranch() still finds it. Commits added AFTER
// this step land in `merge-base(default, HEAD)..HEAD` — the range the machine
// folds the test-fix / review-fix counters over.
Given("a branch {string}", (world: GtdWorld, branch: string) => {
  if (world.tier === "inmem") {
    world.repo!.createBranch(branch)
  } else {
    execFileSync("git", ["checkout", "-b", branch], { cwd: world.repoDir, stdio: "pipe" })
  }
})

// ── Working-tree file edits (uncommitted) ────────────────────────────────────

function writeRepoFile(world: GtdWorld, path: string, content: string, createDirs = true): void {
  const normalized = content.endsWith("\n") ? content : content + "\n"
  if (world.tier === "inmem") {
    world.repo!.writeFile(path, normalized)
  } else {
    const full = join(world.repoDir, path)
    if (createDirs) mkdirSync(join(full, ".."), { recursive: true })
    writeFileSync(full, normalized)
  }
}

Given("a file {string} with:", (world: GtdWorld, path: string, content: string) => {
  writeRepoFile(world, path, content)
})

Given("a file {string} with content:", (world: GtdWorld, path: string, content: string) => {
  writeRepoFile(world, path, content)
})

Given("{string} is modified to:", (world: GtdWorld, path: string, content: string) => {
  writeRepoFile(world, path, content, false)
})

Given("{string} has appended {string}", (world: GtdWorld, path: string, text: string) => {
  if (world.tier === "inmem") {
    const worktree = (world.repo as unknown as { worktree: Map<string, string> })["worktree"]
    const existing = worktree.get(path) ?? ""
    world.repo!.writeFile(path, existing + text + "\n")
  } else {
    const full = join(world.repoDir, path)
    const existing = readFileSync(full, "utf-8")
    writeFileSync(full, existing + text + "\n")
  }
})

Given("a directory {string}", (world: GtdWorld, path: string) => {
  if (world.tier === "inmem") {
    // Directories are implicit in the in-memory store; no-op.
  } else {
    mkdirSync(join(world.repoDir, path), { recursive: true })
  }
})

// ── Committed history (one step = one commit) ────────────────────────────────

// The workhorse commit builder: stage exactly `path` with the given content and
// commit it under the verbatim subject. Scenarios spell out the flat `gtd: …`
// subject and the file content, so the landed history is visible in the text.
Given(
  "a commit {string} that adds {string} with:",
  (world: GtdWorld, message: string, path: string, content: string) => {
    const normalized = content.endsWith("\n") ? content : content + "\n"
    if (world.tier === "inmem") {
      world.repo!.writeFile(path, normalized)
      world.repo!.commitAllWithPrefix(message)
    } else {
      const full = join(world.repoDir, path)
      mkdirSync(join(full, ".."), { recursive: true })
      writeFileSync(full, normalized)
      execFileSync("git", ["add", path], { cwd: world.repoDir, stdio: "pipe" })
      execFileSync("git", ["commit", "-q", "-m", message], { cwd: world.repoDir, stdio: "pipe" })
    }
  },
)

// Initialises a brand-new empty repo (no prior commit) so that `message` becomes
// the root commit. Mirrors "a commit … that adds … with:" but starts from a
// fresh mkdtemp rather than reusing world.repoDir.
Given(
  "a root commit {string} that adds {string} with:",
  (world: GtdWorld, message: string, path: string, content: string) => {
    const dir = mkdtempSync(join(tmpdir(), "gtd-test-"))
    execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "pipe" })
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "pipe" })
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "pipe" })
    execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, stdio: "pipe" })
    const full = join(dir, path)
    mkdirSync(join(full, ".."), { recursive: true })
    writeFileSync(full, content.endsWith("\n") ? content : content + "\n")
    execFileSync("git", ["add", path], { cwd: dir, stdio: "pipe" })
    execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir, stdio: "pipe" })
    world.repoDir = dir
  },
)

// ── Invocation ───────────────────────────────────────────────────────────────

When("I run gtd", async (world: GtdWorld) => {
  await world.runGtd()
})

// ── Assertions ───────────────────────────────────────────────────────────────

Then("it succeeds", (world: GtdWorld) => {
  assert.strictEqual(
    world.lastResult.exitCode,
    0,
    `exit ${world.lastResult.exitCode}\nstderr: ${world.lastResult.stderr}`,
  )
})

Then("it fails", (world: GtdWorld) => {
  assert.notStrictEqual(
    world.lastResult.exitCode,
    0,
    `Expected non-zero exit code, but got 0.\nstdout: ${world.lastResult.stdout}`,
  )
})

Then("stdout contains {string}", (world: GtdWorld, text: string) => {
  assert.ok(
    world.lastResult.stdout.includes(text),
    `Expected stdout to contain "${text}". Got:\n${world.lastResult.stdout}`,
  )
})

Then("stdout does not contain {string}", (world: GtdWorld, text: string) => {
  assert.ok(
    !world.lastResult.stdout.includes(text),
    `Expected stdout NOT to contain "${text}". Got:\n${world.lastResult.stdout}`,
  )
})

Then("stderr contains {string}", (world: GtdWorld, text: string) => {
  assert.ok(
    world.lastResult.stderr.includes(text),
    `Expected stderr to contain "${text}". Got:\n${world.lastResult.stderr}`,
  )
})

Then("stderr does not contain {string}", (world: GtdWorld, text: string) => {
  assert.ok(
    !world.lastResult.stderr.includes(text),
    `Expected stderr NOT to contain "${text}". Got:\n${world.lastResult.stderr}`,
  )
})

// Post-loop observables. Edge-driven auto states emit no prompt — a single `gtd`
// run performs the git action(s) and drives the loop forward — so assert the
// landed commit subject instead of a retired prompt string.
Then("the last commit subject is {string}", (world: GtdWorld, subject: string) => {
  assert.strictEqual(
    world.lastCommitSubject(),
    subject,
    `Expected last commit subject "${subject}". Got "${world.lastCommitSubject()}".\nLog:\n${world.gitLog()}`,
  )
})

Then("the HEAD commit subject is {string}", (world: GtdWorld, subject: string) => {
  assert.strictEqual(
    world.lastCommitSubject(),
    subject,
    `Expected HEAD commit subject "${subject}". Got "${world.lastCommitSubject()}".\nLog:\n${world.gitLog()}`,
  )
})

Then("the git log contains {string}", (world: GtdWorld, subject: string) => {
  const log = world.gitLog()
  assert.ok(log.includes(subject), `Expected git log to contain "${subject}". Got:\n${log}`)
})

Then("the git log does not contain {string}", (world: GtdWorld, subject: string) => {
  const log = world.gitLog()
  assert.ok(!log.includes(subject), `Expected git log NOT to contain "${subject}". Got:\n${log}`)
})

Then("the file {string} exists", (world: GtdWorld, path: string) => {
  assert.ok(world.repoFileExists(path), `Expected file "${path}" to exist.`)
})

Then("the file {string} does not exist", (world: GtdWorld, path: string) => {
  assert.ok(!world.repoFileExists(path), `Expected file "${path}" NOT to exist.`)
})

Then("{string} exists", (world: GtdWorld, path: string) => {
  assert.ok(world.repoFileExists(path), `Expected "${path}" to exist.`)
})

Then("{string} does not exist", (world: GtdWorld, path: string) => {
  assert.ok(!world.repoFileExists(path), `Expected "${path}" NOT to exist.`)
})

Then("the file {string} contains {string}", (world: GtdWorld, path: string, text: string) => {
  const content = world.repoFile(path)
  assert.ok(
    content.includes(text),
    `Expected file "${path}" to contain "${text}". Got:\n${content}`,
  )
})

Then(
  "the file {string} does not contain {string}",
  (world: GtdWorld, path: string, text: string) => {
    const content = world.repoFile(path)
    assert.ok(
      !content.includes(text),
      `Expected file "${path}" NOT to contain "${text}". Got:\n${content}`,
    )
  },
)

// Full-history assertion for journey scenarios: the exact commit subject
// sequence, oldest → newest, one subject per docstring line.
Then("the commit subjects from oldest to newest are:", (world: GtdWorld, doc: string) => {
  const actual = execFileSync("git", ["log", "--reverse", "--format=%s"], {
    cwd: world.repoDir,
    encoding: "utf-8",
  }).trim()
  assert.strictEqual(
    actual,
    doc.trim(),
    `Commit subject sequence mismatch.\nExpected:\n${doc.trim()}\nActual:\n${actual}`,
  )
})

Then("I record the commit count", (world: GtdWorld) => {
  world.savedCommitCount = world.commitCount()
})

Then("the commit count is unchanged", (world: GtdWorld) => {
  const current = world.commitCount()
  assert.strictEqual(
    current,
    world.savedCommitCount,
    `Expected commit count to remain ${world.savedCommitCount}, got ${current}`,
  )
})

Then("the commit count is {int}", (world: GtdWorld, expected: number) => {
  const current = world.commitCount()
  assert.strictEqual(current, expected, `Expected commit count ${expected}, got ${current}`)
})
