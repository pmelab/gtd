import { Given, Then, When } from "quickpickle"
import assert from "node:assert"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { GtdWorld } from "../world.js"

// A process history is replayed, never asserted into being: these steps build
// one by landing real turns, each failing the scenario unless it produced
// exactly the commit subject the scenario names.

const expectSubject = (world: GtdWorld, subject: string): void => {
  assert.strictEqual(
    world.lastResult.exitCode,
    0,
    `setup landing for "${subject}" failed with exit ${world.lastResult.exitCode}\nstderr: ${world.lastResult.stderr}\nLog:\n${world.gitLog()}`,
  )
  assert.strictEqual(
    world.lastCommitSubject(),
    subject,
    `setup landing expected "${subject}". Got "${world.lastCommitSubject()}".\nstderr: ${world.lastResult.stderr}\nLog:\n${world.gitLog()}`,
  )
}

Given("gtd lands {string}", async (world: GtdWorld, subject: string) => {
  await world.runGtd("land")
  expectSubject(world, subject)
})

// A workflow's opening commit is subjected to its first step, which the
// bundled workflows fix: the scenario names the workflow, not that step.
const FIRST_STEP: Readonly<Record<string, string>> = {
  fix: "fix-precheck",
  review: "review-gate.check",
}

Given("gtd starts workflow {string}", async (world: GtdWorld, workflow: string) => {
  await world.runGtd("--workflow", workflow)
  expectSubject(world, `gtd(human): ${FIRST_STEP[workflow] ?? workflow}`)
})

Given(
  "gtd starts workflow {string} with {string}",
  async (world: GtdWorld, workflow: string, args: string) => {
    await world.runGtd("--workflow", workflow, ...args.split(" "))
    expectSubject(world, `gtd(human): ${FIRST_STEP[workflow] ?? workflow}`)
  },
)

Given("gtd lands {string} judging:", async (world: GtdWorld, subject: string, verdict: string) => {
  await world.runGtdJudgeAnswerWithStdin(String(verdict))
  expectSubject(world, subject)
})

const git = (world: GtdWorld, ...args: string[]): string =>
  execFileSync("git", args, { cwd: world.repoDir, encoding: "utf-8", stdio: "pipe" }).trim()

const hashOf = (world: GtdWorld, name: string): string => {
  const hash = world.tier === "inmem" ? world.repo!.resolveRef(name) : git(world, "rev-parse", name)
  assert.ok(hash, `Expected "${name}" to resolve to a commit hash`)
  return hash!
}

Given("a new branch {string} is checked out", (world: GtdWorld, branch: string) => {
  assert.strictEqual(world.tier, "live", "this step needs an @live scenario")
  git(world, "checkout", "-q", "-b", branch)
})

Given("a bare git remote {string}", (world: GtdWorld, name: string) => {
  assert.strictEqual(world.tier, "live", "this step needs an @live scenario")
  const bare = mkdtempSync(join(tmpdir(), "gtd-test-remote-"))
  world.closers.push(async () => rmSync(bare, { recursive: true, force: true }))
  execFileSync("git", ["init", "-q", "--bare"], { cwd: bare, stdio: "pipe" })
  git(world, "remote", "add", name, bare)
})

Given(
  "the scenario continues in a fresh clone of remote {string}",
  (world: GtdWorld, name: string) => {
    assert.strictEqual(world.tier, "live", "this step needs an @live scenario")
    const url = git(world, "remote", "get-url", name)
    const previous = world.repoDir
    const clone = mkdtempSync(join(tmpdir(), "gtd-test-clone-"))
    execFileSync("git", ["clone", "-q", url, clone], { stdio: "pipe" })
    for (const [key, value] of [
      ["user.name", "Test"],
      ["user.email", "test@test.com"],
      ["commit.gpgsign", "false"],
    ] as const) {
      execFileSync("git", ["config", key, value], { cwd: clone, stdio: "pipe" })
    }
    // A clone carries no node_modules: re-link what the previous project had so
    // package resolution of the config's imports keeps working.
    const modules = join(previous, "node_modules")
    if (existsSync(modules)) symlinkSync(modules, join(clone, "node_modules"))
    world.extraCleanupDir = previous
    world.repoDir = clone
  },
)

Then(
  "the history ref of {string} points at {string}",
  (world: GtdWorld, entry: string, tip: string) => {
    const ref = `refs/gtd/history/${hashOf(world, entry)}`
    const actual =
      world.tier === "inmem"
        ? world.repo!.resolveRef(ref)
        : git(world, "rev-parse", "--verify", "-q", ref)
    assert.strictEqual(actual, hashOf(world, tip), `Expected ${ref} to point at "${tip}".`)
  },
)

When(
  "I run gtd with args {string} followed by the first {int} characters of the hash of {string}",
  async (world: GtdWorld, args: string, count: number, name: string) => {
    await world.runGtd(...args.split(" "), hashOf(world, name).slice(0, count))
  },
)

When("I run gtd with args {string} piped to sh", async (world: GtdWorld, args: string) => {
  assert.strictEqual(world.tier, "live", "this step needs an @live scenario")
  await world.runGtd(...args.split(" "))
  assert.strictEqual(world.lastResult.exitCode, 0, `gtd ${args} failed: ${world.lastResult.stderr}`)
  const r = spawnSync("sh", [], {
    cwd: world.repoDir,
    input: world.lastResult.stdout,
    encoding: "utf-8",
  })
  world.lastResult = { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }
})

// Empty when the tree is already clean: the step is a named marker commit.
Given("the working tree is committed as {string}", (world: GtdWorld, message: string) => {
  if (world.tier === "inmem") {
    world.repo!.commitAllWithPrefix(message)
  } else {
    git(world, "add", "-A")
    git(world, "commit", "-q", "--allow-empty", "-m", message)
  }
})
