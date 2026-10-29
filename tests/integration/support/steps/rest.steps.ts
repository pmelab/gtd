import { Then } from "quickpickle"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

Then("stdout lists {string} before {string}", (world: GtdWorld, first: string, second: string) => {
  const out = world.lastResult.stdout
  const i = out.indexOf(first)
  const j = out.indexOf(second)
  assert.ok(i >= 0 && j >= 0 && i < j, `Expected "${first}" before "${second}" in:\n${out}`)
})

// Asks `gtd next --json` where the process rests, leaving the previous
// command's output intact for the assertions that follow.
Then("the process rests at {string}", async (world: GtdWorld, step: string) => {
  const reported = world.lastResult
  await world.runGtd("next", "--json")
  const rest = (JSON.parse(world.lastResult.stdout) as { state?: string }).state
  world.lastResult = reported
  assert.strictEqual(rest, step)
})
