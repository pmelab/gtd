import { Given, When } from "quickpickle"
import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"
import { writeFileSync, mkdtempSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { GtdWorld } from "../world.js"

const execFile = promisify(execFileCb)

const PROJECT_ROOT = resolve(import.meta.dirname, "../../../..")
const GTD_BIN = join(PROJECT_ROOT, "dist/gtd.bundle.mjs")
const GTD_LOOP_BIN = join(PROJECT_ROOT, "bin/gtd-loop")

// The stub stands in for a real coding agent CLI: it reads $GTD_LOOP_PROMPT
// (set by gtd-loop per turn) and reacts however the docstring says to, so the
// scenario text shows exactly what the "agent" does for each prompt it sees.
Given("a stub agent script that responds to prompts with:", (world: GtdWorld, script: string) => {
  const dir = mkdtempSync(join(tmpdir(), "gtd-loop-stub-"))
  const scriptPath = join(dir, "agent.sh")
  writeFileSync(scriptPath, `#!/usr/bin/env bash\nset -euo pipefail\n${script}\n`)
  chmodSync(scriptPath, 0o755)
  world.stubAgentPath = scriptPath
})

// A `gtd` shim on PATH — bin/gtd-loop calls bare `gtd`, exactly as it would
// once installed, rather than the absolute dist path the @live tier's own
// runGtdLive uses for `gtd` directly.
function writeGtdShim(): string {
  const shimDir = mkdtempSync(join(tmpdir(), "gtd-loop-path-"))
  const gtdShim = join(shimDir, "gtd")
  writeFileSync(gtdShim, `#!/usr/bin/env bash\nexec node "${GTD_BIN}" "$@"\n`)
  chmodSync(gtdShim, 0o755)
  return shimDir
}

function gtdLoopEnv(world: GtdWorld): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${writeGtdShim()}:${process.env["PATH"]}`,
  }
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

// Spawns the real bin/gtd-loop against the real built gtd.bundle.mjs, exactly
// like the @live tier's runGtdLive does for `gtd` itself — gtd-loop is its own
// process, so it can't go through the in-process/inmem tier.
When("I run gtd-loop", async (world: GtdWorld) => {
  try {
    const { stdout, stderr } = await execFile("bash", [GTD_LOOP_BIN], {
      cwd: world.repoDir,
      env: gtdLoopEnv(world),
      encoding: "utf-8",
      timeout: 30_000,
    })
    world.lastResult = { exitCode: 0, stdout, stderr }
  } catch (err: unknown) {
    world.lastResult = toFailedResult(err)
  }
})
