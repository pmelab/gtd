import { Given, When, Then } from "@cucumber/cucumber"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, symlinkSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

const PROJECT_ROOT = resolve(import.meta.dirname, "../../../..")
const HOOK_PATH = join(PROJECT_ROOT, ".git/hooks/pre-commit")

Given("prettier is available in the test project", function (this: GtdWorld) {
  const nodeModulesSrc = join(PROJECT_ROOT, "node_modules")
  const nodeModulesDest = join(this.repoDir, "node_modules")
  if (!existsSync(nodeModulesDest)) {
    symlinkSync(nodeModulesSrc, nodeModulesDest)
  }
  writeFileSync(
    join(this.repoDir, ".prettierrc"),
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

Given(
  "the pre-commit hook from the project is installed",
  function (this: GtdWorld) {
    const hookContent = readFileSync(HOOK_PATH, "utf-8")
    const dest = join(this.repoDir, ".git/hooks/pre-commit")
    writeFileSync(dest, hookContent, { mode: 0o755 })
  },
)

Given("{string} is staged", function (this: GtdWorld, path: string) {
  execFileSync("git", ["add", path], { cwd: this.repoDir, stdio: "pipe" })
})

When(
  "I commit with message {string}",
  function (this: GtdWorld, message: string) {
    try {
      execFileSync("git", ["commit", "-m", message], {
        cwd: this.repoDir,
        stdio: "pipe",
      })
    } catch (err: unknown) {
      const e = err as { stdout?: Buffer; stderr?: Buffer }
      throw new Error(
        `git commit failed:\nstdout: ${e.stdout?.toString()}\nstderr: ${e.stderr?.toString()}`,
      )
    }
  },
)

Then(
  "{string} has no lines longer than {int} characters",
  function (this: GtdWorld, path: string, limit: number) {
    const content = readFileSync(join(this.repoDir, path), "utf-8")
    const longLines = content
      .split("\n")
      .filter((line) => line.length > limit)
    assert.strictEqual(
      longLines.length,
      0,
      `Expected no lines longer than ${limit} chars in ${path}, but found:\n${longLines.join("\n")}`,
    )
  },
)

Then(
  "{string} still has a line longer than 80 characters",
  function (this: GtdWorld, path: string) {
    const content = readFileSync(join(this.repoDir, path), "utf-8")
    const longLines = content.split("\n").filter((line) => line.length > 80)
    assert.ok(
      longLines.length > 0,
      `Expected at least one line longer than 80 chars in ${path}, but all lines are within limit`,
    )
  },
)
