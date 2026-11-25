import { Then, When } from "quickpickle"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

// ── Signal death (`@live` only — see world.ts's `spawnGtdNextAndSignal`) ──────

When("I send {word} to a spawned gtd next", async (world: GtdWorld, signal: string) => {
  await world.spawnGtdNextAndSignal(signal as NodeJS.Signals)
})

// The child is parked at the harness's `git log --first-parent` gate when signalled (`world.ts#spawnGtdNextAndSignal`).
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
