import { execFileSync, execSync } from "node:child_process"
import { writeFileSync, mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function git(dir: string, ...args: string[]) {
  execFileSync("git", args, { cwd: dir, stdio: "pipe" })
}

function writeFile(dir: string, path: string, content: string) {
  const full = join(dir, path)
  mkdirSync(join(full, ".."), { recursive: true })
  writeFileSync(full, content)
}

/** Base: git init, package.json, src/math.ts, tests/math.test.ts, npm install, initial commit, empty second commit */
export function createTestProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "gtd-test-"))

  git(dir, "init", "-q")
  git(dir, "config", "user.name", "Test")
  git(dir, "config", "user.email", "test@test.com")

  writeFile(
    dir,
    "package.json",
    JSON.stringify(
      {
        name: "test-project",
        type: "module",
        scripts: { test: "vitest run" },
        devDependencies: { vitest: "^3.0.0" },
      },
      null,
      2,
    ),
  )

  writeFile(dir, "src/math.ts", "export const add = (a: number, b: number): number => a + b\n")

  writeFile(
    dir,
    "tests/math.test.ts",
    `import { expect, test } from "vitest"
import { add } from "../src/math.js"

test("add returns sum of two numbers", () => {
  expect(add(2, 3)).toBe(5)
})
`,
  )

  writeFile(dir, ".gitignore", "node_modules\n")

  writeFile(
    dir,
    ".gtdrc.json",
    JSON.stringify(
      {
        modelPlan: "anthropic/claude-sonnet-4-5",
        modelBuild: "anthropic/claude-sonnet-4-5",
        modelCommit: "anthropic/claude-haiku-4-5",
      },
      null,
      2,
    ) + "\n",
  )

  execSync("npm install -q", { cwd: dir, stdio: "pipe" })

  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "initial commit")

  // Empty second commit so HEAD~1 exists (needed for getDiff fallback)
  git(dir, "commit", "--allow-empty", "-q", "-m", "chore: setup")

  return dir
}
