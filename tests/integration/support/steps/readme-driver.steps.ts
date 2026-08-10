import { Given, Then, When } from "quickpickle"
import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"
import { writeFileSync, chmodSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

const execFile = promisify(execFileCb)

const PROJECT_ROOT_README = join(import.meta.dirname, "../../../../README.md")

// Every step below runs only on the @live tier (hooks.ts's Before sets
// `pathShimDir` there) — one shared guard instead of each step repeating it.
function requirePathShimDir(world: GtdWorld): string {
  if (world.pathShimDir === undefined) {
    throw new Error("no PATH shim dir — this step requires an @live scenario")
  }
  return world.pathShimDir
}

// The stub stands in for the real `claude` CLI: it parses `-p <prompt>` off
// its own argv into $prompt, logs its full argv (so a scenario can prove what
// flags gtd's sessionId/resume mapping produced — see scenario 8), then runs
// the docstring body, which reacts however the scenario text says. Uses a
// `for` loop (never `shift`) so `"$@"` stays intact for the docstring body's
// own use afterward.
Given('a stub "claude" CLI that responds to prompts with:', (world: GtdWorld, script: string) => {
  const path = join(requirePathShimDir(world), "claude")
  writeFileSync(
    path,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'printf "%s\\n" "$*" >> .git/claude-argv.log',
      'prompt="" prev=""',
      'for a in "$@"; do',
      '  [ "$prev" = "-p" ] && prompt="$a"',
      '  prev="$a"',
      "done",
      script,
      "",
    ].join("\n"),
  )
  chmodSync(path, 0o755)
  world.stubClaudePath = path
})

const DRIVER_HEADING = "### A complete minimal driver"

// Finds `needle` in `readme` (searching from `from`), throwing `onMissing` if
// absent — the one shape `extractDriverScript`'s three fence-parsing steps
// share, so each of them is a single call rather than its own if/throw.
function indexOfOrThrow(readme: string, needle: string, from: number, onMissing: string): number {
  const at = readme.indexOf(needle, from)
  if (at === -1) throw new Error(onMissing)
  return at
}

// Extracts the fenced bash block under README.md's "A complete minimal
// driver" section — the README block IS the tested artifact (see decision 8
// in the plan this ports), so there is nothing to pin against; drift is
// unrepresentable by construction.
function extractDriverScript(readme: string): string {
  const headingAt = indexOfOrThrow(
    readme,
    DRIVER_HEADING,
    0,
    `README.md no longer has a "${DRIVER_HEADING}" heading — update this step`,
  )
  const fenceStart = indexOfOrThrow(
    readme,
    "```bash\n",
    headingAt,
    `no fenced bash block found under "${DRIVER_HEADING}" — update this step`,
  )
  const bodyStart = fenceStart + "```bash\n".length
  const fenceEnd = indexOfOrThrow(
    readme,
    "\n```",
    bodyStart,
    `unterminated fenced block under "${DRIVER_HEADING}" — update this step`,
  )
  return readme.slice(bodyStart, fenceEnd + 1)
}

// Installs the extracted driver script as an executable `gtd-loop` in the
// PATH shim dir.
Given("the README's minimal driver", (world: GtdWorld) => {
  const readme = readFileSync(PROJECT_ROOT_README, "utf-8")
  const driverScript = extractDriverScript(readme)
  const path = join(requirePathShimDir(world), "gtd-loop")
  writeFileSync(path, driverScript)
  chmodSync(path, 0o755)
})

function toFailedResult(err: unknown): { exitCode: number; stdout: string; stderr: string } {
  const e = err as { code?: unknown; stdout?: string; stderr?: string }
  const exitCode = typeof e.code === "number" ? e.code : 1
  return { exitCode, stdout: e.stdout ?? "", stderr: e.stderr ?? "" }
}

// Deletes every `GTD_`-prefixed var — hermetic against ambient state, e.g.
// this very suite running as a real loop's own check.
function scrubGtdEnv(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env)) {
    if (key.startsWith("GTD_")) delete env[key]
  }
}

