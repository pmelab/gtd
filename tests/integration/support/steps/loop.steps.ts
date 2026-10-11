import { Given, Then, When } from "quickpickle"
import assert from "node:assert"
import { setTimeout as delay } from "node:timers/promises"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { GtdWorld } from "../world.js"

// Points the loop's user-level config home at a fresh directory, so the
// machine running the suite never leaks its own ~/.config/gtd/loop.json.
const configHome = (world: GtdWorld): string =>
  (world.envVars["XDG_CONFIG_HOME"] ??= mkdtempSync(join(tmpdir(), "gtd-loop-config-")))

Given("an empty user-level loop config", (world: GtdWorld) => {
  configHome(world)
})

Given("a user-level loop config with:", (world: GtdWorld, json: string) => {
  const dir = join(configHome(world), "gtd")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "loop.json"), String(json))
})

Given("a user-level judge config with:", (world: GtdWorld, json: string) => {
  const dir = join(configHome(world), "gtd")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "judge.json"), String(json))
})

const assertIsolated = (world: GtdWorld): void =>
  assert.ok(
    world.envVars["XDG_CONFIG_HOME"],
    'the loop would read this machine\'s own settings — add "Given an empty user-level loop config"',
  )

// 120s, matching e2e-live's own `stepTimeout`: a loop is a whole process.
When("I run gtd loop", async (world: GtdWorld) => {
  assertIsolated(world)
  await world.runGtdLiveWithin(120_000, "loop")
})

When(
  "I send {word} to a spawned gtd loop mid agent turn",
  async (world: GtdWorld, signal: string) => {
    assertIsolated(world)
    await world.spawnGtdLoopAndSignal(signal as NodeJS.Signals)
  },
)

Then(
  "the interrupted agent turn and its descendants are no longer running",
  async (world: GtdWorld) => {
    const pids = world.signalledAgentPids
    assert.ok(
      pids.length > 0,
      'no agent turn was interrupted — run "I send ... to a spawned gtd loop" first',
    )
    // The kill is asynchronous; give the tree a moment to die.
    for (let i = 0; i < 50 && pids.some(alive); i++) await delay(100)
    assert.deepStrictEqual(pids.filter(alive), [], "these processes outlived the loop")
  },
)

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
