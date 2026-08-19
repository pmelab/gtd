import { Given, Then, When } from "quickpickle"
import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"
import { writeFileSync, mkdtempSync, chmodSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"
import { extractMinimalDriver } from "../../helpers/readme-driver.js"

const execFile = promisify(execFileCb)

const PROJECT_ROOT = resolve(import.meta.dirname, "../../../..")

// The `claude` argv translator: the README's driver is run byte-for-byte
// verbatim (no substitution of its `claude` lines), so the stub agent stands
// in as a real `claude` binary on $PATH instead. It parses the flags the
// README's paste actually uses (-p, --session-id, --resume, --model,
// --dangerously-skip-permissions) into the $GTD_LOOP_* env the stub script
// reads, then execs the stub. The prompt itself no longer arrives as `-p`'s
// argv value (the paste pipes it on stdin instead, to stay under argv's cap
// on a large diff) — `-p` here is a bare flag, and the prompt is read off
// stdin below. Unknown flags (e.g. --dangerously-skip-permissions itself)
// are shifted away inert.
function claudeShimScript(stubPath: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail
session_id=""
model=""
resume=0
while [ $# -gt 0 ]; do
  case "$1" in
    -p) shift ;;
    --resume) session_id="$2"; resume=1; shift 2 ;;
    --session-id) session_id="$2"; shift 2 ;;
    --model) model="$2"; shift 2 ;;
    *) shift ;;
  esac
done
prompt="$(cat)"
export GTD_LOOP_PROMPT="$prompt"
export GTD_LOOP_SESSION_ID="$session_id"
export GTD_LOOP_MODEL="$model"
export GTD_LOOP_MEMORY_RESUME="$resume"
exec bash "${stubPath}"
`
}

// The stub stands in for a real coding agent CLI: it reads $GTD_LOOP_PROMPT
// (set by the `claude` shim above translating the README driver's own argv)
// and reacts however the docstring says to, so the scenario text shows
// exactly what the "agent" does for each prompt it sees.
Given("a stub agent script that responds to prompts with:", (world: GtdWorld, script: string) => {
  const dir = mkdtempSync(join(tmpdir(), "gtd-loop-stub-"))
  const scriptPath = join(dir, "agent.sh")
  writeFileSync(scriptPath, `#!/usr/bin/env bash\nset -euo pipefail\n${script}\n`)
  chmodSync(scriptPath, 0o755)
  world.stubAgentPath = scriptPath

  if (world.pathShimDir !== undefined) {
    const claudeShim = join(world.pathShimDir, "claude")
    writeFileSync(claudeShim, claudeShimScript(scriptPath))
    chmodSync(claudeShim, 0o755)
  }
})

// Extracts README.md's "A complete minimal driver" fenced block and writes it
// to a fresh temp dir OUTSIDE the repo — proving the paste needs nothing
// inside the project it drives.
Given("the driver pasted from README.md", (world: GtdWorld) => {
  const readme = readFileSync(join(PROJECT_ROOT, "README.md"), "utf-8")
  const script = extractMinimalDriver(readme)
  const dir = mkdtempSync(join(tmpdir(), "gtd-readme-driver-"))
  const scriptPath = join(dir, "gtd-loop.sh")
  writeFileSync(scriptPath, script)
  chmodSync(scriptPath, 0o755)
  world.readmeDriverDir = dir
  world.readmeDriverPath = scriptPath
})

function toFailedResult(err: unknown): { exitCode: number; stdout: string; stderr: string } {
  const e = err as { code?: unknown; stdout?: string; stderr?: string }
  const exitCode = typeof e.code === "number" ? e.code : 1
  return { exitCode, stdout: e.stdout ?? "", stderr: e.stderr ?? "" }
}

// The bundled unified template's `vars.testCommand` override, rendered into
// the REAL `checking`/`fix-precheck` script via the `GTD_<NAME>` env layer —
// a workflow parameter for the gtd under test, not driver configuration.
Given("GTD_TESTCOMMAND is set to {string}", (world: GtdWorld, value: string) => {
  world.gtdTestCommandOverride = value
})

