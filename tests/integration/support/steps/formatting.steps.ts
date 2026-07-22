import { Given, When, Then } from "quickpickle"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, symlinkSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

// Writes an executable `.git/hooks/pre-commit` with the docstring body —
// used by scenarios exercising a user hook that reformats files on commit.
// Moved here from the now-deleted environment.steps.ts: it was the only step
// defined there that any feature file still exercised.
Given("an executable pre-commit hook with:", (world: GtdWorld, content: string) => {
  const dest = join(world.repoDir, ".git/hooks/pre-commit")
  writeFileSync(dest, content.endsWith("\n") ? content : content + "\n", { mode: 0o755 })
})

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

const PROJECT_ROOT = resolve(import.meta.dirname, "../../../..")

Given("prettier is available in the test project", (world: GtdWorld) => {
  const nodeModulesSrc = join(PROJECT_ROOT, "node_modules")
  const nodeModulesDest = join(world.repoDir, "node_modules")
  if (!existsSync(nodeModulesDest)) {
    symlinkSync(nodeModulesSrc, nodeModulesDest)
  }
  writeFileSync(
    join(world.repoDir, ".prettierrc"),
    JSON.stringify({
      printWidth: 100,
      overrides: [
        {
          files: "*.md",
          options: { printWidth: 80, proseWrap: "always" },
        },
      ],
    }),
  )
})

Given("{string} is staged", (world: GtdWorld, path: string) => {
  execFileSync("git", ["add", path], { cwd: world.repoDir, stdio: "pipe" })
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
    const content = readFileSync(join(world.repoDir, path), "utf-8")
    const longLines = content.split("\n").filter((line) => line.length > limit)
    assert.strictEqual(
      longLines.length,
      0,
      `Expected no lines longer than ${limit} chars in ${path}, but found:\n${longLines.join("\n")}`,
    )
  },
)

Then("{string} still has a line longer than 80 characters", (world: GtdWorld, path: string) => {
  const content = readFileSync(join(world.repoDir, path), "utf-8")
  const longLines = content.split("\n").filter((line) => line.length > 80)
  assert.ok(
    longLines.length > 0,
    `Expected at least one line longer than 80 chars in ${path}, but all lines are within limit`,
  )
})
