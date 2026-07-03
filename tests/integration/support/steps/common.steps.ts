import { Given, Then, When } from "@cucumber/cucumber"
import { execFileSync } from "node:child_process"
import { writeFileSync, mkdirSync, readFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"
import { createTestProject } from "../../helpers/project-setup.js"

// ── Repo / branch setup ──────────────────────────────────────────────────────

Given("a test project", function (this: GtdWorld) {
  this.repoDir = createTestProject()
})

// Exercises the main/master local-branch fallback in resolveDefaultBranch()
// (test repos have no remote, so origin/HEAD is unavailable). Renames the
// current branch, fixing the default-branch name the counter/review base use.
Given("a default branch {string}", function (this: GtdWorld, branch: string) {
  execFileSync("git", ["branch", "-M", branch], { cwd: this.repoDir, stdio: "pipe" })
})

// Creates a new branch from the current HEAD and switches to it, leaving the old
// branch intact so resolveDefaultBranch() still finds it. Commits added AFTER
// this step land in `merge-base(default, HEAD)..HEAD` — the range the machine
// folds the test-fix / review-fix counters over.
Given("a branch {string}", function (this: GtdWorld, branch: string) {
  execFileSync("git", ["checkout", "-b", branch], { cwd: this.repoDir, stdio: "pipe" })
})

// ── Working-tree file edits (uncommitted) ────────────────────────────────────

Given("a file {string} with:", function (this: GtdWorld, path: string, content: string) {
  const full = join(this.repoDir, path)
  mkdirSync(join(full, ".."), { recursive: true })
  writeFileSync(full, content.endsWith("\n") ? content : content + "\n")
})

Given("a file {string} with content:", function (this: GtdWorld, path: string, content: string) {
  const full = join(this.repoDir, path)
  mkdirSync(join(full, ".."), { recursive: true })
  writeFileSync(full, content.endsWith("\n") ? content : content + "\n")
})

Given("{string} is modified to:", function (this: GtdWorld, path: string, content: string) {
  const full = join(this.repoDir, path)
  writeFileSync(full, content.endsWith("\n") ? content : content + "\n")
})

Given("{string} has appended {string}", function (this: GtdWorld, path: string, text: string) {
  const full = join(this.repoDir, path)
  const existing = readFileSync(full, "utf-8")
  writeFileSync(full, existing + text + "\n")
})

Given("a directory {string}", function (this: GtdWorld, path: string) {
  mkdirSync(join(this.repoDir, path), { recursive: true })
})

// ── Committed history (one step = one commit) ────────────────────────────────

// The workhorse commit builder: stage exactly `path` with the given content and
// commit it under the verbatim subject. Scenarios spell out the flat `gtd: …`
// subject and the file content, so the landed history is visible in the text.
Given(
  "a commit {string} that adds {string} with:",
  function (this: GtdWorld, message: string, path: string, content: string) {
    const full = join(this.repoDir, path)
    mkdirSync(join(full, ".."), { recursive: true })
    writeFileSync(full, content.endsWith("\n") ? content : content + "\n")
    execFileSync("git", ["add", path], { cwd: this.repoDir, stdio: "pipe" })
    execFileSync("git", ["commit", "-q", "-m", message], { cwd: this.repoDir, stdio: "pipe" })
  },
)

// Initialises a brand-new empty repo (no prior commit) so that `message` becomes
// the root commit. Mirrors "a commit … that adds … with:" but starts from a
// fresh mkdtemp rather than reusing this.repoDir.
Given(
  "a root commit {string} that adds {string} with:",
  function (this: GtdWorld, message: string, path: string, content: string) {
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
    this.repoDir = dir
  },
)

// ── Invocation ───────────────────────────────────────────────────────────────

When("I run gtd", function (this: GtdWorld) {
  this.runGtd()
})

// ── Assertions ───────────────────────────────────────────────────────────────

Then("it succeeds", function (this: GtdWorld) {
  assert.strictEqual(
    this.lastResult.exitCode,
    0,
    `exit ${this.lastResult.exitCode}\nstderr: ${this.lastResult.stderr}`,
  )
})

Then("it fails", function (this: GtdWorld) {
  assert.notStrictEqual(
    this.lastResult.exitCode,
    0,
    `Expected non-zero exit code, but got 0.\nstdout: ${this.lastResult.stdout}`,
  )
})

Then("stdout contains {string}", function (this: GtdWorld, text: string) {
  assert.ok(
    this.lastResult.stdout.includes(text),
    `Expected stdout to contain "${text}". Got:\n${this.lastResult.stdout}`,
  )
})

Then("stdout does not contain {string}", function (this: GtdWorld, text: string) {
  assert.ok(
    !this.lastResult.stdout.includes(text),
    `Expected stdout NOT to contain "${text}". Got:\n${this.lastResult.stdout}`,
  )
})

Then("stderr contains {string}", function (this: GtdWorld, text: string) {
  assert.ok(
    this.lastResult.stderr.includes(text),
    `Expected stderr to contain "${text}". Got:\n${this.lastResult.stderr}`,
  )
})

Then("stderr does not contain {string}", function (this: GtdWorld, text: string) {
  assert.ok(
    !this.lastResult.stderr.includes(text),
    `Expected stderr NOT to contain "${text}". Got:\n${this.lastResult.stderr}`,
  )
})

// Post-loop observables. Edge-driven auto states emit no prompt — a single `gtd`
// run performs the git action(s) and drives the loop forward — so assert the
// landed commit subject instead of a retired prompt string.
Then("the last commit subject is {string}", function (this: GtdWorld, subject: string) {
  assert.strictEqual(
    this.lastCommitSubject(),
    subject,
    `Expected last commit subject "${subject}". Got "${this.lastCommitSubject()}".\nLog:\n${this.gitLog()}`,
  )
})

Then("the HEAD commit subject is {string}", function (this: GtdWorld, subject: string) {
  assert.strictEqual(
    this.lastCommitSubject(),
    subject,
    `Expected HEAD commit subject "${subject}". Got "${this.lastCommitSubject()}".\nLog:\n${this.gitLog()}`,
  )
})

Then("the git log contains {string}", function (this: GtdWorld, subject: string) {
  const log = this.gitLog()
  assert.ok(log.includes(subject), `Expected git log to contain "${subject}". Got:\n${log}`)
})

Then("the git log does not contain {string}", function (this: GtdWorld, subject: string) {
  const log = this.gitLog()
  assert.ok(!log.includes(subject), `Expected git log NOT to contain "${subject}". Got:\n${log}`)
})

Then("the file {string} exists", function (this: GtdWorld, path: string) {
  assert.ok(this.repoFileExists(path), `Expected file "${path}" to exist.`)
})

Then("the file {string} does not exist", function (this: GtdWorld, path: string) {
  assert.ok(!this.repoFileExists(path), `Expected file "${path}" NOT to exist.`)
})

Then("{string} exists", function (this: GtdWorld, path: string) {
  assert.ok(this.repoFileExists(path), `Expected "${path}" to exist.`)
})

Then("{string} does not exist", function (this: GtdWorld, path: string) {
  assert.ok(!this.repoFileExists(path), `Expected "${path}" NOT to exist.`)
})

Then("the file {string} contains {string}", function (this: GtdWorld, path: string, text: string) {
  const content = this.repoFile(path)
  assert.ok(
    content.includes(text),
    `Expected file "${path}" to contain "${text}". Got:\n${content}`,
  )
})

Then(
  "the file {string} does not contain {string}",
  function (this: GtdWorld, path: string, text: string) {
    const content = this.repoFile(path)
    assert.ok(
      !content.includes(text),
      `Expected file "${path}" NOT to contain "${text}". Got:\n${content}`,
    )
  },
)

// Full-history assertion for journey scenarios: the exact commit subject
// sequence, oldest → newest, one subject per docstring line.
Then("the commit subjects from oldest to newest are:", function (this: GtdWorld, doc: string) {
  const actual = execFileSync("git", ["log", "--reverse", "--format=%s"], {
    cwd: this.repoDir,
    encoding: "utf-8",
  }).trim()
  assert.strictEqual(
    actual,
    doc.trim(),
    `Commit subject sequence mismatch.\nExpected:\n${doc.trim()}\nActual:\n${actual}`,
  )
})

Then("I record the commit count", function (this: GtdWorld) {
  this.savedCommitCount = this.commitCount()
})

Then("the commit count is unchanged", function (this: GtdWorld) {
  const current = this.commitCount()
  assert.strictEqual(
    current,
    this.savedCommitCount,
    `Expected commit count to remain ${this.savedCommitCount}, got ${current}`,
  )
})

Then("the commit count is {int}", function (this: GtdWorld, expected: number) {
  const current = this.commitCount()
  assert.strictEqual(current, expected, `Expected commit count ${expected}, got ${current}`)
})
