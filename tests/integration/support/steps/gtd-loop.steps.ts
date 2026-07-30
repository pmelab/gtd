import { Given, When } from "quickpickle"
import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"
import { writeFileSync, mkdtempSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { GtdWorld } from "../world.js"

const execFile = promisify(execFileCb)

const PROJECT_ROOT = resolve(import.meta.dirname, "../../../..")
const GTD_BIN_PATH = join(PROJECT_ROOT, "bin/gtd")

// The stub stands in for a real coding agent CLI: it reads $GTD_LOOP_PROMPT
// (set by the loop per turn) and reacts however the docstring says to, so the
// scenario text shows exactly what the "agent" does for each prompt it sees.
Given("a stub agent script that responds to prompts with:", (world: GtdWorld, script: string) => {
  const dir = mkdtempSync(join(tmpdir(), "gtd-loop-stub-"))
  const scriptPath = join(dir, "agent.sh")
  writeFileSync(scriptPath, `#!/usr/bin/env bash\nset -euo pipefail\n${script}\n`)
  chmodSync(scriptPath, 0o755)
  world.stubAgentPath = scriptPath
})

function gtdLoopEnv(world: GtdWorld): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (world.stubAgentPath) {
    env["GTD_LOOP_AGENT_CMD"] = `bash "${world.stubAgentPath}"`
  }
  return env
}

function toFailedResult(err: unknown): { exitCode: number; stdout: string; stderr: string } {
  const e = err as { code?: unknown; stdout?: string; stderr?: string }
  const exitCode = typeof e.code === "number" ? e.code : 1
  return { exitCode, stdout: e.stdout ?? "", stderr: e.stderr ?? "" }
}

// Spawns the real bin/gtd against the real built dist/gtd.bundle.mjs, exactly
// like the @live tier's runGtdLive does for `gtd` itself — bin/gtd is its own
// process, so it can't go through the in-process/inmem tier. bin/gtd
// self-locates the bundle relative to its own script path, so no PATH shim
// is needed to reach it.
async function runBinGtd(world: GtdWorld, args: string[]): Promise<void> {
  try {
    const { stdout, stderr } = await execFile("bash", [GTD_BIN_PATH, ...args], {
      cwd: world.repoDir,
      env: gtdLoopEnv(world),
      encoding: "utf-8",
      timeout: 30_000,
    })
    world.lastResult = { exitCode: 0, stdout, stderr }
  } catch (err: unknown) {
    world.lastResult = toFailedResult(err)
  }
}

// Bare `gtd`, no arguments — the loop body's default entry point.
When("I run bare gtd", async (world: GtdWorld) => {
  await runBinGtd(world, [])
})

// `gtd loop` with no further arguments — must dispatch to the exact same
// loop body as bare `gtd`.
When("I run gtd loop", async (world: GtdWorld) => {
  await runBinGtd(world, ["loop"])
})

// `gtd loop` plus an extra argument — a usage error, rejected before node
// ever runs.
When("I run gtd loop {word}", async (world: GtdWorld, extraArg: string) => {
  await runBinGtd(world, ["loop", extraArg])
})

// Any other first argument hands off to the bundle unchanged, forwarding all
// arguments — e.g. "status" via gtd, or "step human" via gtd.
When("I run {string} via gtd", async (world: GtdWorld, args: string) => {
  await runBinGtd(world, args.split(" "))
})
