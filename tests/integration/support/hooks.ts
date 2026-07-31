import { Before, After } from "quickpickle"
import { rmSync } from "node:fs"
import type { GtdWorld } from "./world.js"
import { InMemRepo } from "./inmem/Repo.js"

// Scrub every inherited GIT_* and GTD_LOOP_* var from the test process's
// environment, once, at support-load time — so the suite runs identically
// whether launched from a plain shell or AS A gtd LOOP'S OWN CHECK (the loop
// driver runs `npm test` as a child, inheriting its runtime env).
//
// - GIT_*: @live scenarios spawn git and the gtd bundle against a fresh tmp
//   repo, relying on cwd-based discovery; an ambient GIT_DIR/GIT_WORK_TREE
//   would override that discovery and point `git init` and every subsequent op
//   at the OUTER worktree's git dir instead of the tmp repo's own .git — the
//   same cross-worktree leak `bin/gtd`'s worktree_git_dir guards against.
// - GTD_LOOP_*: the loop driver exports GTD_LOOP_LOG (bin/gtd), the absolute
//   path of the CURRENT worktree's loop log. `bin/gtd`'s resolve_log_path uses
//   $GTD_LOOP_LOG verbatim when set — so a spawned `bin/gtd` inheriting it would
//   report the driver's log path instead of resolving the tmp repo's own,
//   breaking every gtd-log/gtd-loop log-path assertion. Scrubbing the whole
//   GTD_LOOP_ prefix also drops any other leaked driver runtime state
//   (GTD_LOOP_PROMPT/SESSION_ID/…); scenarios that WANT these set them
//   explicitly via world overrides in gtd-loop.steps.ts.
//
// Mutating process.env here keeps every child spawn and `{ ...process.env }`
// spread (world.ts, gtd-loop.steps.ts, project-setup.ts) hermetic from one
// place. The vitest runner itself needs none of these vars.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GIT_") || key.startsWith("GTD_LOOP_")) delete process.env[key]
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
