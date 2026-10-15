import { Given, When, Then } from "quickpickle"
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

Given("an executable pre-commit hook with:", (world: GtdWorld, content: string) => {
  const dest = join(world.repoDir, ".git/hooks/pre-commit")
  writeFileSync(dest, content.endsWith("\n") ? content : content + "\n", { mode: 0o755 })
})

// inmem only: the live tier's seed (`rejectingHook`) also has to override a global `core.hooksPath`.
Given(
  "a pre-commit hook rejecting every commit with {string}",
  (world: GtdWorld, output: string) => {
    world.repo!.hookRejection = output
  },
)

When("I run gtd with args {string}", async (world: GtdWorld, args: string) => {
  await world.runGtd(...args.split(" "))
})

Then("the exit code is {int}", (world: GtdWorld, code: number) => {
  assert.strictEqual(
    world.lastResult.exitCode,
    code,
    `Expected exit code ${code}, got ${world.lastResult.exitCode}\nstderr: ${world.lastResult.stderr}`,
  )
})

Then("stdout is empty", (world: GtdWorld) => {
  assert.strictEqual(
    world.lastResult.stdout.trim(),
    "",
    `Expected empty stdout, got:\n${world.lastResult.stdout}`,
  )
})

Given("{string} is staged", (world: GtdWorld, path: string) => {
  if (world.repo !== undefined) world.repo.stage(path)
  else execFileSync("git", ["add", path], { cwd: world.repoDir, stdio: "pipe" })
})

When("I commit with message {string}", (world: GtdWorld, message: string) => {
  try {
    execFileSync("git", ["commit", "-m", message], {
      cwd: world.repoDir,
      stdio: "pipe",
    })
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer }
    throw new Error(
      `git commit failed:\nstdout: ${e.stdout?.toString()}\nstderr: ${e.stderr?.toString()}`,
    )
  }
})

Then(
  "{string} has no lines longer than {int} characters",
  (world: GtdWorld, path: string, limit: number) => {
    const content = world.readRepoFile(path)
    const longLines = content.split("\n").filter((line) => line.length > limit)
    assert.strictEqual(
      longLines.length,
      0,
      `Expected no lines longer than ${limit} chars in ${path}, but found:\n${longLines.join("\n")}`,
    )
  },
)
