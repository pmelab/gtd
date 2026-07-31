import { Given, Then, When } from "quickpickle"
import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"
import { writeFileSync, mkdtempSync, chmodSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

const execFile = promisify(execFileCb)

const PROJECT_ROOT = resolve(import.meta.dirname, "../../../..")
const GTD_BIN_PATH = join(PROJECT_ROOT, "bin/gtd")

// Bash single-quotes a string for safe embedding inside a generated shell
// script (the fake editor bodies below never interpolate untrusted input
// otherwise).
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

// Builds a fake `$EDITOR` script at a fresh temp path: every invocation first
// appends the target path it was opened on (bash's `$1`) as one line to a log
// file, so scenarios can assert both WHETHER the editor ran and WHAT it was
// opened on; `body` is then appended verbatim to perform (or skip) the actual
// edit.
function writeFakeEditor(world: GtdWorld, body: string): void {
  const dir = mkdtempSync(join(tmpdir(), "gtd-edit-fake-"))
  const logPath = join(dir, "invocations.log")
  const scriptPath = join(dir, "editor.sh")
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env bash\nset -euo pipefail\necho "$1" >> ${shQuote(logPath)}\n${body}\n`,
  )
  chmodSync(scriptPath, 0o755)
  world.fakeEditorPath = scriptPath
  world.fakeEditorLogPath = logPath
}

// Shows the actual edit the fake editor performs directly in the scenario
// text: it appends `text` as a line to whatever file it was opened on
// (creating the file if the editor was opened on a path that doesn't exist
// yet — exactly like a real editor saving a new file).
Given(
  "$EDITOR is a script that appends {string} to the opened file",
  (world: GtdWorld, text: string) => {
    writeFakeEditor(world, `mkdir -p "$(dirname -- "$1")"\nprintf '%s\\n' ${shQuote(text)} >> "$1"`)
  },
)

// The "closed the editor without changing anything" case: it still records
// that it ran (for the invocation-log assertions below), but never touches
// the target path.
Given("$EDITOR is a no-op script", (world: GtdWorld) => {
  writeFakeEditor(world, ": # no-op — closes without editing anything")
})

// No editor configured at all — clears any fake editor a prior step in this
// scenario may have set, so `$EDITOR`/`$VISUAL` are both absent from the
// spawned process's environment (see `editorEnv` below, which strips them by
// default). The invocation log path (if one was already allocated) is left in
// place so "the fake editor was not invoked" can still assert its absence.
Given("$EDITOR is unset", (world: GtdWorld) => {
  world.fakeEditorPath = undefined
})

/**
 * The environment a subprocess spawn of `bin/gtd` should see for the
 * fake-editor mechanism: `$EDITOR`/`$VISUAL` are always stripped first (an
 * ambient real editor must never leak into a test subprocess with no tty),
 * then `$EDITOR` is set to the fake editor script when one is provisioned.
 * Shared by this file's own `gtd edit` invocations and by
 * `gtd-loop.steps.ts`'s loop invocations.
 */
export function editorEnv(world: GtdWorld, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base }
  delete env["EDITOR"]
  delete env["VISUAL"]
  if (world.fakeEditorPath) {
    env["EDITOR"] = world.fakeEditorPath
  }
  return env
}

// Normalizes an execFile rejection (a non-zero exit) into the world's result
// shape: its `code` is the numeric exit code, with stdout/stderr captured so
// far — defaulting to 1/empty when the failure carries no such fields.
function failedResult(err: unknown): GtdWorld["lastResult"] {
  const e = err as { code?: unknown; stdout?: string; stderr?: string }
  return {
    exitCode: typeof e.code === "number" ? e.code : 1,
    stdout: e.stdout ?? "",
    stderr: e.stderr ?? "",
  }
}

async function runGtdEdit(world: GtdWorld, args: string[]): Promise<void> {
  try {
    const { stdout, stderr } = await execFile("bash", [GTD_BIN_PATH, "edit", ...args], {
      cwd: world.repoDir,
      env: editorEnv(world, process.env),
      encoding: "utf-8",
      timeout: 30_000,
    })
    world.lastResult = { exitCode: 0, stdout, stderr }
  } catch (err: unknown) {
    world.lastResult = failedResult(err)
  }
}

When("I run gtd edit {string}", async (world: GtdWorld, path: string) => {
  await runGtdEdit(world, [path])
})

When("I run gtd edit with no argument", async (world: GtdWorld) => {
  await runGtdEdit(world, [])
})

// Asserts the LAST path the fake editor was opened on — the final line of its
// invocation log.
Then("the fake editor was opened on {string}", (world: GtdWorld, path: string) => {
  assert.ok(
    world.fakeEditorLogPath,
    'no fake editor was provisioned for this scenario — add a "$EDITOR is a script..." step',
  )
  assert.ok(
    existsSync(world.fakeEditorLogPath!),
    `Expected the fake editor to have been invoked (opened on "${path}"), but it never ran.`,
  )
  const lines = readFileSync(world.fakeEditorLogPath!, "utf-8").trim().split("\n")
  const last = lines[lines.length - 1]
  assert.strictEqual(
    last,
    path,
    `Expected the fake editor to have been opened on "${path}". Invocation log:\n${lines.join("\n")}`,
  )
})

// The concrete, file-backed proof that no editor process ran at all: the log
// path was allocated (by an earlier "$EDITOR is a script..."/"...no-op
// script" step) but the script itself never executed, so the log file was
// never created.
Then("the fake editor was not invoked", (world: GtdWorld) => {
  if (world.fakeEditorLogPath === undefined) return
  const invoked = existsSync(world.fakeEditorLogPath)
  assert.ok(
    !invoked,
    invoked
      ? `Expected the fake editor NOT to have been invoked, but its invocation log exists:\n${readFileSync(world.fakeEditorLogPath, "utf-8")}`
      : "",
  )
})
