import { Given, Then, When } from "@cucumber/cucumber"
import { execFileSync } from "node:child_process"
import { writeFileSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"
import { createTestProject } from "../../helpers/project-setup.js"

Given("a test project", function (this: GtdWorld) {
  this.repoDir = createTestProject()
})

Given("a file {string} with:", function (this: GtdWorld, path: string, content: string) {
  const full = join(this.repoDir, path)
  mkdirSync(join(full, ".."), { recursive: true })
  writeFileSync(full, content.endsWith("\n") ? content : content + "\n")
})

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
  const full = join(this.repoDir, path)
  mkdirSync(full, { recursive: true })
})

// Exercises the main/master local-branch fallback in resolveDefaultBranch()
// (test repos have no remote, so origin/HEAD is not available).
Given("a default branch {string}", function (this: GtdWorld, branch: string) {
  execFileSync("git", ["branch", "-M", branch], { cwd: this.repoDir, stdio: "pipe" })
})

// Creates a new branch from the current HEAD and switches to it, leaving
// the old branch name intact so resolveDefaultBranch() can still find it.
Given("a branch {string}", function (this: GtdWorld, branch: string) {
  execFileSync("git", ["checkout", "-b", branch], { cwd: this.repoDir, stdio: "pipe" })
})

// Creates a single empty `fix(gtd):` commit WITH a `Gtd-Test-Fix:` trailer so
// the verify-loop counter advances by exactly one. Empty keeps the working tree
// clean so the cap/escalate guards (which sit behind codeDirty) are the ones
// under test.
Given("a fix\\(gtd) commit {string}", function (this: GtdWorld, message: string) {
  execFileSync("git", ["commit", "--allow-empty", "-q", "-m", message, "-m", "Gtd-Test-Fix: 1"], {
    cwd: this.repoDir,
    stdio: "pipe",
  })
})

// Creates an empty `fix(gtd):` commit WITHOUT the `Gtd-Test-Fix:` trailer.
// This simulates a plain feature commit that should NOT advance the verify counter.
Given("a plain fix\\(gtd) feature commit {string}", function (this: GtdWorld, message: string) {
  execFileSync("git", ["commit", "--allow-empty", "-q", "-m", message], {
    cwd: this.repoDir,
    stdio: "pipe",
  })
})

// Creates a history-marker commit so lastReviewCommit() can find it.
// --allow-empty keeps this step a pure marker that does not affect diff content.
Given("a prior review commit for {string}", function (this: GtdWorld, shortHash: string) {
  execFileSync(
    "git",
    ["commit", "--allow-empty", "-m", `review(gtd): create review for ${shortHash}`],
    { cwd: this.repoDir, stdio: "pipe" },
  )
})

When("I run gtd", function (this: GtdWorld) {
  this.runGtd()
})

Then("it succeeds", function (this: GtdWorld) {
  assert.strictEqual(
    this.lastResult.exitCode,
    0,
    `exit ${this.lastResult.exitCode}\nstderr: ${this.lastResult.stderr}`,
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
