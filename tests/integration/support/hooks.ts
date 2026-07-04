import { Before, After } from "quickpickle"
import { rmSync } from "node:fs"
import type { GtdWorld } from "./world.js"
import { InMemRepo } from "./inmem/Repo.js"

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

  // Live tier: remove the temp repo dir.
  if (world.repoDir) {
    if (process.env["KEEP_TEST_REPO"] === "1") {
      process.stderr.write(`Test repo preserved at: ${world.repoDir}\n`)
    } else {
      rmSync(world.repoDir, { recursive: true, force: true })
    }
  }
})
