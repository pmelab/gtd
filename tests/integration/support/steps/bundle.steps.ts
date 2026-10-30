import assert from "node:assert"
import { execFile as execFileCb } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { Then, When } from "quickpickle"
import { GTD_VERSION } from "../../../../src/install/index.js"
import { readPin } from "../../../../src/workflow/index.js"
import type { GtdWorld } from "../world.js"

const execFile = promisify(execFileCb)

When("I run gtd bundle", async (world: GtdWorld) => {
  await world.runGtdBundle()
})

Then(
  "the pin's header names pin format {int} and the gtd version under test",
  (world: GtdWorld, format: number) => {
    const header = Buffer.from(world.pin.subarray(0, world.pin.indexOf(0x0a))).toString()
    assert.equal(header, `gtdpin ${format} gtd ${GTD_VERSION}`)
  },
)

Then("the pin carries {string}", (world: GtdWorld, text: string) => {
  assert.ok(readPin(world.pin).source.includes(text), `the pin does not carry "${text}"`)
})

When("I save the pin as {string}", (world: GtdWorld, path: string) => {
  assert.equal(world.repo, undefined, "a saved pin is a real file: @live only")
  mkdirSync(dirname(join(world.repoDir, path)), { recursive: true })
  writeFileSync(join(world.repoDir, path), world.pin)
})

// The pin's module on its own, without the launcher that hands over to it.
When(
  "I run the pin {string} with {string}",
  async (world: GtdWorld, path: string, args: string) => {
    assert.equal(world.repo, undefined, "running a pin spawns node: @live only")
    const dir = mkdtempSync(join(tmpdir(), "gtd-pin-"))
    world.closers.push(async () => rmSync(dir, { recursive: true, force: true }))
    const module = join(dir, "process.mjs")
    writeFileSync(module, readPin(readFileSync(join(world.repoDir, path))).source)
    const run = await execFile(process.execPath, [module, ...args.split(" ")], {
      cwd: world.repoDir,
      env: world.spawnEnv(),
      encoding: "utf8",
    }).then(
      (done) => ({ exitCode: 0, ...done }),
      (err: { code?: unknown; stdout: string; stderr: string }) => ({
        exitCode: typeof err.code === "number" ? err.code : 1,
        ...err,
      }),
    )
    world.lastResult = { exitCode: run.exitCode, stdout: run.stdout, stderr: run.stderr }
  },
)
