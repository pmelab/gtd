import { execFileSync } from "node:child_process"
import { writeFileSync, mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" }).trim()
}

function writeFile(dir: string, path: string, content: string) {
  const full = join(dir, path)
  mkdirSync(join(full, ".."), { recursive: true })
  writeFileSync(full, content)
}

function initGitRepo(dir: string): void {
  git(dir, "init", "-q")
  git(dir, "config", "user.name", "Test")
  git(dir, "config", "user.email", "test@test.com")
  git(dir, "config", "commit.gpgsign", "false")

  writeFile(dir, ".gitignore", "node_modules\n")
  writeFile(dir, "README.md", "# test project\n")

  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "chore: initial commit")
}

export function createTestProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "gtd-test-"))
  initGitRepo(dir)
  return dir
}

/**
 * Like `createTestProject`, but the repo lives one level DOWN inside a fresh
 * outer directory carrying its own `.gtdrc.json` — modelling a global/ancestor
 * gtd config (e.g. `~/.gtdrc`) sitting above a repo. The ancestor config is a
 * non-empty object (so cosmiconfig counts it as present) that `gtd init` must
 * ignore, since it scaffolds the repo's OWN config, not the ancestor's.
 */
export function createTestProjectUnderConfiguredAncestor(): { outer: string; repo: string } {
  const outer = mkdtempSync(join(tmpdir(), "gtd-ancestor-"))
  writeFileSync(join(outer, ".gtdrc.json"), '{"vars":{"fromAncestor":"1"}}\n')
  const repo = join(outer, "repo")
  mkdirSync(repo, { recursive: true })
  initGitRepo(repo)
  return { outer, repo }
}

/**
 * A plain, empty directory that is NOT a git repository — for exercising
 * `gtd init` run outside any repo (e.g. scaffolding a shared parent-dir config).
 */
export function createPlainDirectory(): string {
  return mkdtempSync(join(tmpdir(), "gtd-plain-"))
}

/**
 * A git repo with a nested subdirectory — for exercising `gtd init`'s refusal
 * to scaffold into a repository subdirectory (where the upward config walk
 * would never find it).
 */
export function createTestProjectWithSubdir(): { repo: string; sub: string } {
  const repo = createTestProject()
  const sub = join(repo, "packages", "app")
  mkdirSync(sub, { recursive: true })
  return { repo, sub }
}
