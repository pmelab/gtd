import { Given, Then, When } from "quickpickle"
import { execFile as execFileCb, execFileSync } from "node:child_process"
import { promisify } from "node:util"
import { writeFileSync, mkdtempSync, chmodSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import assert from "node:assert"
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

// Drops any inherited GTD_LOOP_* runtime state from a spawn env so a spawned
// bin/gtd resolves its OWN log path, not the loop driver's (which exports
// GTD_LOOP_LOG when running the suite as its check). Mirrors hooks.ts's global
// process.env scrub at the spawn boundary; `world.leakedGtdLoopLog` seeds a
// simulated leak first so the regression scenario exercises the strip in CI
// (where no real loop driver set the var).
function scrubInheritedLoopEnv(env: NodeJS.ProcessEnv, world: GtdWorld): void {
  if (world.leakedGtdLoopLog !== undefined) env["GTD_LOOP_LOG"] = world.leakedGtdLoopLog
  for (const key of Object.keys(env)) {
    if (key.startsWith("GTD_LOOP_")) delete env[key]
  }
}

// Prepend the PATH shim dir (see hooks.ts's Before / world.ts's spawnEnv,
// same rationale) so a `gtd` invoked BY NAME resolves to this build's own
// bundle. bin/gtd itself needs no shim (it self-locates dist/gtd.bundle.mjs
// relative to its own script path), but a WRITE subcommand's `required`/
// `.script` bash — e.g. a seeded steering-mode validate: command
// (`SteeringFormats.ts`'s literal `gtd check <mode> <file>`) that
// `run_gtd_command`/the validate gate execute via `bash -c` — shells out to
// `gtd` by name, and would otherwise resolve to whatever (if anything) is
// globally installed on the host.
function prependPathShim(env: NodeJS.ProcessEnv, shimDir: string | undefined): void {
  if (shimDir === undefined) return
  env["PATH"] = `${shimDir}:${env["PATH"] ?? ""}`
}

/** Sets each override whose value the scenario actually supplied; an absent one leaves the inherited value alone. */
function applyEnvOverrides(
  env: NodeJS.ProcessEnv,
  overrides: Record<string, string | undefined>,
): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) env[key] = value
  }
}

function gtdLoopEnv(world: GtdWorld): NodeJS.ProcessEnv {
  const env = { ...process.env }
  scrubInheritedLoopEnv(env, world)
  prependPathShim(env, world.pathShimDir)
  applyEnvOverrides(env, {
    GTD_LOOP_AGENT_CMD: world.stubAgentPath ? `bash "${world.stubAgentPath}"` : undefined,
    GTD_LOOP_LOG: world.gtdLoopLogOverride,
    GIT_DIR: world.gitDirOverride,
    NO_COLOR: world.noColorOverride,
    GTD_TESTCOMMAND: world.gtdTestCommandOverride,
  })
  return env
}

// Sets $GTD_LOOP_LOG explicitly — the single-explicit-path override
// `resolve_log_path` uses verbatim instead of deriving
// "$(git rev-parse --git-dir)/gtd-loop.log". `value` is resolved relative to
// the repo root by the subprocess itself (its cwd), exactly like the plain
// "a file ..." step resolves paths, so scenarios can seed/assert on it with
// the same relative path string.
Given("GTD_LOOP_LOG is set to {string}", (world: GtdWorld, value: string) => {
  world.gtdLoopLogOverride = value
})

// Seeds a LEAKED $GTD_LOOP_LOG into the spawned env — modelling the loop driver
// having exported its own log path (bin/gtd's `export GTD_LOOP_LOG`) into the
// environment the suite inherits when it runs as that driver's check. Distinct
// from "GTD_LOOP_LOG is set to" (an intentional per-scenario override): this
// value must be STRIPPED, not honoured, so a spawned gtd resolves its own log.
Given("the loop driver leaked GTD_LOOP_LOG as {string}", (world: GtdWorld, value: string) => {
  world.leakedGtdLoopLog = value
})

// Injects a stray `$GIT_DIR` pointing at a SEPARATE (valid, but unrelated) git
// dir — modelling the leak that broke issue-#118-class per-worktree isolation:
// an ambient GIT_DIR (from a parent git process, a hook, or another worktree's
// shell) would divert bin/gtd's `git rev-parse --git-dir` away from the cwd
// worktree. A real bare dir (not a bogus path) so a regressed bin/gtd fails as
// a clean wrong-path, not a git fatal. Lives inside repoDir so the After hook's
// repoDir cleanup removes it too.
Given("GIT_DIR points at a separate git dir", (world: GtdWorld) => {
  const separate = join(world.repoDir, "separate.git")
  execFileSync("git", ["init", "--bare", "-q", separate], { encoding: "utf-8" })
  world.gitDirOverride = separate
})

// Sets $NO_COLOR explicitly, for scenarios proving the plain-ASCII rendering
// path specifically — the spawned subprocess already has no tty (execFile
// pipes stdout/stderr), so FANCY is always 0 regardless, but this makes a
// scenario's intent to exercise that path explicit and documents the
// NO_COLOR convention (https://no-color.org) alongside the piped-stdout case.
Given("NO_COLOR is set to {string}", (world: GtdWorld, value: string) => {
  world.noColorOverride = value
})

// Sets $GTD_TESTCOMMAND explicitly — the bundled template's `checking`/
// `fix-precheck` script reads `it.vars.testCommand`, whose highest-precedence
// layer is this env var (see src/Edge.ts's `resolveVars`), so this reroutes
// the real check script at a controlled, deterministic suite instead of the
// default "npm test".
Given("GTD_TESTCOMMAND is set to {string}", (world: GtdWorld, value: string) => {
  world.gtdTestCommandOverride = value
})

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

// Resolves the loop's log file path the same way bin/gtd's resolve_log_path
// does: $GTD_LOOP_LOG verbatim when a scenario overrode it, else the default
// ".git/gtd-loop.log" (every gtd-loop.feature scenario runs against a plain,
// non-worktree test project, so its git-dir is always ".git").
function loopLogPath(world: GtdWorld): string {
  return world.gtdLoopLogOverride ?? ".git/gtd-loop.log"
}

// Asserts on the loop's log file — where the agent turn, the check script,
// and `gtd step`'s own output now land instead of the terminal.
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

// Counts NON-OVERLAPPING occurrences — used to prove a recovered retry ran
// (e.g. "AGENT MEMORY=fix RESUME=0" appearing twice: once for the scope's
// first entry, once for the retry after a doomed resume), which a plain
// "contains" assertion can't distinguish from a single occurrence.
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
// `<scope>#<hash7>` memory key (src/Edge.ts's `memoryKeyFor`), whose hash
// suffix is a real (@live) commit hash and so isn't a fixed literal.
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

// The plain-ASCII rendering proof: no ANSI escape sequence (ESC "[") anywhere.
// Built from a char code rather than a regex literal to avoid embedding a
// literal control character in source.
const ANSI_ESCAPE = String.fromCharCode(0x1b) + "["

Then("stdout has no ANSI escape codes", (world: GtdWorld) => {
  assert.ok(
    !world.lastResult.stdout.includes(ANSI_ESCAPE),
    `Expected stdout to contain no ANSI escape codes. Got:\n${JSON.stringify(world.lastResult.stdout)}`,
  )
})

Then("stderr has no ANSI escape codes", (world: GtdWorld) => {
  assert.ok(
    !world.lastResult.stderr.includes(ANSI_ESCAPE),
    `Expected stderr to contain no ANSI escape codes. Got:\n${JSON.stringify(world.lastResult.stderr)}`,
  )
})
