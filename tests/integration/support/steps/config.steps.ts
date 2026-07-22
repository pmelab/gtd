import { Given } from "quickpickle"
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
  // fallow-ignore-next-line complexity
  (world: GtdWorld, pathOrDir: string, content: string) => {
    const rel = pathOrDir === "." || pathOrDir.endsWith("/") ? join(pathOrDir, ".gtdrc") : pathOrDir
    const normalized = content.endsWith("\n") ? content : content + "\n"
    if (world.tier === "inmem") {
      world.repo!.writeFile(rel, normalized)
      world.repo!.commitAllWithPrefix(`chore: add ${rel}`)
    } else {
      const full = join(world.repoDir, rel)
      mkdirSync(join(full, ".."), { recursive: true })
      writeFileSync(full, normalized)
      execFileSync("git", ["add", rel], { cwd: world.repoDir, stdio: "pipe" })
      execFileSync("git", ["commit", "-q", "-m", `chore: add ${rel}`], {
        cwd: world.repoDir,
        stdio: "pipe",
      })
    }
  },
)

// Sets an environment variable the in-memory tier's `EnvVars` layer exposes —
// exactly the `GTD_VAR_`-prefixed highest-precedence layer of the merged
// `it.vars` (see src/Edge.ts's `resolveVars`). Never touches the real
// `process.env`: `world.envVars` flows straight into `inMemoryLayers`.
Given(
  "an environment variable {string} set to {string}",
  (world: GtdWorld, name: string, value: string) => {
    world.envVars[name] = value
  },
)

// Re-roots the existing test repo beneath a freshly created shared ancestor
// temp dir (under os.tmpdir(), NOT under home) and drops a `.gtdrc` there. The
// ancestor is a plain directory, not a git root, so this proves ConfigService's
// cwd→up walk (stopping at filesystem root) finds configs in shared parents
// above the repo. The repo's git history is preserved via a recursive copy.
Given("a shared parent directory with a gtd config:", (world: GtdWorld, content: string) => {
  const parent = mkdtempSync(join(tmpdir(), "gtd-parent-"))
  writeFileSync(join(parent, ".gtdrc"), content.endsWith("\n") ? content : content + "\n")

  const moved = join(parent, "repo")
  cpSync(world.repoDir, moved, { recursive: true })
  rmSync(world.repoDir, { recursive: true, force: true })
  world.repoDir = moved

  // The copy may have changed absolute paths inside .git; a no-op git command
  // confirms the repo is still operable from the new location.
  execFileSync("git", ["status", "--porcelain"], { cwd: world.repoDir, stdio: "pipe" })
})
