import { Then, When } from "quickpickle"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

// ── Signal death (`@live` only — see world.ts's `spawnGtdNextAndSignal`) ──────

When("I send SIGINT to a spawned gtd next", async (world: GtdWorld) => {
  await world.spawnGtdNextAndSignal("SIGINT")
})

When("I send SIGTERM to a spawned gtd next", async (world: GtdWorld) => {
  await world.spawnGtdNextAndSignal("SIGTERM")
})

// ── gtd ui's own process lifecycle (`@live` only — see world.ts's `spawnGtdUiAndSignal`) ──

When("I send SIGINT to a spawned gtd ui", async (world: GtdWorld) => {
  await world.spawnGtdUiAndSignal("SIGINT")
})

When("I send SIGTERM to a spawned gtd ui", async (world: GtdWorld) => {
  await world.spawnGtdUiAndSignal("SIGTERM")
})

// ── gtd ui's serve-path teardown on signal death (package 01, `@live` only — see world.ts's `spawnGtdUiServeAndSignal`) ──

When(
  "I send SIGINT to a spawned gtd ui using tailscale serve on port {int}",
  async (world: GtdWorld, servePort: number) => {
    await world.spawnGtdUiServeAndSignal(servePort, "SIGINT")
  },
)

When(
  "I send SIGTERM to a spawned gtd ui using tailscale serve on port {int}",
  async (world: GtdWorld, servePort: number) => {
    await world.spawnGtdUiServeAndSignal(servePort, "SIGTERM")
  },
)

Then("the reported exit status is {int}", (world: GtdWorld, expected: number) => {
  const exit = world.lastSignalExit
  assert.notStrictEqual(
    exit,
    undefined,
    'No signal was ever sent. Run a step like "I send SIGINT to a spawned gtd next" first.',
  )
  assert.strictEqual(
    exit!.status,
    expected,
    `Expected exit status ${expected}. Got status ${exit!.status} (code=${String(exit!.code)}, signal=${String(exit!.signal)}).`,
  )
})