// Every `GTD_`-prefixed var scrubbed first, then a scenario's explicit
// `GTD_TESTCOMMAND is set to` override reapplied on top.
function driverEnv(world: GtdWorld): NodeJS.ProcessEnv {
  const env = { ...process.env }
  scrubGtdEnv(env)
  env["PATH"] = `${requirePathShimDir(world)}:${env["PATH"] ?? ""}`
  if (world.gtdTestCommandOverride !== undefined) {
    env["GTD_TESTCOMMAND"] = world.gtdTestCommandOverride
  }
  env["NODE_OPTIONS"] = undefined
  return env
}

// Runs the README's saved driver — the whole loop protocol, no bin/gtd
// involved. `gtd` and `claude` both resolve off the PATH shim dir.
When("I run the README driver", async (world: GtdWorld) => {
  const driverPath = join(requirePathShimDir(world), "gtd-loop")
  try {
    const { stdout, stderr } = await execFile("bash", [driverPath], {
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

// Sets $GTD_TESTCOMMAND explicitly — the bundled template's `checking`/
// `fix-precheck` script reads `it.vars.testCommand`, whose highest-precedence
// layer is this env var (see src/Edge.ts's `resolveVars`), so this reroutes
// the real check script at a controlled, deterministic suite instead of the
// default "npm test".
Given("GTD_TESTCOMMAND is set to {string}", (world: GtdWorld, value: string) => {
  world.gtdTestCommandOverride = value
})

const loopLogPath = (): string => ".git/gtd-loop.log"

// Asserts on the loop's log file — where the agent turn, the check script,
// and `gtd`'s own required/optional script output now land instead of the
// terminal.
Then("the log file contains {string}", (world: GtdWorld, text: string) => {
  const path = join(world.repoDir, loopLogPath())
  const content = existsSync(path) ? readFileSync(path, "utf-8") : ""
  assert.ok(
    content.includes(text),
    `Expected the log file ("${loopLogPath()}") to contain "${text}". Got:\n${content}`,
  )
})

Then("the log file does not contain {string}", (world: GtdWorld, text: string) => {
  const path = join(world.repoDir, loopLogPath())
  const content = existsSync(path) ? readFileSync(path, "utf-8") : ""
  assert.ok(
    !content.includes(text),
    `Expected the log file ("${loopLogPath()}") not to contain "${text}". Got:\n${content}`,
  )
})

// Counts NON-OVERLAPPING occurrences.
Then(
  "the log file contains {string} {int} times",
  (world: GtdWorld, text: string, count: number) => {
    const path = join(world.repoDir, loopLogPath())
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
      `Expected the log file ("${loopLogPath()}") to contain "${text}" exactly ${count} times, found ${actual}. Got:\n${content}`,
    )
  },
)

// Regex variants of the two assertions above — needed for the computed
// `<scope>#<hash7>` memory key (src/Edge.ts's `memoryKeyFor`), whose hash
// suffix is a real (@live) commit hash and so isn't a fixed literal.
Then("the log file matches {string}", (world: GtdWorld, pattern: string) => {
  const path = join(world.repoDir, loopLogPath())
  const content = existsSync(path) ? readFileSync(path, "utf-8") : ""
  assert.ok(
    new RegExp(pattern).test(content),
    `Expected the log file ("${loopLogPath()}") to match /${pattern}/. Got:\n${content}`,
  )
})

Then(
  "the log file matches {string} {int} times",
  (world: GtdWorld, pattern: string, count: number) => {
    const path = join(world.repoDir, loopLogPath())
    const content = existsSync(path) ? readFileSync(path, "utf-8") : ""
    const matches = content.match(new RegExp(pattern, "g")) ?? []
    assert.strictEqual(
      matches.length,
      count,
      `Expected the log file ("${loopLogPath()}") to match /${pattern}/ exactly ${count} times, found ${matches.length}. Got:\n${content}`,
    )
  },
)
