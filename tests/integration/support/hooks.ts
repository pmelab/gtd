import { BeforeAll, Before, After } from "@cucumber/cucumber"
import { execSync } from "node:child_process"
import { rmSync } from "node:fs"
import { resolve } from "node:path"
import type { GtdWorld } from "./world.js"
import { InMemRepo } from "./inmem/Repo.js"

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..")

// fallow-ignore-next-line complexity
BeforeAll(function () {
  try {
    execSync("npm run build", { cwd: PROJECT_ROOT, stdio: "pipe" })
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer }
    if (err.stdout?.length) process.stderr.write(err.stdout)
    if (err.stderr?.length) process.stderr.write(err.stderr)
    throw e
  }
})

/**
 * Detect tier from scenario tags.
 * `@live` → live spawnSync path.
 * Everything else (untagged or `@inmem`) → in-process path with in-memory layers.
 */
Before(function (this: GtdWorld, scenario) {
  const tags = scenario.pickle.tags.map((t) => t.name)
  if (tags.includes("@live")) {
    this.tier = "live"
    this.repo = undefined
  } else {
    // Default (untagged) and @inmem both use in-process mock tier
    this.tier = "inmem"
    this.repo = new InMemRepo()
  }
})

After(function (this: GtdWorld) {
  // In-memory tier: just drop the reference — no temp dir to clean up.
  if (this.tier === "inmem") {
    this.repo = undefined
    return
  }

  // Live tier: remove the temp repo dir.
  if (this.repoDir) {
    if (process.env["KEEP_TEST_REPO"] === "1") {
      process.stderr.write(`Test repo preserved at: ${this.repoDir}\n`)
    } else {
      rmSync(this.repoDir, { recursive: true, force: true })
    }
  }
})
