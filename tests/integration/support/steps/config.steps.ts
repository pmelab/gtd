import { Given } from "@cucumber/cucumber"
import { execFileSync } from "node:child_process"
import { writeFileSync, mkdirSync, mkdtempSync, cpSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { GtdWorld } from "../world.js"

// Writes a gtd config file inside the test repo and commits it. `pathOrDir` is
// resolved relative to repoDir. A trailing "/" (or ".") means "write `.gtdrc`
// into that directory"; otherwise it is treated as the literal config
// filename/path. The docstring body (YAML or JSON) is written verbatim, so the
// scenario text shows the exact config under test. Committing keeps the working
// tree clean — an untracked config would otherwise route gtd to the
// commit-the-uncommitted-changes leaf before the state under test is reached.
Given(
  "a gtd config file at {string} with:",
  function (this: GtdWorld, pathOrDir: string, content: string) {
    const rel = pathOrDir === "." || pathOrDir.endsWith("/") ? join(pathOrDir, ".gtdrc") : pathOrDir
    const full = join(this.repoDir, rel)
    mkdirSync(join(full, ".."), { recursive: true })
    writeFileSync(full, content.endsWith("\n") ? content : content + "\n")
    execFileSync("git", ["add", rel], { cwd: this.repoDir, stdio: "pipe" })
    execFileSync("git", ["commit", "-q", "-m", `chore: add ${rel}`], {
      cwd: this.repoDir,
      stdio: "pipe",
    })
  },
)

// Re-roots the existing test repo beneath a freshly created shared ancestor
// temp dir (under os.tmpdir(), NOT under home) and drops a `.gtdrc` there. The
// ancestor is a plain directory, not a git root, so this proves ConfigService's
// cwd→up walk (stopping at filesystem root) finds configs in shared parents
// above the repo. The repo's git history is preserved via a recursive copy.
Given(
  "a shared parent directory with a gtd config:",
  function (this: GtdWorld, content: string) {
    const parent = mkdtempSync(join(tmpdir(), "gtd-parent-"))
    writeFileSync(join(parent, ".gtdrc"), content.endsWith("\n") ? content : content + "\n")

    const moved = join(parent, "repo")
    cpSync(this.repoDir, moved, { recursive: true })
    rmSync(this.repoDir, { recursive: true, force: true })
    this.repoDir = moved

    // The copy may have changed absolute paths inside .git; a no-op git command
    // confirms the repo is still operable from the new location.
    execFileSync("git", ["status", "--porcelain"], { cwd: this.repoDir, stdio: "pipe" })
  },
)
