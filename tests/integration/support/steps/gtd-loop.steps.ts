import { Given, Then, When } from "quickpickle"
import { execFile as execFileCb, execFileSync } from "node:child_process"
import { promisify } from "node:util"
import { writeFileSync, mkdtempSync, chmodSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"
import { editorEnv } from "./edit.steps.js"

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

// A fake `herdr` binary standing in for the real Herdr CLI — bin/gtd's
// `herdr_ok` only fires its Herdr-reporting calls when `herdr` resolves on
// PATH (alongside HERDR_ENV=1 + a non-empty HERDR_PANE_ID), so this step's
// mere presence on world is what `gtdLoopEnv` uses to decide whether to
// provision the Herdr environment at all. The stub logs every invocation's
// arguments as one space-joined line (however bash's `"$@"` renders them) to
// a log file, so scenarios can assert on the exact sequence of calls gtd made
// without a real Herdr install.
//
// The stub also emulates the one bit of real herdr arg-parsing gtd got wrong
// once (the positional <PANE_ID> must precede the options on a `pane`
// subcommand — a trailing pane id makes real herdr reject the first option as
// `unknown option`, exit 2): a `pane <subcmd>` whose first argument after the
// subcommand starts with `-` exits 2, so re-introducing the old pane-id-last
// order fails these scenarios instead of silently no-op'ing.
Given("a fake herdr binary", (world: GtdWorld) => {
  const dir = mkdtempSync(join(tmpdir(), "gtd-loop-herdr-"))
  const logPath = join(dir, "herdr.log")
  const herdrPath = join(dir, "herdr")
  writeFileSync(
    herdrPath,
    `#!/usr/bin/env bash\n` +
      `echo "$@" >> "${logPath}"\n` +
      `if [ "$1" = pane ] && [ "\${3:0:1}" = - ]; then exit 2; fi\n` +
      `exit 0\n`,
  )
  chmodSync(herdrPath, 0o755)
  world.fakeHerdrDir = dir
  world.fakeHerdrLogPath = logPath
})

// Resolves $GTD_NO_EDIT for a loop subprocess. An explicit override wins (a
// scenario asserting on the env var's own effect); otherwise, when no fake
// editor was provisioned, "1" keeps every OTHER scenario on the pre-existing
// halt-at-gate behavior it asserts on — without it, a real ambient editor
// would launch against a tty-less subprocess and hang until the spawn timeout.
function noEditValue(world: GtdWorld): string | undefined {
  if (world.gtdNoEditOverride !== undefined) return world.gtdNoEditOverride
  if (!world.fakeEditorPath) return "1"
  return undefined
}

// Adds the fake-herdr wiring: the stub binary must be discoverable on PATH for
// bin/gtd's `herdr_ok` to fire its Herdr-reporting calls (alongside HERDR_ENV +
// a non-empty HERDR_PANE_ID). bin/gtd self-locates its bundle, so no `gtd` PATH
// shim is needed.
function applyHerdrEnv(env: NodeJS.ProcessEnv, world: GtdWorld): void {
  if (!world.fakeHerdrDir) return
  env["PATH"] = `${world.fakeHerdrDir}:${process.env["PATH"]}`
  env["HERDR_ENV"] = "1"
  env["HERDR_PANE_ID"] = "test-pane"
}

function gtdLoopEnv(world: GtdWorld): NodeJS.ProcessEnv {
  // editorEnv strips any ambient $EDITOR/$VISUAL and, when a scenario
  // provisioned one (via the shared "$EDITOR is a script..."/"...no-op
  // script" steps in edit.steps.ts), sets $EDITOR to the fake editor script.
  const env = editorEnv(world, { ...process.env })
  const overrides: Record<string, string | undefined> = {
    GTD_NO_EDIT: noEditValue(world),
    GTD_LOOP_AGENT_CMD: world.stubAgentPath ? `bash "${world.stubAgentPath}"` : undefined,
    GTD_LOOP_LOG: world.gtdLoopLogOverride,
    GIT_DIR: world.gitDirOverride,
    NO_COLOR: world.noColorOverride,
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) env[key] = value
  }
  applyHerdrEnv(env, world)
  return env
}

// Sets $GTD_NO_EDIT explicitly (a non-empty value disables the loop's
// automatic editor launching, identically to passing --no-edit) — for
// scenarios asserting on the env-var form of that switch specifically,
// distinct from the --no-edit flag itself.
Given("GTD_NO_EDIT is set to {string}", (world: GtdWorld, value: string) => {
  world.gtdNoEditOverride = value
})

// Sets $GTD_LOOP_LOG explicitly — the single-explicit-path override
// `resolve_log_path` uses verbatim instead of deriving
// "$(git rev-parse --git-dir)/gtd-loop.log". `value` is resolved relative to
// the repo root by the subprocess itself (its cwd), exactly like the plain
// "a file ..." step resolves paths, so scenarios can seed/assert on it with
// the same relative path string.
Given("GTD_LOOP_LOG is set to {string}", (world: GtdWorld, value: string) => {
  world.gtdLoopLogOverride = value
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
