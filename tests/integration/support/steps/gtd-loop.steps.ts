import { Given, Then, When } from "quickpickle"
import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"
import { writeFileSync, mkdtempSync, chmodSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import assert from "node:assert"
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

// A fake `herdr` binary standing in for the real Herdr CLI — bin/gtd-loop's
// `herdr_ok` only fires its Herdr-reporting calls when `herdr` resolves on
// PATH (alongside HERDR_ENV=1 + a non-empty HERDR_PANE_ID), so this step's
// mere presence on world is what `gtdLoopEnv` uses to decide whether to
// provision the Herdr environment at all. The stub logs every invocation's
// arguments as one space-joined line (however bash's `"$@"` renders them) to
// a log file, then exits 0, so scenarios can assert on the exact sequence of
// calls gtd-loop made without a real Herdr install.
Given("a fake herdr binary", (world: GtdWorld) => {
  const dir = mkdtempSync(join(tmpdir(), "gtd-loop-herdr-"))
  const logPath = join(dir, "herdr.log")
  const herdrPath = join(dir, "herdr")
  writeFileSync(herdrPath, `#!/usr/bin/env bash\necho "$@" >> "${logPath}"\nexit 0\n`)
  chmodSync(herdrPath, 0o755)
  world.fakeHerdrDir = dir
  world.fakeHerdrLogPath = logPath
})

function gtdLoopEnv(world: GtdWorld): NodeJS.ProcessEnv {
  const pathDirs = [writeGtdShim()]
  if (world.fakeHerdrDir) pathDirs.push(world.fakeHerdrDir)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${pathDirs.join(":")}:${process.env["PATH"]}`,
  }
  if (world.stubAgentPath) {
    env["GTD_LOOP_AGENT_CMD"] = `bash "${world.stubAgentPath}"`
  }
  if (world.fakeHerdrDir) {
    env["HERDR_ENV"] = "1"
    env["HERDR_PANE_ID"] = "test-pane"
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

// Asserts each non-empty docstring line appears as a substring of the fake
// herdr log, IN ORDER — later lines must be found strictly after where the
// previous one ended, so the check proves call sequence, not just presence.
Then("the fake herdr log contains, in order:", (world: GtdWorld, block: string) => {
  if (!world.fakeHerdrLogPath) {
    throw new Error(
      'no fake herdr binary was provisioned for this scenario — add "Given a fake herdr binary"',
    )
  }
  const log = readFileSync(world.fakeHerdrLogPath, "utf-8")
  const expectedLines = block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  let cursor = 0
  for (const line of expectedLines) {
    const idx = log.indexOf(line, cursor)
    assert.ok(
      idx !== -1,
      `Expected fake herdr log to contain "${line}" at or after position ${cursor}, in order.\nFull log:\n${log}`,
    )
    cursor = idx + line.length
  }
})
