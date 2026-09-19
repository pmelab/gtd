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

// Only `signalAliveAtSend` is asserted — a genuine signal death and a
// provably-backpressured write are mutually exclusive for `gtd next`:
// `runCli` issues its `stdout.write` and completes in the same synchronous
// step (`Cli.ts`'s `Effect.map`), so `NodeRuntime.runMain`'s fiber has
// already exited and detached its own SIGINT/SIGTERM listener (`runtime.js`)
// by the time any byte is observable on this end. A signal landing that late
// is silently swallowed by `main.ts`'s leftover `process.once` and the child
// just exits normally — not what "the reported exit status is …" expects.
// Asserting `signalAliveAtSend` still proves the scenario's premise: the
// signal hit a live, still-computing process, not one that had already
// raced to a natural exit. See package `01`'s Design amendment.
Then("the child was still alive when the signal landed", (world: GtdWorld) => {
  assert.notStrictEqual(
    world.signalAliveAtSend,
    undefined,
    'No signal was ever sent. Run a step like "I send SIGINT to a spawned gtd next" first.',
  )
  assert.strictEqual(
    world.signalAliveAtSend,
    true,
    "Expected the child to still be alive when the signal was sent.",
  )
})

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
