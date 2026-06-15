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

Given(
  "{string} is modified to:",
  function (this: GtdWorld, path: string, content: string) {
    const full = join(this.repoDir, path)
    writeFileSync(full, content.endsWith("\n") ? content : content + "\n")
  },
)

Given(
  "{string} has appended {string}",
  function (this: GtdWorld, path: string, text: string) {
    const full = join(this.repoDir, path)
    const existing = readFileSync(full, "utf-8")
    writeFileSync(full, existing + text + "\n")
  },
)

When("I run gtd", function (this: GtdWorld) {
  this.runGtd()
})

When("I run gtd {string}", function (this: GtdWorld, args: string) {
  this.runGtd(...args.split(" ").filter((s) => s.length > 0))
})

Then("it fails", function (this: GtdWorld) {
  assert.notStrictEqual(
    this.lastResult.exitCode,
    0,
    `expected non-zero exit\nstdout: ${this.lastResult.stdout}`,
  )
})

Then("stderr contains {string}", function (this: GtdWorld, text: string) {
  assert.ok(
    this.lastResult.stderr.includes(text),
    `Expected stderr to contain "${text}". Got:\n${this.lastResult.stderr}`,
  )
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
