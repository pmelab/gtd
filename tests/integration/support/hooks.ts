import { Before, After } from "quickpickle"
import { rmSync } from "node:fs"
import type { GtdWorld } from "./world.js"
import { InMemRepo } from "./inmem/Repo.js"

// Scrub every inherited GIT_* var from the test process's environment, once,
// at support-load time. @live scenarios spawn git and the gtd bundle against a
// fresh tmp repo, relying on cwd-based discovery; an ambient GIT_DIR/
// GIT_WORK_TREE (present when the suite runs as the loop's own check, whose
// environment carried one) would override that discovery and point `git init`
// and every subsequent op at the OUTER worktree's git dir instead of the tmp
// repo's own .git — the same cross-worktree leak `bin/gtd`'s worktree_git_dir
// guards against. Mutating process.env here keeps every child spawn and
// `{ ...process.env }` spread (world.ts, gtd-loop.steps.ts, project-setup.ts)
// hermetic from one place. The vitest runner itself needs no GIT_* var.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GIT_")) delete process.env[key]
}

/**
 * Detect tier from scenario tags.
 * `@live` → live spawnSync path.
 * Everything else (untagged or `@inmem`) → in-process path with in-memory layers.
 */
Before(async (world: GtdWorld) => {
  const tags = world.info.tags
  if (tags.includes("@live")) {
    world.tier = "live"
    world.repo = undefined
  } else {
    // Default (untagged) and @inmem both use in-process mock tier
    world.tier = "inmem"
    world.repo = new InMemRepo()
  }
})

After(async (world: GtdWorld) => {
  // In-memory tier: just drop the reference — no temp dir to clean up.
  if (world.tier === "inmem") {
    world.repo = undefined
    return
  }

  // Live tier: remove the temp repo dir (and any purpose-built ancestor dir).
  const keep = process.env["KEEP_TEST_REPO"] === "1"
  const dirs = [world.repoDir, world.extraCleanupDir].filter(Boolean) as string[]
  for (const dir of dirs) {
    if (keep) process.stderr.write(`Test repo preserved at: ${dir}\n`)
    else rmSync(dir, { recursive: true, force: true })
  }
})
