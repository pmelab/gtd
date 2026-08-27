import { Given, Then } from "quickpickle"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

/**
 * Relocates the just-scaffolded repo's OWN `.git` outside the worktree, into
 * a fresh scratch directory this step allocates for the scenario, and points
 * `world.liveEnvOverrides` (read by `world`'s private `spawnEnv()`) at it —
 * never at the real `process.env`, so the test process itself never exports
 * `$GIT_DIR` (hooks.ts scrubs it once at load time; this step must not
 * undo that). After the move, `<repoDir>/.git` is gone entirely, so gtd can
 * ONLY find its git dir by honoring `$GIT_DIR` — the exact filesystem-probe
 * blind spot `src/WorktreeState.ts`'s `loopLogPath` used to have. `$TMPDIR`
 * is pointed at a second, empty scratch directory alongside it, so a later
 * step can prove nothing gets written there.
 */
Given(
  "the repo's git dir relocated outside the worktree, with TMPDIR pointed at a fresh scratch directory",
  (world: GtdWorld) => {
    assert.strictEqual(world.tier, "live", "this scenario only makes sense against a real git repo")
    const scratch = mkdtempSync(join(tmpdir(), "gtd-tmpdir-gitdir-scenario-"))
    const customGitDir = join(scratch, "custom-gitdir")
    const customTmpDir = join(scratch, "custom-tmp")
    mkdirSync(customTmpDir, { recursive: true })
    renameSync(join(world.repoDir, ".git"), customGitDir)
    world.customGitDir = customGitDir
    world.customTmpDir = customTmpDir
    world.liveEnvOverrides = { GIT_DIR: customGitDir, TMPDIR: customTmpDir }
  },
)

/** Reads the relocated repo's own git dir directly — the test's OWN inspection subprocess, scoped to this one call's `env`, never a `process.env` mutation. */
function gitAtCustomDir(world: GtdWorld, ...args: string[]): string {
  assert.ok(world.customGitDir, "no custom git dir — run the relocation step first")
  return execFileSync("git", args, {
    cwd: world.repoDir,
    env: { ...process.env, GIT_DIR: world.customGitDir },
    encoding: "utf-8",
  })
}

Then(
  "the last commit in the relocated git dir has subject {string}",
  (world: GtdWorld, subject: string) => {
    const actual = gitAtCustomDir(world, "log", "-1", "--format=%s").trim()
    assert.strictEqual(
      actual,
      subject,
      `Expected the relocated git dir's last commit subject "${subject}". Got "${actual}".`,
    )
  },
)

Then('the repository\'s default ".git" directory was never recreated', (world: GtdWorld) => {
  assert.ok(
    !existsSync(join(world.repoDir, ".git")),
    `Expected "${join(world.repoDir, ".git")}" NOT to exist — the beat must land in $GIT_DIR, not the default location.`,
  )
})

Then("nothing was written under the overridden TMPDIR", (world: GtdWorld) => {
  assert.ok(world.customTmpDir, "no overridden TMPDIR — run the relocation step first")
  const entries = readdirSync(world.customTmpDir)
  assert.deepStrictEqual(
    entries,
    [],
    `Expected the overridden TMPDIR ("${world.customTmpDir}") to remain empty. Got: ${entries.join(", ")}`,
  )
})

Then(
  "gtd next --json reports the log path under the relocated git dir",
  async (world: GtdWorld) => {
    await world.runGtd("next", "--json")
    const parsed = JSON.parse(world.lastResult.stdout) as Record<string, unknown>
    assert.strictEqual(parsed.log, join(world.customGitDir!, "gtd-loop.log"))
  },
)

/**
 * Package 2: the mode-contradiction round-trip's scratch path
 * (`src/program.ts`'s `scratchSamplePath`) resolves under the overridden
 * `$TMPDIR` — proving the EMITTED script (never gtd itself, see
 * `tests/tooling/no-tmp-assumption.test.ts`) is the thing that would write
 * there once a driver runs it. Checked against the last result's stdout
 * verbatim, unexecuted (`gtd next --json=validate`'s raw text) — the
 * round-trip cleans its own scratch file up on every path, so nothing
 * survives on disk to inspect afterwards either way.
 */
Then("stdout contains the overridden TMPDIR path", (world: GtdWorld) => {
  assert.ok(world.customTmpDir, "no overridden TMPDIR — run the relocation step first")
  assert.ok(
    world.lastResult.stdout.includes(world.customTmpDir!),
    `Expected stdout to reference the overridden TMPDIR ("${world.customTmpDir}"). Got:\n${world.lastResult.stdout}`,
  )
})