// The MINIMAL env the driver spawns with — PATH (the shim dir first, so
// `gtd` and `claude` resolve to this build's bundle and the stub) and HOME,
// nothing else. That absence is itself the copy-paste-complete proof: no
// $GTD_* var, no $NODE_*, no test-harness leak. The one exception is
// $GTD_TESTCOMMAND when a scenario set it: it parameterizes the WORKFLOW
// under test (the bundled template's `vars.testCommand`), not the driver.
function driverEnv(world: GtdWorld): Record<string, string> {
  return {
    PATH: `${world.pathShimDir}:${process.env["PATH"] ?? ""}`,
    HOME: process.env["HOME"] ?? "",
    ...(world.gtdTestCommandOverride !== undefined
      ? { GTD_TESTCOMMAND: world.gtdTestCommandOverride }
      : {}),
  }
}

// Spawned via its own path (not `sh <path>` or `bash <path>`) so the
// driver's `#!/usr/bin/env sh` shebang is the thing actually resolving and
// running it — the most faithful proof the ported script's shebang is
// correct, not just that *some* shell can execute the paste.
When("I run the README driver", async (world: GtdWorld) => {
  const path = world.readmeDriverPath
  assert.ok(path, 'no README driver — run "Given the driver pasted from README.md" first')
  try {
    const { stdout, stderr } = await execFile(path, [], {
      cwd: world.repoDir,
      env: driverEnv(world),
      encoding: "utf-8",
      timeout: 30_000,
    })
    world.lastResult = { exitCode: 0, stdout, stderr }
  } catch (err: unknown) {
    world.lastResult = toFailedResult(err)
  }
})

// The loop's log file path, as the driver resolves it from `gtd status --json`'s
// own `.log` field — always the default ".git/gtd-loop.log" here (every
// scenario runs against a plain, non-worktree test project, and the README
// driver never exports a $GTD_LOOP_LOG of its own).
function loopLogPath(_world: GtdWorld): string {
  return ".git/gtd-loop.log"
}

// Asserts on the loop's log file — where the agent turn and the check
// script's own output land instead of the terminal.
Then("the log file contains {string}", (world: GtdWorld, text: string) => {
  const path = join(world.repoDir, loopLogPath(world))
  const content = existsSync(path) ? readFileSync(path, "utf-8") : ""
  assert.ok(
    content.includes(text),
    `Expected the log file ("${loopLogPath(world)}") to contain "${text}". Got:\n${content}`,
  )
})

Then("the log file does not contain {string}", (world: GtdWorld, text: string) => {
  const path = join(world.repoDir, loopLogPath(world))
  const content = existsSync(path) ? readFileSync(path, "utf-8") : ""
  assert.ok(
    !content.includes(text),
    `Expected the log file ("${loopLogPath(world)}") not to contain "${text}". Got:\n${content}`,
  )
})

// Counts NON-OVERLAPPING occurrences — used to prove a recovered retry ran,
// which a plain "contains" assertion can't distinguish from a single
// occurrence.
Then(
  "the log file contains {string} {int} times",
  (world: GtdWorld, text: string, count: number) => {
    const path = join(world.repoDir, loopLogPath(world))
    const content = existsSync(path) ? readFileSync(path, "utf-8") : ""
    let actual = 0
    let idx = 0
    while ((idx = content.indexOf(text, idx)) !== -1) {
      actual++
      idx += text.length
    }
    assert.strictEqual(
      actual,
      count,
      `Expected the log file ("${loopLogPath(world)}") to contain "${text}" exactly ${count} times, found ${actual}. Got:\n${content}`,
    )
  },
)

// Regex variants of the two assertions above — needed for the computed
// session id (a real @live commit-derived value), which isn't a fixed
// literal, and for a regex BACKREFERENCE proving the SAME id came back on a
// resumed turn.
Then("the log file matches {string}", (world: GtdWorld, pattern: string) => {
  const path = join(world.repoDir, loopLogPath(world))
  const content = existsSync(path) ? readFileSync(path, "utf-8") : ""
  assert.ok(
    new RegExp(pattern).test(content),
    `Expected the log file ("${loopLogPath(world)}") to match /${pattern}/. Got:\n${content}`,
  )
})

Then(
  "the log file matches {string} {int} times",
  (world: GtdWorld, pattern: string, count: number) => {
    const path = join(world.repoDir, loopLogPath(world))
    const content = existsSync(path) ? readFileSync(path, "utf-8") : ""
    const matches = content.match(new RegExp(pattern, "g")) ?? []
    assert.strictEqual(
      matches.length,
      count,
      `Expected the log file ("${loopLogPath(world)}") to match /${pattern}/ exactly ${count} times, found ${matches.length}. Got:\n${content}`,
    )
  },
)
