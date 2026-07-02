import { execFileSync } from "node:child_process"
import { writeFileSync, mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** Run git in `dir`, returning trimmed stdout — the suite's shared exec wrapper. */
export function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" }).trim()
}

function writeFile(dir: string, path: string, content: string) {
  const full = join(dir, path)
  mkdirSync(join(full, ".."), { recursive: true })
  writeFileSync(full, content)
}

/**
 * Bare-bones git repo with one initial commit. Tests build on top using the
 * `Given …` steps.
 */
export function createTestProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "gtd-test-"))

  git(dir, "init", "-q")
  git(dir, "config", "user.name", "Test")
  git(dir, "config", "user.email", "test@test.com")
  git(dir, "config", "commit.gpgsign", "false")

  writeFile(dir, ".gitignore", "node_modules\n")
  writeFile(dir, "README.md", "# test project\n")

  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "chore: initial commit")

  return dir
}
