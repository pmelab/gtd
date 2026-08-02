import { Given, Then, When } from "quickpickle"
import { execFile as execFileCb, execFileSync } from "node:child_process"
import { promisify } from "node:util"
import { writeFileSync, mkdirSync, chmodSync, existsSync, unlinkSync } from "node:fs"
import { join, resolve } from "node:path"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

const execFile = promisify(execFileCb)

// This suite drives the Claude Code plugin's hook scripts (plugins/gtd/hooks/
// scripts/*.sh and plugins/gtd/scripts/statusline.sh) as plain black-box
// programs: each takes a JSON payload on stdin and prints JSON (or nothing) on
// stdout. They are bash, not gtd itself, so — unlike gtd-loop.steps.ts's
// bin/gtd — there is no in-process tier for them; every scenario here is
// @live.
const PROJECT_ROOT = resolve(import.meta.dirname, "../../../..")
const PLUGIN_ROOT = join(PROJECT_ROOT, "plugins/gtd")
const GTD_BUNDLE_PATH = join(PROJECT_ROOT, "dist/gtd.bundle.mjs")

// The hook scripts resolve gtd as `<repo-root>/node_modules/.bin/gtd` before
// falling back to `gtd` on PATH (see hooks/scripts/lib.sh's `resolve_gtd`) —
// they do NOT honor GTD_BIN. This step drops a shim there that execs the real
// dev build (the e2e pretest already produced dist/gtd.bundle.mjs), so a
// scenario's fixture repo resolves the same gtd every other @live scenario
// runs against.
Given("the gtd binary is available to plugin scripts", (world: GtdWorld) => {
  const binDir = join(world.repoDir, "node_modules/.bin")
  mkdirSync(binDir, { recursive: true })
  const shimPath = join(binDir, "gtd")
  writeFileSync(shimPath, `#!/usr/bin/env bash\nexec node "${GTD_BUNDLE_PATH}" "$@"\n`)
  chmodSync(shimPath, 0o755)
})

// The armed marker's path: per-worktree, inside the git dir, never the work
// tree — `$(git rev-parse --git-dir)/gtd-claude-loop` (see hooks/scripts/
// lib.sh's `armed_marker_path`). Every gtd-loop.feature-style fixture repo
// here is a plain, non-worktree checkout, but resolving it via the real `git
// rev-parse --git-dir` (rather than hardcoding ".git") keeps this step honest
// about what the scripts themselves do.
function armedMarkerPath(world: GtdWorld): string {
  const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], {
    cwd: world.repoDir,
    encoding: "utf-8",
  }).trim()
  return join(world.repoDir, gitDir, "gtd-claude-loop")
}

Given("the loop is armed", (world: GtdWorld) => {
  writeFileSync(armedMarkerPath(world), "")
})

Given("the loop is disarmed", (world: GtdWorld) => {
  const marker = armedMarkerPath(world)
  if (existsSync(marker)) unlinkSync(marker)
})

Then("the loop is no longer armed", (world: GtdWorld) => {
  assert.ok(!existsSync(armedMarkerPath(world)), "Expected the armed marker to be removed")
})

function toFailedResult(err: unknown): { exitCode: number; stdout: string; stderr: string } {
  const e = err as { code?: unknown; stdout?: string; stderr?: string }
  const exitCode = typeof e.code === "number" ? e.code : 1
  return { exitCode, stdout: e.stdout ?? "", stderr: e.stderr ?? "" }
}

// Runs a plugin script (relative to plugins/gtd/, e.g.
// "hooks/scripts/stop-gate.sh" or "scripts/statusline.sh") with `payload`
// piped in as its JSON stdin, from the fixture repo's own directory — exactly
// how Claude Code itself invokes a hook/statusline command, cwd notwithstanding
// (the scripts derive their OWN working directory from the payload's `.cwd`
// via `hook_cwd`, not from the process's cwd, but running from repoDir keeps
// relative shim/dist paths resolvable either way).
async function runPluginScript(
  world: GtdWorld,
  relPath: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const scriptPath = join(PLUGIN_ROOT, relPath)
  const body = JSON.stringify({ cwd: world.repoDir, ...payload })
  const promise = execFile("bash", [scriptPath], {
    cwd: world.repoDir,
    encoding: "utf-8",
    timeout: 15_000,
  })
  promise.child.stdin!.end(body)
  try {
    const { stdout, stderr } = await promise
    world.lastResult = { exitCode: 0, stdout, stderr }
  } catch (err: unknown) {
    world.lastResult = toFailedResult(err)
  }
}

When("I run the plugin script {string}", async (world: GtdWorld, relPath: string) => {
  await runPluginScript(world, relPath, {})
})

When(
  "I run the plugin script {string} with:",
  async (world: GtdWorld, relPath: string, payloadJson: string) => {
    const payload = payloadJson.trim() ? JSON.parse(payloadJson) : {}
    await runPluginScript(world, relPath, payload)
  },
)

// "stdout is empty" is defined once, in formatting.steps.ts — reused here.
