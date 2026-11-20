import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect } from "vitest"

// A read that refreshes a stale index rewrites it under `index.lock`, which
// could fail a landing. With optional locks off the index stays byte-identical.
export const withStaleIndex = async (check: (root: string) => Promise<void> | void) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-readlock-")))
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" })
    git("init", "-q")
    git("config", "user.email", "t@t.t")
    git("config", "user.name", "T")
    git("config", "commit.gpgsign", "false")
    writeFileSync(join(root, "a.txt"), "a\n")
    git("add", "-A")
    git("commit", "-q", "-m", "one")
    utimesSync(join(root, "a.txt"), new Date(2001, 1, 1), new Date(2001, 1, 1))
    const before = readFileSync(join(root, ".git", "index"))
    await check(root)
    expect(readFileSync(join(root, ".git", "index")).equals(before)).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
