import { Given, Then, When } from "quickpickle"
import { execFileSync } from "node:child_process"
import { writeFileSync, mkdirSync } from "node:fs"
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

Given("{string} is modified to:", (world: GtdWorld, path: string, content: string) => {
  writeRepoFile(world, path, content, false)
})

// Plain working-tree deletion — what an editor's "delete file" does. Distinct
// from "a deleted committed file" (git rm), which refuses when the index entry
// differs from HEAD, e.g. inside an open review checkout window.
Given("the file {string} is deleted", (world: GtdWorld, path: string) => {
  world.deleteWorktreeFile(path)
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

// ── Invocation ───────────────────────────────────────────────────────────────

When("I run gtd", async (world: GtdWorld) => {
  await world.runGtd()
})

When("I run gtd with {string}", async (world: GtdWorld, arg: string) => {
  await world.runGtd(arg)
})

When("I run gtd step {word}", async (world: GtdWorld, actor: string) => {
  await world.runGtd("step", actor)
})

When("I run gtd step {word} with {string}", async (world: GtdWorld, actor: string, arg: string) => {
  await world.runGtd("step", actor, arg)
})

When("I run gtd next", async (world: GtdWorld) => {
  await world.runGtd("next")
})

// The built-in check driver: executes the awaited scripted actor's emitted
// wrapper script for real, then steps that actor. @live tier only (the
// script runs against the real filesystem).
When("I run gtd run", async (world: GtdWorld) => {
  await world.runGtd("run")
})

When("I run gtd next with {string}", async (world: GtdWorld, arg: string) => {
  await world.runGtd("next", arg)
})

When("I run gtd status", async (world: GtdWorld) => {
  await world.runGtd("status")
})

When("I run gtd status with {string}", async (world: GtdWorld, arg: string) => {
  await world.runGtd("status", arg)
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

Then("stdout matches {string}", (world: GtdWorld, pattern: string) => {
  assert.ok(
    new RegExp(pattern).test(world.lastResult.stdout),
    `Expected stdout to match /${pattern}/. Got:\n${world.lastResult.stdout}`,
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

Then("the git log contains {string}", (world: GtdWorld, subject: string) => {
  const log = world.gitLog()
  assert.ok(log.includes(subject), `Expected git log to contain "${subject}". Got:\n${log}`)
})

// ── Git status ───────────────────────────────────────────────────────────────

Then("the git status is clean", (world: GtdWorld) => {
  const status = world.gitStatus()
  assert.strictEqual(status.trim(), "", `Expected a clean git status. Got:\n${status}`)
})

Then("{string} exists", (world: GtdWorld, path: string) => {
  assert.ok(world.repoFileExists(path), `Expected "${path}" to exist.`)
})

Then("{string} does not exist", (world: GtdWorld, path: string) => {
  assert.ok(!world.repoFileExists(path), `Expected "${path}" NOT to exist.`)
})

// Full-history assertion for journey scenarios: the exact commit subject
// sequence, oldest → newest, one subject per docstring line.
Then("the commit subjects from oldest to newest are:", (world: GtdWorld, doc: string) => {
  const actual =
    world.tier === "inmem"
      ? world
          .repo!.commitHistory()
          // Subject line only — commit bodies (e.g. the `Gtd-Counters`
          // trailer) are not part of the sequence assertion, matching the
          // subprocess tier's `--format=%s`.
          .map((c) => c.message.split("\n")[0] ?? "")
          .join("\n")
      : execFileSync("git", ["log", "--reverse", "--format=%s"], {
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

Then("the commit count increased by {int}", (world: GtdWorld, n: number) => {
  assert.notStrictEqual(
    world.savedCommitCount,
    undefined,
    'No commit count was recorded. Run "I record the commit count" first.',
  )
  const current = world.commitCount()
  const expected = world.savedCommitCount! + n
  assert.strictEqual(
    current,
    expected,
    `Expected commit count to increase by ${n} (from ${world.savedCommitCount} to ${expected}), got ${current}`,
  )
})
