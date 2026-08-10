import { Before, After } from "quickpickle"
import { rmSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GTD_BIN, type GtdWorld } from "./world.js"
import { InMemRepo } from "../../../src/testing/InMemRepo.js"

// Scrub every inherited GIT_* and GTD_LOOP_* var from the test process's
// environment, once, at support-load time — so the suite runs identically
// whether launched from a plain shell or AS A gtd LOOP'S OWN CHECK (a driver
// running `npm test` as a child, inheriting its runtime env).
//
// - GIT_*: @live scenarios spawn git and the gtd bundle against a fresh tmp
//   repo, relying on cwd-based discovery; an ambient GIT_DIR/GIT_WORK_TREE
//   would override that discovery and point `git init` and every subsequent op
//   at the OUTER worktree's git dir instead of the tmp repo's own .git — the
//   same cross-worktree leak per-worktree git-dir resolution guards against.
// - GTD_LOOP_*: a driver may export `$GTD_LOOP_LOG`, the absolute path of the
//   CURRENT worktree's loop log (`src/WorktreeState.ts`'s `loopLogPath` reads
//   it verbatim when set) — so a spawned gtd inheriting it would report the
//   driver's log path instead of resolving the tmp repo's own, breaking every
//   log-path assertion. Scrubbing the whole GTD_LOOP_ prefix also drops any
//   other leaked driver runtime state; scenarios that WANT one set it
//   explicitly via world overrides in readme-driver.steps.ts.
//
// Mutating process.env here keeps every child spawn and `{ ...process.env }`
// spread (world.ts, readme-driver.steps.ts, project-setup.ts) hermetic from
// one place. The vitest runner itself needs none of these vars. This runs once
// per WORKER (module load, not per-test), so it stays safe under the
// `e2e-inmem` project's `fileParallelism: true` — but it IS a mutation of
// global process state, so any future step definition adding its own
// `process.env` write here would break that parallelism silently. Don't.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GIT_") || key.startsWith("GTD_LOOP_")) delete process.env[key]
}

// A seeded steering-mode validate: command (`SteeringFormats.ts`'s
// `seededValidateCommand`) is the literal template `gtd check <mode> <file>`
// — readable at the cost of resolving `gtd` by NAME off `$PATH`, rather than
// by an absolute path. Nothing guarantees a `gtd` on the host's PATH at all
// (a dev machine may have none), and even if one exists it may be a stale
// global install — either way, running the seeded command for real against
// whatever `gtd.bundle.mjs` happens to be on PATH would silently test the
// wrong binary. This shim makes `gtd` resolve to THIS build's own bundle for
// the whole live-tier subprocess tree (the spawned gtd process itself, and
// anything IT shells out to, e.g. CommandRunner.Live's `bash -c` running a
// mode's validate: command).
function createPathShim(): string {
  const dir = mkdtempSync(join(tmpdir(), "gtd-path-shim-"))
  const shim = join(dir, "gtd")
  writeFileSync(shim, `#!/usr/bin/env bash\nexec node "${GTD_BIN}" "$@"\n`)
  chmodSync(shim, 0o755)
  return dir
}

/**
 * Detect tier from scenario tags. Exactly one of `@live`/`@inmem` is required
 * on every scenario (directly or inherited from its feature) — the tier tag
 * is a required, single-valued property, not a default, since the `e2e-inmem`
 * / `e2e-live` vitest projects (`vitest.config.ts`) route scenarios by tag via
 * `skipTags`; an untagged or double-tagged scenario would silently stop
 * running in EITHER project instead of failing loudly here.
 */
Before(async (world: GtdWorld) => {
  const tags = world.info.tags
  const live = tags.includes("@live")
  const inmem = tags.includes("@inmem")
  if (live === inmem) {
    throw new Error(
      `scenario "${world.info.scenario}" must carry exactly one of @live/@inmem (found: ${
        live ? "both" : "neither"
      })`,
    )
  }
  if (live) {
    world.tier = "live"
    world.repo = undefined
    world.pathShimDir = createPathShim()
  } else {
    world.tier = "inmem"
    world.repo = new InMemRepo()
  }
})

// Live tier: remove the temp repo dir (and any purpose-built ancestor dir),
// honoring KEEP_TEST_REPO — then always remove the PATH shim dir regardless
// (it's harness scaffolding, not part of the test repo KEEP_TEST_REPO is for).
function cleanupLiveTier(world: GtdWorld): void {
  const keep = process.env["KEEP_TEST_REPO"] === "1"
  const dirs = [world.repoDir, world.extraCleanupDir, world.readmeDriverDir].filter(
    Boolean,
  ) as string[]
  for (const dir of dirs) {
    if (keep) process.stderr.write(`Test repo preserved at: ${dir}\n`)
    else rmSync(dir, { recursive: true, force: true })
  }
  if (world.pathShimDir !== undefined) {
    rmSync(world.pathShimDir, { recursive: true, force: true })
    world.pathShimDir = undefined
  }
}

After(async (world: GtdWorld) => {
  if (world.tier === "inmem") {
    world.repo = undefined
    return
  }
  cleanupLiveTier(world)
})
