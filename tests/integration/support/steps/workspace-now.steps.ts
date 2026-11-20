import { Then, When } from "quickpickle"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"
import { bench } from "./workspace.steps.js"

const screens = new WeakMap<GtdWorld, string>()

When("I open the Now view and press {string}", async (world: GtdWorld, keys: string) => {
  screens.set(world, await bench(world).now(keys.split("")))
})

Then("the Now view shows:", (world: GtdWorld, expected: string) => {
  // eslint-disable-next-line no-control-regex
  const shown = (screens.get(world) ?? "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
  assert.strictEqual(shown.split("\r\n").join("\n"), String(expected))
})

Then("the terminal focused the driver pane of {string}", async (world: GtdWorld, ref: string) => {
  const b = bench(world)
  assert.deepStrictEqual(b.terminal.focused(), [await b.paneOf(ref)])
})
